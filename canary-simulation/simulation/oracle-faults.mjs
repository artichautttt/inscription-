#!/usr/bin/env node
/**
 * Tests de defauts de la methode Oracle (pm2 + nginx), meme style que canary-parity.mjs / oracle-resilience.mjs.
 *
 *  F1..F5 — v2 degradee (pas morte) via fault-proxy (:3013 -> :3012), watcher reel sans AUTO_RECOVERY,
 *           charge 20 req/s / 200 utilisateurs, 70 s, defaut injecte a 20 s, 3 runs par scenario.
 *           F1 100 % de 500 | F2 60 % | F3 30 % | F4 +2 s de latence | F5 +4 s de latence.
 *  DB     — coupure de PostgreSQL (sudo systemctl stop/start) 30 s sous charge, watcher actif, 1 run.
 *
 * Usage : node canary-simulation/simulation/oracle-faults.mjs --only F1,F2,F3,F4,F5   |   --only DB
 * Preuves : evidences/oracle-faults-<ISO>/{journal.jsonl,summary.json,summary.md, <run>/load.csv, <run>/events.jsonl, ...}
 *
 * Bascule du trafic v2 vers le proxy (F uniquement) : le gateway lit gateway/.env via ConfigModule (une variable deja
 * presente dans l'environnement du processus est prioritaire). Le script :
 *   - refuse de continuer si COURSES_V2_SERVICE_URL est defini dans l'environnement pm2 du gateway (le .env serait ignore) ;
 *   - sauvegarde le .env (copie <fichier>.oracle-faults.bak, chmod 600, + copie en memoire), remplace la seule ligne
 *     COURSES_V2_SERVICE_URL par http://127.0.0.1:3013, puis `pm2 restart gateway` (sans --update-env) ;
 *   - verifie que le trafic v2 traverse bien le proxy (compteurs du proxy) ;
 *   - a la fin (finally, Ctrl-C, SIGHUP) : remet le .env a l'identique (sha256 verifie), redemarre le gateway, verifie
 *     que v2 ne passe plus par le proxy, arrete le proxy, flag ON 20 %, watcher redemarre.
 *   127.0.0.1 plutot que localhost : avec Node >= 17, localhost peut se resoudre en ::1 alors que le proxy ecoute en IPv4.
 *
 * Jeton admin : UNLEASH_ADMIN_TOKEN de l'environnement, sinon ~/.canary-secrets. Jamais journalise.
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const cfg = {
  gatewayUrl: process.env.GATEWAY_URL || 'http://127.0.0.1:3000/api/courses',
  v1DirectUrl: process.env.V1_DIRECT_URL || 'http://127.0.0.1:3002/courses',
  v2DirectUrl: process.env.V2_DIRECT_URL || 'http://127.0.0.1:3012/courses',
  proxyPort: Number(process.env.FAULT_PORT || 3013),
  proxyTarget: process.env.FAULT_TARGET || 'http://127.0.0.1:3012',
  proxyScript: path.join(ROOT, 'canary-simulation/fault-proxy/fault-proxy.mjs'),
  summarizeScript: path.join(HERE, 'summarize.js'),
  unleashUrl: (process.env.UNLEASH_ADMIN_URL || 'http://127.0.0.1:4242').replace(/\/$/, ''),
  unleashHealthUrl: process.env.UNLEASH_HEALTH_URL || 'http://127.0.0.1:4242/health',
  flag: process.env.FLAG || 'courses-v2-canary',
  project: process.env.PROJECT || 'default',
  environment: process.env.ENVIRONMENT || 'development',
  pm2: process.env.PM2_BIN || 'pm2',
  names: { unleash: process.env.UNLEASH_PM2_NAME || 'unleash', gateway: process.env.GATEWAY_PM2_NAME || 'gateway', v2: process.env.V2_PM2_NAME || 'courses-v2', watcher: process.env.WATCHER_NAME || 'rollback-watcher' },
  gatewayEnvFile: process.env.GATEWAY_ENV_FILE || '', // sinon deduit de pm2 (--env-file ou <cwd>/.env)
  pg: { service: process.env.PG_SERVICE || '', host: process.env.PGHOST_CHECK || '127.0.0.1', port: Number(process.env.PGPORT_CHECK || 5432), pm2Name: process.env.PG_CONTROL_PM2 || '' /* test local uniquement */ },
  rollout: 20, users: 200, rps: 20, requestTimeoutMs: 6000, // comme load.js
  propagationWaitMs: 3000, windowClearMs: 11000, // fenetre du gateway 10 s : on la laisse se vider entre deux runs
  f: { durationS: 70, faultAtS: 20, runs: Number(process.env.F_RUNS || 3) },
  db: { faultAtS: 20, outageS: 30, afterS: 40 },
  evidenceRoot: process.env.EVIDENCE_DIR || path.join(ROOT, 'evidences'),
};
const SCENARIOS = {
  F1: { errorRate: 1, latencyMs: 0, expectRollback: true, label: '100 % de 500' },
  F2: { errorRate: 0.6, latencyMs: 0, expectRollback: true, label: '60 % de 500' },
  F3: { errorRate: 0.3, latencyMs: 0, expectRollback: false, label: '30 % de 500' },
  F4: { errorRate: 0, latencyMs: 2000, expectRollback: false, label: '+2 s de latence (< delai 3 s)' },
  F5: { errorRate: 0, latencyMs: 4000, expectRollback: true, label: '+4 s de latence (> delai 3 s)' },
};
const onlyArg = process.argv.indexOf('--only');
const ONLY = (onlyArg > 0 ? process.argv[onlyArg + 1] : '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const F_LIST = ONLY.filter((s) => SCENARIOS[s]);
const DO_DB = ONLY.includes('DB');

function readAdminToken() {
  if (process.env.UNLEASH_ADMIN_TOKEN) return { token: process.env.UNLEASH_ADMIN_TOKEN, source: 'env' };
  const file = process.env.CANARY_SECRETS || path.join(os.homedir(), '.canary-secrets');
  if (!fs.existsSync(file)) return { token: '', source: file };
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?UNLEASH_ADMIN_TOKEN\s*=\s*(.*)\s*$/);
    if (m) return { token: m[1].replace(/^['"]|['"]$/g, ''), source: file };
  }
  return { token: '', source: file };
}
const { token: ADMIN_TOKEN, source: TOKEN_SOURCE } = readAdminToken();

// ---------- journal ----------
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(cfg.evidenceRoot, `oracle-faults-${STAMP}`);
fs.mkdirSync(OUT, { recursive: true });
const JOURNAL = path.join(OUT, 'journal.jsonl');
/** Masque le jeton admin et toute URL avec identifiants (postgres://user:mdp@...). */
const redact = (s) => {
  let t = String(s);
  if (ADMIN_TOKEN) t = t.split(ADMIN_TOKEN).join('***');
  return t.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s:@/"']+:[^\s@/"']+@/gi, '$1***:***@');
};
const QUIET = new Set(['request', 'health_poll']);
function log(event, extra = {}) {
  const line = redact(JSON.stringify({ event, at: Date.now(), iso: new Date().toISOString(), ...extra }));
  fs.appendFileSync(JOURNAL, line + '\n');
  if (!QUIET.has(event)) { try { console.log(line.length > 400 ? line.slice(0, 400) + '…' : line); } catch { /* terminal ferme (SSH coupe) */ } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s2 = (ms) => (ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(2)} s`);
let aborted = false;
let touched = false; // passe a vrai juste avant la premiere action : sans action, la restauration ne fait rien
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const guard = (what) => { if (aborted) throw new Error(`interrompu : ${what} annule`); };

// ---------- HTTP ----------
const USERS = Array.from({ length: cfg.users }, (_, i) => `user-${String(i + 1).padStart(3, '0')}`);
async function getAs(user, url = cfg.gatewayUrl, timeoutMs = cfg.requestTimeoutMs) {
  const sent = Date.now();
  const t0 = performance.now();
  let status = 0;
  let version = '';
  let body;
  try {
    const res = await fetch(url, { headers: { 'X-User-Id': user }, signal: AbortSignal.timeout(timeoutMs) });
    status = res.status;
    version = res.headers.get('x-backend-version') || '';
    const text = await res.text();
    if (status !== 200) body = redact(text).slice(0, 500);
  } catch (e) {
    status = e.name === 'TimeoutError' ? 599 : 0; // memes conventions que load.js
  }
  return { sent, user, status, version, lat: Math.round(performance.now() - t0), ...(body !== undefined ? { body } : {}) };
}
const isErr = (r) => r.status === 0 || r.status === 599 || r.status >= 500; // meme definition que summarize.js / le gateway
const ok200 = async (url) => (await getAs('probe', url, 1500)).status === 200;
async function unleashHealth() {
  const t0 = performance.now();
  try { const r = await fetch(cfg.unleashHealthUrl, { signal: AbortSignal.timeout(2000) }); const b = await r.text(); return { status: r.status, ms: Math.round(performance.now() - t0), body: redact(b).slice(0, 200) }; }
  catch (e) { return { status: 0, ms: Math.round(performance.now() - t0), error: String(e.cause?.code || e.name) }; }
}
async function waitFor(name, fn, timeoutMs, everyMs) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const tp = performance.now();
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return { ok: true, elapsedMs: Math.round(performance.now() - t0), value: v };
    await sleep(Math.max(0, tp + everyMs - performance.now()));
  }
  log('wait_timeout', { name, timeoutMs });
  return { ok: false, elapsedMs: null, value: null };
}
function tcpOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Charge a debit constant (comme load.js) : rows = {sent,user,status,version,lat[,body]}. */
function startLoad(rps) {
  const rows = [];
  const pending = new Set();
  let n = 0;
  let stopped = false;
  const t0 = performance.now();
  (async () => {
    while (!stopped) {
      const user = USERS[n % USERS.length];
      n++;
      const p = getAs(user).then((r) => rows.push(r));
      pending.add(p); p.finally(() => pending.delete(p));
      await sleep(Math.max(0, t0 + n * (1000 / rps) - performance.now()));
    }
  })();
  return { rows, stop: async () => { stopped = true; await Promise.all([...pending]); rows.sort((a, b) => a.sent - b.sent); } };
}
/** CSV au format de load.js : summarize.js peut le relire tel quel. */
function writeCsv(file, rows) {
  fs.writeFileSync(file, 'sent_ms,user,status,version,latency_ms\n' + rows.map((r) => `${r.sent},${r.user},${r.status},${r.version},${r.lat}`).join('\n') + '\n');
}
const pct = (list, p) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
function stats(rows) {
  const by = {};
  for (const v of ['v1', 'v2', '']) {
    const l = rows.filter((r) => r.version === v);
    by[v || 'sansVersion'] = { requests: l.length, errors: l.filter(isErr).length, non200: l.filter((r) => r.status !== 200).length, p50Ms: pct(l.map((r) => r.lat), 50), p95Ms: pct(l.map((r) => r.lat), 95) };
  }
  return by;
}

// ---------- API admin Unleash ----------
const ENV_URL = () => `${cfg.unleashUrl}/api/admin/projects/${cfg.project}/features/${cfg.flag}/environments/${cfg.environment}`;
async function admin(method, url, body) {
  const res = await fetch(url, { method, headers: { Authorization: ADMIN_TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(cfg.unleashUrl, '')} -> HTTP ${res.status} ${redact(text).slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const getFlagEnv = () => admin('GET', ENV_URL());
function rolloutStrategy(st) {
  const list = (st.strategies || []).filter((s) => s.name === 'flexibleRollout' && !s.disabled);
  if (list.length !== 1) throw new Error(`attendu 1 strategie flexibleRollout active, trouve ${list.length}`);
  return list[0];
}
const strategyBody = (s, params) => ({ name: s.name, title: s.title ?? null, disabled: s.disabled ?? false, sortOrder: s.sortOrder, constraints: s.constraints ?? [], segments: s.segments ?? [], variants: s.variants ?? [], parameters: { ...s.parameters, ...params } });
async function flagOn20() {
  const st = await getFlagEnv();
  const s = rolloutStrategy(st);
  if (s.parameters.rollout !== String(cfg.rollout)) await admin('PUT', `${ENV_URL()}/strategies/${s.id}`, strategyBody(s, { rollout: String(cfg.rollout) }));
  if (!st.enabled) await admin('POST', `${ENV_URL()}/on`);
  const fin = await getFlagEnv();
  const ok = fin.enabled === true && rolloutStrategy(fin).parameters.rollout === String(cfg.rollout);
  log('flag_on_20', { ok, enabled: fin.enabled, rollout: rolloutStrategy(fin).parameters.rollout });
  if (!ok) throw new Error('impossible de mettre le flag ON a 20 %');
}

// ---------- pm2 ----------
async function pm2(args) {
  const [bin, pre] = cfg.pm2.endsWith('.js') ? [process.execPath, [cfg.pm2]] : [cfg.pm2, []];
  const { stdout } = await execFileP(bin, [...pre, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  return stdout;
}
async function pm2Act(args) { guard(`pm2 ${args.join(' ')}`); log('pm2_action', { args }); return pm2(args); }
/** Champs reduits, jamais l'environnement. `v2UrlInPm2Env` = booleen seulement (presence de la variable). */
async function pm2Snapshot() {
  try {
    const raw = await pm2(['jlist']);
    return JSON.parse(raw.slice(raw.indexOf('['))).map((p) => ({
      name: p.name, pid: p.pid, status: p.pm2_env?.status, restarts: p.pm2_env?.restart_time, startedAt: p.pm2_env?.pm_uptime,
      cwd: p.pm2_env?.pm_cwd, nodeArgs: (p.pm2_env?.node_args || []).filter((a) => /^--env-file/.test(a)),
      outLog: p.pm2_env?.pm_out_log_path, errLog: p.pm2_env?.pm_err_log_path,
      v2UrlInPm2Env: p.pm2_env?.env?.COURSES_V2_SERVICE_URL !== undefined || p.pm2_env?.COURSES_V2_SERVICE_URL !== undefined,
    }));
  } catch (e) {
    log('pm2_unavailable', { error: redact(String(e.message || e)).slice(0, 200) });
    return null;
  }
}
const proc = (snap, name) => snap?.find((p) => p.name === name) ?? null;
const slim = (snap) => snap?.map(({ name, pid, status, restarts, startedAt }) => ({ name, pid, status, restarts, startedAt }));
function pm2Diff(before, after, ignore = []) {
  if (!before || !after) return { ok: false, reason: 'pm2 indisponible', changed: [] };
  const changed = before.filter((b) => !ignore.includes(b.name)).filter((b) => {
    const a = proc(after, b.name);
    return !a || a.pid !== b.pid || a.restarts !== b.restarts || a.startedAt !== b.startedAt || a.status !== b.status;
  }).map((b) => ({ name: b.name, before: { pid: b.pid, restarts: b.restarts, status: b.status }, after: proc(after, b.name) && { pid: proc(after, b.name).pid, restarts: proc(after, b.name).restarts, status: proc(after, b.name).status } }));
  return { ok: changed.length === 0, changed, checked: before.filter((b) => !ignore.includes(b.name)).map((b) => b.name) };
}
// Lecture des journaux pm2 a partir d'un decalage (lignes ajoutees pendant le run).
const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
function readSince(f, offset) {
  try { const fd = fs.openSync(f, 'r'); const size = fs.fstatSync(fd).size; if (size <= offset) { fs.closeSync(fd); return ''; } const buf = Buffer.alloc(size - offset); fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd); return buf.toString('utf8'); }
  catch { return ''; }
}
const jsonLines = (text) => text.split(/\r?\n/).map((l) => { const i = l.indexOf('{'); if (i < 0) return null; try { return JSON.parse(l.slice(i)); } catch { return null; } }).filter(Boolean);

// ---------- configuration du watcher (AUTO_RECOVERY=0 pendant les tests, puis configuration d'origine) ----------
// pm2 `restart --update-env` FUSIONNE l'environnement de la commande pm2 dans celui du processus (Utility.extend) :
// il ajoute / remplace des cles mais n'en retire jamais. On lance donc la commande pm2 avec EXACTEMENT l'environnement
// d'origine du watcher (lu dans pm2 jlist, garde en memoire, jamais journalise), en ne changeant que des VALEURS de cles
// deja presentes : aucune cle n'est ajoutee, et un second restart avec l'environnement d'origine le remet a l'identique.
// pm2 est lance via node + chemin reel de son script, pour ne pas dependre du PATH de cet environnement.
let watcherCfg = null; // { orig, origHash, changed: [cles], applied }
const envHash = (e) => sha(JSON.stringify(Object.keys(e).sort().map((k) => [k, typeof e[k] === 'string' ? e[k] : JSON.stringify(e[k])])));
const stringsOnly = (e) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === 'string'));
function pm2Script() {
  if (cfg.pm2.endsWith('.js')) return cfg.pm2;
  const cands = path.isAbsolute(cfg.pm2) ? [cfg.pm2] : (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, cfg.pm2));
  const bin = cands.find((c) => fs.existsSync(c));
  if (!bin) throw new Error('binaire pm2 introuvable dans le PATH');
  return fs.realpathSync(bin); // .../lib/node_modules/pm2/bin/pm2 (script node)
}
async function pm2WithEnv(args, env, guarded = true) {
  if (guarded) guard(`pm2 ${args.join(' ')}`);
  log('pm2_action', { args, env: "environnement d'origine du watcher (non journalise)" });
  await execFileP(process.execPath, [pm2Script(), ...args], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
}
async function watcherRaw() {
  const raw = await pm2(['jlist']);
  const p = JSON.parse(raw.slice(raw.indexOf('['))).find((x) => x.name === cfg.names.watcher);
  if (!p) throw new Error(`${cfg.names.watcher} introuvable dans pm2`);
  return { env: { ...(p.pm2_env?.env || {}) }, outLog: p.pm2_env?.pm_out_log_path, status: p.pm2_env?.status };
}
async function watcherStartedLine(outLog, offset) {
  const w = await waitFor('watcher_started', () => jsonLines(readSince(outLog, offset)).find((e) => e.event === 'watcher_started'), 15000, 300);
  return w.value;
}
async function watcherToTestConfig() {
  const { env: orig, outLog } = await watcherRaw();
  const test = stringsOnly(orig);
  const changed = [];
  if (orig.AUTO_RECOVERY !== undefined && orig.AUTO_RECOVERY !== '0') { test.AUTO_RECOVERY = '0'; changed.push('AUTO_RECOVERY'); }
  // EVENTS_FILE pointe peut-etre vers ~/canary-results/E-<run>/events.jsonl : on n'y ecrit pas les evenements des tests.
  if (typeof orig.EVENTS_FILE === 'string' && orig.EVENTS_FILE) { test.EVENTS_FILE = path.join(OUT, 'watcher-events.jsonl'); changed.push('EVENTS_FILE'); }
  watcherCfg = { orig, origHash: envHash(orig), changed, applied: false };
  log('watcher_config_initial', { keys: Object.keys(orig).length, AUTO_RECOVERY: orig.AUTO_RECOVERY ?? '(absent : desactive par defaut)', EVENTS_FILE: orig.EVENTS_FILE ?? '(absent)', tokenPresent: !!orig.UNLEASH_ADMIN_TOKEN, envHash: watcherCfg.origHash.slice(0, 12) });
  if (!changed.length) { log('watcher_config_unchanged', { reason: "AUTO_RECOVERY absent ou deja a 0, pas d'EVENTS_FILE" }); return; }
  touched = true;
  const off = fileSize(outLog);
  watcherCfg.applied = true;
  await pm2WithEnv(['restart', cfg.names.watcher, '--update-env'], test);
  const after = (await watcherRaw()).env;
  const added = Object.keys(after).filter((k) => !(k in orig));
  const modified = Object.keys(orig).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(orig[k]));
  const line = await watcherStartedLine(outLog, off);
  log('watcher_config_test', { AUTO_RECOVERY: after.AUTO_RECOVERY, EVENTS_FILE: after.EVENTS_FILE, addedKeys: added, modifiedKeys: modified, watcherSaysAutoRecovery: line?.autoRecovery ?? null });
  if (added.length) throw new Error(`pm2 a ajoute des variables au watcher (${added.join(', ')}) : restauration exacte impossible, arret`);
  if (modified.some((k) => !changed.includes(k))) throw new Error(`variables modifiees inattendues : ${modified.join(', ')}`);
  if (!line || line.autoRecovery !== false) throw new Error('le watcher ne confirme pas autoRecovery=false');
}
async function restoreWatcherConfig() {
  if (!watcherCfg?.applied) return { needed: false };
  const { outLog } = await watcherRaw();
  const off = fileSize(outLog);
  await pm2WithEnv(['restart', cfg.names.watcher, '--update-env'], stringsOnly(watcherCfg.orig), false); // pas de guard : doit passer apres Ctrl-C
  const w = await watcherRaw();
  const diff = [...new Set([...Object.keys(w.env), ...Object.keys(watcherCfg.orig)])].filter((k) => JSON.stringify(w.env[k]) !== JSON.stringify(watcherCfg.orig[k]));
  const line = await watcherStartedLine(outLog, off);
  const expectAuto = watcherCfg.orig.AUTO_RECOVERY === '1';
  const out = { identical: envHash(w.env) === watcherCfg.origHash, differingKeys: diff, status: w.status, AUTO_RECOVERY: w.env.AUTO_RECOVERY, watcherSaysAutoRecovery: line?.autoRecovery ?? null };
  out.ok = out.identical && w.status === 'online' && line?.autoRecovery === expectAuto;
  log('watcher_config_restored', out);
  if (out.ok) watcherCfg.applied = false;
  return out;
}

/** Redemarre le watcher (pm2 restart garde son environnement) et lit sa ligne watcher_started. */
async function restartWatcher() {
  const w = proc(await pm2Snapshot(), cfg.names.watcher);
  if (!w) throw new Error(`${cfg.names.watcher} introuvable dans pm2`);
  const off = fileSize(w.outLog);
  await pm2Act(['restart', cfg.names.watcher]);
  const started = await waitFor('watcher_started', () => jsonLines(readSince(w.outLog, off)).find((e) => e.event === 'watcher_started'), 15000, 300);
  if (!started.ok) throw new Error('ligne watcher_started introuvable dans le journal pm2 du watcher');
  const conf = started.value;
  log('watcher_restarted', { autoRecovery: conf.autoRecovery, threshold: conf.threshold, consecutive: conf.consecutive, minRequests: conf.minRequests, intervalMs: conf.intervalMs });
  return { outLog: w.outLog, errLog: w.errLog, offset: off, errOffset: fileSize(w.errLog), conf };
}

// ---------- fault-proxy ----------
let proxyChild = null;
const PROXY = `http://127.0.0.1:${cfg.proxyPort}/__fault`;
async function proxyState() { const r = await fetch(PROXY, { signal: AbortSignal.timeout(1500) }); return r.json(); }
async function setFault(f) {
  const r = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f), signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error(`POST /__fault -> ${r.status}`);
  return r.json();
}
async function startProxy() {
  if (await tcpOpen('127.0.0.1', cfg.proxyPort)) throw new Error(`le port ${cfg.proxyPort} est deja utilise : aucune action faite`);
  touched = true;
  const logFd = fs.openSync(path.join(OUT, 'fault-proxy.log'), 'a');
  // detached : un Ctrl-C dans le terminal ne tue pas le proxy avant que le gateway soit rebascule sur :3012.
  proxyChild = spawn(process.execPath, [cfg.proxyScript], { env: { PATH: process.env.PATH, FAULT_PORT: String(cfg.proxyPort), FAULT_TARGET: cfg.proxyTarget }, detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd] });
  const up = await waitFor('fault-proxy', proxyState, 10000, 200);
  if (!up.ok) throw new Error('fault-proxy ne demarre pas');
  log('fault_proxy_started', { pid: proxyChild.pid, port: cfg.proxyPort, target: cfg.proxyTarget });
}
async function stopProxy() {
  if (proxyChild && proxyChild.exitCode === null) { try { process.kill(proxyChild.pid, 'SIGTERM'); } catch { /* deja arrete */ } }
  const down = await waitFor('fault-proxy-arrete', async () => !(await tcpOpen('127.0.0.1', cfg.proxyPort)), 5000, 200);
  if (!down.ok && proxyChild) { try { process.kill(proxyChild.pid, 'SIGKILL'); } catch { /* */ } }
  return !(await tcpOpen('127.0.0.1', cfg.proxyPort));
}

// ---------- bascule du gateway (.env) ----------
let envSwitch = null; // { files: [{file, original, sha, mode, bak}] }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const V2_LINE = /^COURSES_V2_SERVICE_URL=.*$/m;
async function gatewayEnvFiles() {
  const gw = proc(await pm2Snapshot(), cfg.names.gateway);
  if (!gw) throw new Error('gateway introuvable dans pm2');
  if (gw.v2UrlInPm2Env) throw new Error('COURSES_V2_SERVICE_URL est defini dans l\'environnement pm2 du gateway : modifier le .env serait sans effet. Aucune action faite.');
  const cands = cfg.gatewayEnvFile ? [cfg.gatewayEnvFile] : [...gw.nodeArgs.map((a) => a.split('=').slice(1).join('=')), path.join(gw.cwd || '', '.env')];
  const files = [...new Set(cands.map((f) => path.resolve(f)))].filter((f) => fs.existsSync(f) && V2_LINE.test(fs.readFileSync(f, 'utf8')));
  if (!files.length) throw new Error(`aucun .env du gateway ne contient COURSES_V2_SERVICE_URL (cherche : ${cands.join(', ')}). Aucune action faite.`);
  return files;
}
async function waitGatewayV2() {
  // Le gateway repond ET le SDK est pret (au moins un utilisateur servi par v2 en 200).
  return waitFor('gateway-v2', async () => { for (const u of USERS.slice(0, 40)) { const r = await getAs(u); if (r.version === 'v2' && r.status === 200) return r.user; } return null; }, 60000, 1000);
}
async function switchGatewayToProxy() {
  const files = await gatewayEnvFiles();
  envSwitch = { files: [] };
  for (const file of files) {
    const original = fs.readFileSync(file);
    const bak = `${file}.oracle-faults.bak`;
    fs.writeFileSync(bak, original, { mode: 0o600 });
    envSwitch.files.push({ file, original, sha: sha(original), mode: fs.statSync(file).mode, bak, line: original.toString('utf8').match(V2_LINE)[0] });
    fs.writeFileSync(file, original.toString('utf8').replace(V2_LINE, `COURSES_V2_SERVICE_URL=http://127.0.0.1:${cfg.proxyPort}`));
    log('gateway_env_switched', { file, from: envSwitch.files.at(-1).line, to: `COURSES_V2_SERVICE_URL=http://127.0.0.1:${cfg.proxyPort}`, backup: bak });
  }
  await pm2Act(['restart', cfg.names.gateway]);
  const ready = await waitGatewayV2();
  if (!ready.ok) throw new Error('apres bascule, aucun utilisateur servi par v2');
  const before = (await proxyState()).counters.requests;
  for (let i = 0; i < 3; i++) await getAs(ready.value);
  const after = (await proxyState()).counters.requests;
  const through = after - before;
  log('gateway_via_proxy_check', { user: ready.value, proxyRequests: through });
  if (through < 3) throw new Error(`le trafic v2 ne traverse pas le proxy (${through}/3 requetes vues)`);
  // Echauffement : 10 s de charge apres le redemarrage du gateway, pour que le premier run ne parte pas a froid.
  const warm = startLoad(cfg.rps);
  await sleep(10000);
  await warm.stop();
  const ws = stats(warm.rows);
  log('warmup', { v1: ws.v1, v2: ws.v2, sansVersion: ws.sansVersion });
  return { files: envSwitch.files.map((f) => f.file), verifiedUser: ready.value, warmup: ws };
}
async function restoreGatewayEnv() {
  if (!envSwitch) return { needed: false };
  const out = { needed: true, files: [] };
  for (const f of envSwitch.files) {
    fs.writeFileSync(f.file, f.original);
    try { fs.chmodSync(f.file, f.mode & 0o777); } catch { /* */ }
    const same = sha(fs.readFileSync(f.file)) === f.sha;
    out.files.push({ file: f.file, identical: same });
    if (same) { try { fs.unlinkSync(f.bak); } catch { /* */ } }
  }
  try { await flagOn20(); } catch (e) { out.flagError = String(e.message).slice(0, 200); } // apres un rollback, plus aucun utilisateur en v2 sinon
  await pm2(['restart', cfg.names.gateway]);
  const ready = await waitGatewayV2();
  let proxyHits = null;
  if (ready.ok) {
    try {
      const b = (await proxyState()).counters.requests;
      for (let i = 0; i < 3; i++) await getAs(ready.value);
      proxyHits = (await proxyState()).counters.requests - b;
    } catch { proxyHits = 0; } // proxy deja arrete : v2 ne peut pas passer par lui
  }
  out.gatewayServesV2 = ready.ok;
  out.v2BypassesProxy = proxyHits === 0;
  out.ok = out.files.every((f) => f.identical) && ready.ok && proxyHits === 0;
  envSwitch = out.ok ? null : envSwitch;
  log('gateway_env_restored', out);
  return out;
}

// ---------- F1..F5 ----------
async function runF(name, run) {
  const sc = SCENARIOS[name];
  const dir = path.join(OUT, `${name}-${run}`);
  fs.mkdirSync(dir, { recursive: true });
  await setFault({ errorRate: 0, latencyMs: 0, seed: 0 });
  await flagOn20();
  const w = await restartWatcher();
  if (w.conf.autoRecovery) throw new Error('le watcher tourne avec AUTO_RECOVERY=1 : contraire au protocole F, arret');
  await sleep(cfg.windowClearMs);
  const load = startLoad(cfg.rps);
  const t0 = Date.now();
  await sleep(cfg.f.faultAtS * 1000);
  const seed = 1000 * Number(name.slice(1)) + run;
  await setFault({ errorRate: sc.errorRate, latencyMs: sc.latencyMs, seed });
  const faultAt = Date.now();
  log('fault_injected', { scenario: name, run, errorRate: sc.errorRate, latencyMs: sc.latencyMs, seed });
  await sleep(Math.max(0, t0 + cfg.f.durationS * 1000 - Date.now()));
  await load.stop();
  const proxy = await proxyState();
  await setFault({ errorRate: 0, latencyMs: 0, seed: 0 });

  const wEvents = jsonLines(readSince(w.outLog, w.offset)).filter((e) => e.at >= t0 - 15000);
  const events = [{ event: 'fault_injected', at: faultAt }, ...wEvents.filter((e) => e.event !== 'watcher_started')];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  writeCsv(path.join(dir, 'load.csv'), load.rows);
  let summarize = null;
  try { summarize = JSON.parse((await execFileP(process.execPath, [cfg.summarizeScript, path.join(dir, 'load.csv'), path.join(dir, 'events.jsonl')])).stdout); }
  catch (e) { log('summarize_failed', { error: String(e.message).slice(0, 200) }); }

  const first = (ev) => wEvents.find((e) => e.event === ev && e.at >= faultAt);
  const trig = first('rollback_triggered');
  const dis = first('flag_disabled');
  const rows = load.rows;
  const before = rows.filter((r) => r.sent < faultAt);
  const during = rows.filter((r) => r.sent >= faultAt && (!dis || r.sent < dis.at));
  const after = dis ? rows.filter((r) => r.sent >= dis.at) : [];
  const res = {
    scenario: name, run, seed, faultAt: new Date(faultAt).toISOString(),
    rollback: !!dis, rollbackTriggered: !!trig,
    triggerDelayMs: trig ? trig.at - faultAt : null, disableDelayMs: dis ? dis.at - faultAt : null,
    breaches: wEvents.filter((e) => e.event === 'breach' && e.at >= faultAt).length,
    flagCallFailures: wEvents.filter((e) => e.event === 'flag_call_failed').length,
    before: stats(before), during: stats(during), after: dis ? stats(after) : null,
    v1ErrorsTotal: rows.filter((r) => r.version === 'v1' && isErr(r)).length,
    baselineDegraded: before.some(isErr) || (pct(before.map((r) => r.lat), 95) ?? 0) > 1000, // le run etait-il sain AVANT l'injection ?
    v2ErrorsAfterFault: rows.filter((r) => r.version === 'v2' && isErr(r) && r.sent >= faultAt).length,
    errorBodies: [...new Set(rows.filter((r) => r.body).map((r) => `${r.status} ${r.body}`))].slice(0, 5),
    proxyCounters: proxy.counters, summarize,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), redact(JSON.stringify(res, null, 2)));
  log('F_run_done', { scenario: name, run, rollback: res.rollback, triggerDelayMs: res.triggerDelayMs, disableDelayMs: res.disableDelayMs, v1ErrorsTotal: res.v1ErrorsTotal, v2ErrorsAfterFault: res.v2ErrorsAfterFault, p95v2Before: res.before.v2.p95Ms, p95v2During: res.during.v2.p95Ms });
  return res;
}
function verdictF(name, runs) {
  const sc = SCENARIOS[name];
  const rb = runs.filter((r) => r.rollback).length;
  const v1err = runs.reduce((n, r) => n + r.v1ErrorsTotal, 0);
  const pass = sc.expectRollback ? rb === runs.length && v1err === 0 && runs.length === cfg.f.runs : rb === 0 && runs.length === cfg.f.runs;
  const st = (key) => { const v = runs.map((r) => r[key]).filter((x) => x !== null); return v.length ? `moy. ${s2(v.reduce((a, b) => a + b, 0) / v.length)} (${s2(Math.min(...v))} – ${s2(Math.max(...v))})` : 'n/a'; };
  const p95 = (phase, ver) => runs.map((r) => r[phase]?.[ver]?.p95Ms ?? '-').join('/');
  const obs = [
    `rollback ${rb}/${runs.length}`,
    sc.expectRollback ? `declenchement ${st('triggerDelayMs')}, desactivation ${st('disableDelayMs')} apres l'injection` : `${runs.map((r) => r.breaches).join('/')} controle(s) en depassement`,
    `erreurs v1 ${runs.map((r) => r.v1ErrorsTotal).join('/')}`,
    `erreurs v2 apres injection ${runs.map((r) => r.v2ErrorsAfterFault).join('/')} (sur ${runs.map((r) => r.during.v2.requests + (r.after?.v2.requests ?? 0)).join('/')} req. v2)`,
    `p95 avant v1 ${p95('before', 'v1')} ms, v2 ${p95('before', 'v2')} ms ; pendant v1 ${p95('during', 'v1')} ms, v2 ${p95('during', 'v2')} ms`,
  ];
  if (runs.some((r) => r.baselineDegraded)) obs.push(`ATTENTION base degradee avant injection (erreurs ou p95 > 1 s) au(x) run(s) ${runs.filter((r) => r.baselineDegraded).map((r) => r.run).join(',')} : resultat non interpretable`);
  if (runs.some((r) => r.flagCallFailures)) obs.push(`appels flag en echec ${runs.map((r) => r.flagCallFailures).join('/')}`);
  return { pass, rb, v1err, observed: obs.join(' ; '), criterion: sc.expectRollback ? `rollback ${cfg.f.runs}/${cfg.f.runs}, 0 erreur v1` : `0 rollback sur ${cfg.f.runs}` };
}

// ---------- DB ----------
async function pgControl() {
  if (cfg.pg.pm2Name) return { kind: 'pm2', name: cfg.pg.pm2Name, stop: () => pm2Act(['stop', cfg.pg.pm2Name]), start: () => pm2(['start', cfg.pg.pm2Name]), isActive: async () => proc(await pm2Snapshot(), cfg.pg.pm2Name)?.status === 'online' };
  // 1. nom exact du service systemd
  let units = [];
  try {
    const { stdout } = await execFileP('systemctl', ['list-unit-files', 'postgresql*', '--no-legend', '--no-pager', '--plain'], { encoding: 'utf8' });
    units = stdout.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((u) => /^postgresql.*\.service$/.test(u));
  } catch (e) { throw new Error(`systemctl indisponible : ${String(e.message).slice(0, 150)}. Aucune action faite.`); }
  const svc = cfg.pg.service || ['postgresql-16.service', 'postgresql.service'].find((u) => units.includes(u));
  if (!svc) throw new Error(`service PostgreSQL introuvable (unites : ${units.join(', ') || 'aucune'}). Indiquer PG_SERVICE=... Aucune action faite.`);
  // 2. sudo sans mot de passe pour exactement ces deux commandes, verifie AVANT toute action
  for (const verb of ['stop', 'start']) {
    try { await execFileP('sudo', ['-n', '-l', 'systemctl', verb, svc], { encoding: 'utf8' }); }
    catch { throw new Error(`sudo demande un mot de passe (ou n'autorise pas "systemctl ${verb} ${svc}"). Lance "sudo -v" dans ce terminal puis relance le script. Aucune action faite.`); }
  }
  const isActive = async () => { try { const { stdout } = await execFileP('systemctl', ['is-active', svc], { encoding: 'utf8' }); return stdout.trim() === 'active'; } catch { return false; } };
  return { kind: 'systemd', name: svc, units, stop: () => { guard('systemctl stop'); log('pg_action', { verb: 'stop', svc }); return execFileP('sudo', ['-n', 'systemctl', 'stop', svc]); }, start: () => { log('pg_action', { verb: 'start', svc }); return execFileP('sudo', ['-n', 'systemctl', 'start', svc]); }, isActive };
}
const LEAK = /prisma|postgres|psql|5432|ECONNREFUSED|ECONNRESET|ETIMEDOUT|node_modules|\bat [\w.<>]+ \(|\.(ts|js):\d+|stack|P10\d\d|database|connection (refused|terminated)|127\.0\.0\.1:\d+|localhost:\d+|https?:\/\//i;
let pgCtl = null;

async function runDB() {
  pgCtl ??= await pgControl(); // echoue proprement avant toute action si sudo / service KO
  log('pg_control', { kind: pgCtl.kind, service: pgCtl.name, units: pgCtl.units });
  if (!(await pgCtl.isActive()) || !(await tcpOpen(cfg.pg.host, cfg.pg.port))) throw new Error('PostgreSQL n\'est pas actif au depart. Aucune action faite.');
  touched = true;
  const dir = path.join(OUT, 'DB-1');
  fs.mkdirSync(dir, { recursive: true });
  await flagOn20();
  const w = await restartWatcher();
  const snap0 = await pm2Snapshot();
  const gw = proc(snap0, cfg.names.gateway);
  const un = proc(snap0, cfg.names.unleash);
  const offs = { gwOut: fileSize(gw?.outLog), gwErr: fileSize(gw?.errLog), unOut: fileSize(un?.outLog), unErr: fileSize(un?.errLog) };
  await sleep(cfg.windowClearMs);

  const total = (cfg.db.faultAtS + cfg.db.outageS + cfg.db.afterS) * 1000;
  const load = startLoad(cfg.rps);
  const t0 = Date.now();
  // Sondes a 1 s : sante Unleash, port PostgreSQL, v1 et v2 en direct (sans le gateway)
  const probes = [];
  let probing = true;
  (async () => { while (probing) { const t = Date.now(); const [h, pgUp, d1, d2] = await Promise.all([unleashHealth(), tcpOpen(cfg.pg.host, cfg.pg.port), getAs('probe', cfg.v1DirectUrl, 3000), getAs('probe', cfg.v2DirectUrl, 3000)]); const p = { at: t, unleash: h, pgUp, v1: d1.status, v2: d2.status, v1Body: d1.body, v2Body: d2.body }; probes.push(p); log('health_poll', p); await sleep(Math.max(0, t + 1000 - Date.now())); } })();
  await sleep(cfg.db.faultAtS * 1000);
  await pgCtl.stop();
  const stopAt = Date.now();
  const down = await waitFor('pg-down', async () => !(await tcpOpen(cfg.pg.host, cfg.pg.port)), 15000, 200);
  log('pg_stopped', { portClosedAfterMs: down.elapsedMs });
  await sleep(Math.max(0, stopAt + cfg.db.outageS * 1000 - Date.now()));
  await pgCtl.start();
  const startAt = Date.now();
  const up = await waitFor('pg-up', () => tcpOpen(cfg.pg.host, cfg.pg.port), 60000, 200);
  log('pg_started', { portOpenAfterMs: up.elapsedMs });
  await sleep(Math.max(0, t0 + total - Date.now()));
  await load.stop();
  probing = false;
  await sleep(1200);
  const snap1 = await pm2Snapshot();
  writeCsv(path.join(dir, 'load.csv'), load.rows);

  const rows = load.rows;
  const outage = rows.filter((r) => r.sent >= stopAt && r.sent < startAt);
  const errs = rows.filter((r) => r.status !== 200);
  const bodies = {};
  for (const r of errs) { const k = `${r.version || '-'} ${r.status} ${r.body ?? ''}`; bodies[k] = (bodies[k] || 0) + 1; }
  const bodyList = Object.entries(bodies).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
    const [ver, status, ...rest] = k.split(' ');
    const body = rest.join(' ');
    let parsed = null; try { parsed = JSON.parse(body); } catch { /* pas du JSON */ }
    return { version: ver, status: +status, count: n, body, leak: LEAK.test(body) ? body.match(LEAK)[0] : null, codeMessageFormat: !!(parsed && typeof parsed.code === 'string' && typeof parsed.message === 'string'), keys: parsed ? Object.keys(parsed) : null };
  });
  const firstOkAfter = (list, field) => { const r = list.find((x) => x.at >= startAt && x[field] === 200); return r ? r.at - startAt : null; };
  const firstOkLoad = (ver) => { const r = rows.find((x) => x.sent >= startAt && x.version === ver && x.status === 200); return r ? r.sent - startAt : null; };
  const lastErrLoad = (ver) => { const l = rows.filter((x) => x.version === ver && x.status !== 200); return l.length ? l.at(-1).sent - startAt : null; };
  const wEv = jsonLines(readSince(w.outLog, w.offset)).filter((e) => e.at >= t0);
  const wErr = readSince(w.errLog, w.errOffset).split('\n').filter(Boolean);
  const trig = wEv.filter((e) => e.event === 'rollback_triggered');
  const v1Around = (at) => { const l = rows.filter((r) => r.version === 'v1' && r.sent >= at - 10000 && r.sent < at); return { requests: l.length, errors: l.filter(isErr).length }; };
  const linesMatching = (file, off, re) => readSince(file, off).split('\n').filter((l) => re.test(l)).map((l) => redact(l).slice(0, 300));
  const gwUnleash = [...linesMatching(gw?.outLog, offs.gwOut, /unleash/i), ...linesMatching(gw?.errLog, offs.gwErr, /unleash/i)];
  const unErrLines = readSince(un?.errLog, offs.unErr).split('\n').filter(Boolean).map((l) => redact(l).slice(0, 300));
  const unOutLines = readSince(un?.outLog, offs.unOut).split('\n').filter((l) => /error|fail|refused|database|db/i.test(l)).map((l) => redact(l).slice(0, 300));
  const hp = probes.filter((p) => p.at >= stopAt);
  const unleashBad = hp.filter((p) => p.unleash.status !== 200);
  const restarted = pm2Diff(snap0, snap1, cfg.pg.pm2Name ? [cfg.pg.pm2Name] : []); // en local, la fausse base est un processus pm2 arrete volontairement
  const res = {
    service: pgCtl.name, stopAt: new Date(stopAt).toISOString(), startAt: new Date(startAt).toISOString(),
    pgPortClosedAfterMs: down.elapsedMs, pgPortOpenAfterStartMs: up.elapsedMs,
    load: { all: stats(rows), outage: stats(outage), statusesOutage: outage.reduce((m, r) => ((m[`${r.version || '-'}:${r.status}`] = (m[`${r.version || '-'}:${r.status}`] || 0) + 1), m), {}) },
    errorLatency: { v1: { p50Ms: pct(errs.filter((r) => r.version === 'v1').map((r) => r.lat), 50), p95Ms: pct(errs.filter((r) => r.version === 'v1').map((r) => r.lat), 95), maxMs: pct(errs.filter((r) => r.version === 'v1').map((r) => r.lat), 100) }, v2: { p50Ms: pct(errs.filter((r) => r.version === 'v2').map((r) => r.lat), 50), p95Ms: pct(errs.filter((r) => r.version === 'v2').map((r) => r.lat), 95), maxMs: pct(errs.filter((r) => r.version === 'v2').map((r) => r.lat), 100) } },
    errorBodies: bodyList,
    leaks: bodyList.filter((b) => b.leak).map((b) => ({ version: b.version, status: b.status, match: b.leak, body: b.body })),
    recovery: {
      viaGateway: { v1FirstOkMs: firstOkLoad('v1'), v2FirstOkMs: firstOkLoad('v2'), v1LastErrorMs: lastErrLoad('v1'), v2LastErrorMs: lastErrLoad('v2'), v2RequestsAfterRestart: rows.filter((r) => r.sent >= startAt && r.version === 'v2').length },
      direct: { v1FirstOkMs: firstOkAfter(probes, 'v1'), v2FirstOkMs: firstOkAfter(probes, 'v2') },
    },
    pm2: { restarted, before: slim(snap0), after: slim(snap1) },
    watcher: {
      breaches: wEv.filter((e) => e.event === 'breach').length, rollbackTriggered: trig.length,
      flagCallFailed: wEv.filter((e) => e.event === 'flag_call_failed').map((e) => e.status ?? e.error).slice(0, 10), flagCallFailedCount: wEv.filter((e) => e.event === 'flag_call_failed').length,
      rollbackFailed: wEv.filter((e) => e.event === 'rollback_failed').length, flagDisabled: wEv.filter((e) => e.event === 'flag_disabled').map((e) => new Date(e.at).toISOString()),
      metricsUnreachable: wEv.filter((e) => e.event === 'metrics_unreachable').length, stderrLines: wErr.length, stderrSample: wErr.slice(0, 3).map((l) => redact(l).slice(0, 300)),
      triggers: trig.map((e) => ({ at: new Date(e.at).toISOString(), sinceStopMs: e.at - stopAt, v2ErrorRate: e.errorRate, v1Previous10s: v1Around(e.at) })),
    },
    unleash: { healthNon200: unleashBad.length, healthPolls: hp.length, firstBadSinceStopMs: unleashBad[0] ? unleashBad[0].at - stopAt : null, healthSamples: [...new Map(hp.map((p) => [`${p.unleash.status} ${p.unleash.body ?? p.unleash.error}`, p.unleash])).values()].slice(0, 4), healthBackAfterStartMs: (() => { const r = probes.find((p) => p.at >= startAt && p.unleash.status === 200); return r ? r.at - startAt : null; })(), errLogLines: unErrLines.length, errLogSample: unErrLines.slice(0, 3), outLogErrorSample: unOutLines.slice(0, 3) },
    gateway: { unleashLogLines: gwUnleash.length, unleashLogSample: gwUnleash.slice(0, 3) },
  };
  res.falseAttribution = res.watcher.triggers.some((t) => t.v1Previous10s.errors > 0);
  const recovered = res.recovery.viaGateway.v1FirstOkMs !== null && (res.recovery.viaGateway.v2FirstOkMs !== null || res.recovery.direct.v2FirstOkMs !== null);
  res.criteria = { noRestart: restarted.ok, noLeak: res.leaks.length === 0, autoRecovery: recovered };
  res.verdict = Object.values(res.criteria).every(Boolean) ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(dir, 'summary.json'), redact(JSON.stringify(res, null, 2)));
  log('DB_done', { verdict: res.verdict, criteria: res.criteria, falseAttribution: res.falseAttribution });
  return res;
}

// ---------- orchestration + restauration ----------
const results = { F: {} };
let pmInitial = null;
let watcherWasOnline = false;
let restoring = null;

async function restoreOnce() {
  const r = { steps: [] };
  if (!touched) { r.ok = true; r.skipped = 'aucune action faite : rien a restaurer'; log('restored', r); results.restore = r; return; }
  const step = async (name, fn) => { try { r.steps.push({ name, ok: true, ...((await fn()) || {}) }); } catch (e) { r.steps.push({ name, ok: false, error: redact(String(e.message || e)).slice(0, 300) }); } };
  if (pgCtl) await step('PostgreSQL actif', async () => {
    if (!(await pgCtl.isActive()) || !(await tcpOpen(cfg.pg.host, cfg.pg.port))) await pgCtl.start();
    const u = await waitFor('pg-up', () => tcpOpen(cfg.pg.host, cfg.pg.port), 60000, 500);
    if (!u.ok) throw new Error('PostgreSQL ne repond pas sur son port');
  });
  if (envSwitch) await step('gateway rebascule sur :3012', async () => { const g = await restoreGatewayEnv(); if (!g.ok) throw new Error(`restauration .env incomplete : ${JSON.stringify(g)}`); return { detail: g }; });
  if (proxyChild) await step('fault-proxy arrete', async () => { if (!(await stopProxy())) throw new Error(`le port ${cfg.proxyPort} repond encore`); });
  await step('Unleash sain', async () => {
    const snap = await pm2Snapshot();
    if (proc(snap, cfg.names.unleash) && proc(snap, cfg.names.unleash).status !== 'online') await pm2(['start', cfg.names.unleash]);
    const h = await waitFor('unleash-health', async () => (await unleashHealth()).status === 200, 120000, 1000);
    if (!h.ok) throw new Error('Unleash /health != 200');
  });
  await step("rollback-watcher : configuration d'origine", async () => {
    if (watcherCfg?.applied) { const w = await restoreWatcherConfig(); if (!w.ok) throw new Error(`configuration du watcher non restauree : ${JSON.stringify(w)}`); return { detail: w }; }
    if (!watcherWasOnline) return { note: 'ne tournait pas au depart : non relance' };
    await pm2(['restart', cfg.names.watcher]); // repart en WATCHING (il ne se rearme pas seul apres un rollback)
  });
  await step('flag ON a 20 %', async () => { const x = await waitFor('flag', async () => { await flagOn20(); return true; }, 60000, 2000); if (!x.ok) throw new Error('flag non restaure'); });
  await sleep(cfg.propagationWaitMs);
  const fin = await pm2Snapshot();
  const fl = await getFlagEnv().catch(() => null);
  const offline = (pmInitial || []).filter((p) => p.status === 'online' && proc(fin, p.name)?.status !== 'online').map((p) => p.name);
  r.final = {
    postgresql: pgCtl ? ((await pgCtl.isActive()) && (await tcpOpen(cfg.pg.host, cfg.pg.port)) ? 'actif' : 'INACTIF') : 'non touche',
    unleashHealth: (await unleashHealth()).status, flagEnabled: fl?.enabled ?? null, flagRollout: fl ? rolloutStrategy(fl).parameters.rollout : null,
    gatewayEnv: envSwitch ? 'NON RESTAURE (voir *.oracle-faults.bak)' : 'origine', proxyPortOpen: await tcpOpen('127.0.0.1', cfg.proxyPort),
    v1Direct: await ok200(cfg.v1DirectUrl), v2Direct: await ok200(cfg.v2DirectUrl), gatewayHttp: (await getAs('final-check')).status,
    watcher: proc(fin, cfg.names.watcher)?.status ?? 'absent', processesNotOnline: offline,
    watcherConfig: !watcherCfg ? 'non lue' : watcherCfg.applied ? 'NON RESTAUREE' : watcherCfg.changed.length ? `origine restauree (${watcherCfg.changed.join(', ')} remis, empreinte identique)` : 'inchangee',
  };
  const f = r.final;
  r.ok = f.postgresql !== 'INACTIF' && f.unleashHealth === 200 && f.flagEnabled === true && f.flagRollout === String(cfg.rollout) && f.gatewayEnv === 'origine' && !f.proxyPortOpen
    && f.v1Direct && f.v2Direct && f.gatewayHttp === 200 && (!watcherWasOnline || f.watcher === 'online') && offline.length === 0 && !watcherCfg?.applied;
  log('restored', r);
  results.restore = r;
}
const restore = () => (restoring ??= restoreOnce());
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, async () => {
    if (aborted) { log('interrupt_ignored', { signal: sig, note: 'restauration en cours, patienter' }); return; }
    aborted = true;
    log('interrupted', { signal: sig });
    await restore();
    writeSummary();
    process.exit(130);
  });
}

function writeSummary() {
  fs.writeFileSync(path.join(OUT, 'summary.json'), redact(JSON.stringify({ config: { ...cfg, tokenSource: TOKEN_SOURCE }, results }, null, 2)));
  const rows = [];
  for (const [name, runs] of Object.entries(results.F)) {
    const v = verdictF(name, runs);
    rows.push(`| ${name} ${SCENARIOS[name].label} | ${v.criterion} | ${v.observed} | ${v.pass ? 'PASS' : 'FAIL'} |`);
  }
  if (results.F.F3) rows.push(`| F3 limite du seuil | (information) | avec 30 % de 500 sur v2, aucun rollback : ${results.F.F3.map((r) => r.v2ErrorsAfterFault).join('/')} erreurs servies aux utilisateurs v2 en ${cfg.f.durationS - cfg.f.faultAtS} s | - |`);
  const D = results.DB;
  if (D) {
    const lk = D.leaks.length ? D.leaks.map((l) => `${l.version} ${l.status} « ${l.match} »`).join(', ') : 'aucune';
    const fmt = D.errorBodies.slice(0, 4).map((b) => `${b.version} ${b.status} x${b.count} ${b.body.slice(0, 120)}${b.codeMessageFormat ? ' [code,message]' : ` [cles : ${b.keys ? b.keys.join(',') : 'non JSON'}]`}`).join(' ; ');
    rows.push(`| DB pas de crash | aucun redemarrage pm2 | ${D.pm2.restarted.ok ? 'aucun processus redemarre' : `REDEMARRES : ${D.pm2.restarted.changed.map((c) => `${c.name} (${c.before.restarts}→${c.after?.restarts ?? '?'}, ${c.after?.status ?? 'absent'})`).join(', ')}`} | ${D.criteria.noRestart ? 'PASS' : 'FAIL'} |`);
    rows.push(`| DB pas de fuite | aucun detail technique dans les corps d'erreur | fuites : ${lk} ; corps : ${fmt || 'aucune erreur'} | ${D.criteria.noLeak ? 'PASS' : 'FAIL'} |`);
    rows.push(`| DB retour auto des 200 | 200 de retour sans action manuelle | via gateway : v1 1er 200 a ${s2(D.recovery.viaGateway.v1FirstOkMs)}, v2 ${s2(D.recovery.viaGateway.v2FirstOkMs)} (${D.recovery.viaGateway.v2RequestsAfterRestart} req. v2 apres relance) ; derniere erreur v1 ${s2(D.recovery.viaGateway.v1LastErrorMs)}, v2 ${s2(D.recovery.viaGateway.v2LastErrorMs)} ; direct : v1 ${s2(D.recovery.direct.v1FirstOkMs)}, v2 ${s2(D.recovery.direct.v2FirstOkMs)} (depuis systemctl start) | ${D.criteria.autoRecovery ? 'PASS' : 'FAIL'} |`);
    rows.push(`| DB pendant la coupure | (information) | statuts ${JSON.stringify(D.load.statusesOutage)} ; duree des erreurs p50/p95/max v1 ${D.errorLatency.v1.p50Ms}/${D.errorLatency.v1.p95Ms}/${D.errorLatency.v1.maxMs} ms, v2 ${D.errorLatency.v2.p50Ms}/${D.errorLatency.v2.p95Ms}/${D.errorLatency.v2.maxMs} ms ; Unleash /health non-200 ${D.unleash.healthNon200}/${D.unleash.healthPolls} (${D.unleash.healthSamples.map((h) => `${h.status} ${h.body ?? h.error ?? ''}`.slice(0, 60)).join(' | ')}), de retour ${s2(D.unleash.healthBackAfterStartMs)} apres le start ; gateway : ${D.gateway.unleashLogLines} ligne(s) de log Unleash | - |`);
    rows.push(`| DB watcher | (information, non juge) | ${D.watcher.breaches} depassement(s), ${D.watcher.rollbackTriggered} rollback declenche(s), ${D.watcher.flagCallFailedCount} appel(s) flag en echec (${D.watcher.flagCallFailed.join(',') || '-'}), ${D.watcher.rollbackFailed} rollback echoue(s), flag desactive : ${D.watcher.flagDisabled.join(', ') || 'non'} ; fausse attribution (rollback alors que v1 aussi en erreur) : ${D.falseAttribution ? `OUI (${D.watcher.triggers.slice(0, 3).map((t) => `a +${s2(t.sinceStopMs)} de la coupure : v1 ${t.v1Previous10s.errors}/${t.v1Previous10s.requests} en erreur sur les 10 s precedentes`).join(' ; ')}${D.watcher.triggers.length > 3 ? ` ; … ${D.watcher.triggers.length} declenchements au total` : ''})` : 'non'} | - |`);
  }
  const fin = results.restore?.final;
  if (results.restore?.skipped) rows.push(`| Etat final | rien a restaurer | ${results.restore.skipped} | - |`);
  if (fin) rows.push(`| Etat final | PostgreSQL actif, Unleash sain, flag ON 20 %, gateway sur :3012, proxy arrete, watcher dans sa configuration d'origine, processus online | PostgreSQL ${fin.postgresql} ; Unleash /health ${fin.unleashHealth} ; flag ${fin.flagEnabled ? 'ON' : 'OFF'} ${fin.flagRollout} % ; .env gateway ${fin.gatewayEnv} ; port ${cfg.proxyPort} ${fin.proxyPortOpen ? 'OUVERT' : 'ferme'} ; v1/v2 direct ${fin.v1Direct ? 200 : 'KO'}/${fin.v2Direct ? 200 : 'KO'} ; gateway HTTP ${fin.gatewayHttp} ; watcher ${fin.watcher}, configuration ${fin.watcherConfig} ; non online : ${fin.processesNotOnline.join(', ') || 'aucun'} | ${results.restore.ok ? 'PASS' : 'FAIL'} |`);
  const md = [
    `# Defauts Oracle (pm2 + nginx) — ${new Date().toISOString()}`, '',
    `Flag \`${cfg.flag}\` ON a ${cfg.rollout} %, charge ${cfg.rps} req/s sur ${cfg.users} utilisateurs. Erreur = 0 (connexion), 599 (delai client) ou >= 500. Delais du watcher lus dans son journal pm2.`, '',
    '| Cas | Critere | Resultat observe | Verdict |', '|---|---|---|---|', ...rows,
    results.fatal ? `\n**Erreur fatale :** ${results.fatal}` : '',
    '', 'Valeurs « a/b/c » = runs 1/2/3. Details par run : sous-dossiers <scenario>-<run>/ (load.csv au format de load.js, events.jsonl, summary.json avec la sortie de summarize.js).',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'summary.md'), redact(md) + '\n');
  console.log('\n' + redact(md) + `\n\nPreuves : ${OUT}`);
}

async function main() {
  if (!F_LIST.length && !DO_DB) throw new Error('preciser --only F1,F2,F3,F4,F5 et/ou --only DB');
  if (!ADMIN_TOKEN) throw new Error(`UNLEASH_ADMIN_TOKEN introuvable (ni dans l'environnement ni dans ${TOKEN_SOURCE})`);
  log('campaign_started', { only: ONLY, gatewayUrl: cfg.gatewayUrl, tokenSource: TOKEN_SOURCE, node: process.version });
  pmInitial = await pm2Snapshot();
  if (!pmInitial) throw new Error('pm2 indisponible');
  log('pm2_initial', { processes: slim(pmInitial) });
  for (const n of [cfg.names.unleash, cfg.names.gateway, cfg.names.v2, cfg.names.watcher]) {
    if (proc(pmInitial, n)?.status !== 'online') throw new Error(`processus pm2 ${n} pas online au depart (${proc(pmInitial, n)?.status ?? 'absent'}). Aucune action faite.`);
  }
  watcherWasOnline = true;
  if (DO_DB) pgCtl = await pgControl(); // controle sudo/service des le depart, avant les tests F
  if (F_LIST.length && (await tcpOpen('127.0.0.1', cfg.proxyPort))) throw new Error(`le port ${cfg.proxyPort} est deja utilise : aucune action faite`);
  await watcherToTestConfig(); // AUTO_RECOVERY=0 (et EVENTS_FILE dans les preuves) le temps des tests
  const env0 = await getFlagEnv();
  log('initial_flag', { enabled: env0.enabled, rollout: rolloutStrategy(env0).parameters.rollout });

  if (F_LIST.length) {
    await startProxy();
    results.Fsetup = await switchGatewayToProxy();
    for (const name of F_LIST) {
      results.F[name] = [];
      for (let run = 1; run <= cfg.f.runs; run++) results.F[name].push(await runF(name, run));
    }
    // Retour a la normale avant DB : gateway sur :3012, proxy arrete
    const g = await restoreGatewayEnv();
    if (!g.ok) throw new Error('restauration du .env du gateway en echec');
    if (!(await stopProxy())) throw new Error('fault-proxy toujours actif');
    proxyChild = null;
  }
  if (DO_DB) results.DB = await runDB();
}

main()
  .catch((e) => { results.fatal = redact(String(e.stack || e)); log('fatal', { error: results.fatal }); })
  .finally(async () => {
    if (aborted) return;
    await restore();
    writeSummary();
    const fOk = Object.entries(results.F).every(([n, runs]) => verdictF(n, runs).pass);
    process.exit(!results.fatal && fOk && (!DO_DB || results.DB?.verdict === 'PASS') && results.restore?.ok ? 0 : 1);
  });
