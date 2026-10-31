#!/usr/bin/env node
/**
 * Tests de resilience de la methode Oracle (pm2 + nginx), meme style que canary-parity.mjs.
 *
 *  R1 — Unleash indisponible :
 *    R1-a arret a chaud (pm2 stop unleash) : part de v2 / erreurs avant, pendant (toutes les 5 s pendant 30 s), apres.
 *    R1-b demarrage a froid du gateway sans Unleash (pm2 restart gateway), puis retour d'Unleash et delai avant ~20 % de v2.
 *    Critere : aucune erreur HTTP pendant la panne d'Unleash. La part de v2 est seulement rapportee
 *    et comparee a la phrase du rapport (« ... tout le trafic va vers v1 »).
 *  R2 — Crash de courses-v2 (kill -9 du pid) et relance automatique par pm2, x3, charge de 10 req/s sur le gateway.
 *    Criteres : relance automatique 3/3, aucune erreur cote v1 ; delais rapportes (moyenne, min–max).
 *
 * Usage : node canary-simulation/simulation/oracle-resilience.mjs [--only R1|R2]
 * Preuves : evidences/oracle-resilience-<ISO>/{journal.jsonl,summary.json,summary.md}
 *
 * Processus pm2 touches : unleash, gateway, courses-v2, rollback-watcher (arrete puis relance). Aucun autre ;
 * le script verifie a la fin que les autres processus n'ont pas bouge (pid, redemarrages, demarrage).
 * Restauration (finally + Ctrl-C) : unleash en ligne, courses-v2 et gateway en ligne, flag ON a 20 %, watcher relance.
 * Jeton admin : UNLEASH_ADMIN_TOKEN de l'environnement, sinon ~/.canary-secrets (comme canary-parity.mjs). Jamais journalise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const cfg = {
  gatewayUrl: process.env.GATEWAY_URL || 'http://127.0.0.1:3000/api/courses',
  v2DirectUrl: process.env.V2_DIRECT_URL || 'http://127.0.0.1:3012/courses', // route @Get() de CoursesController (courses/src/courses)
  unleashUrl: (process.env.UNLEASH_ADMIN_URL || 'http://127.0.0.1:4242').replace(/\/$/, ''),
  unleashHealthUrl: process.env.UNLEASH_HEALTH_URL || 'http://127.0.0.1:4242/health',
  flag: process.env.FLAG || 'courses-v2-canary',
  project: process.env.PROJECT || 'default',
  environment: process.env.ENVIRONMENT || 'development',
  pm2: process.env.PM2_BIN || 'pm2',
  names: {
    unleash: process.env.UNLEASH_PM2_NAME || 'unleash',
    gateway: process.env.GATEWAY_PM2_NAME || 'gateway',
    v2: process.env.V2_PM2_NAME || 'courses-v2',
    watcher: process.env.WATCHER_NAME || 'rollback-watcher',
  },
  rollout: 20,
  users: 200,
  propagationWaitMs: Number(process.env.PROPAGATION_WAIT_MS || 3000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 5000),
  sweepConcurrency: 10,
  r1OutageWaitMs: 5000, r1EveryMs: 5000, r1OutageMs: 30000, r1AfterMs: 30000, r1RecoverMaxMs: 60000,
  r2Trials: Number(process.env.R2_TRIALS || 3), r2Rps: 10, r2PollMs: 200, r2MaxWaitMs: 60000, r2StabilizeMs: 15000,
  evidenceRoot: process.env.EVIDENCE_DIR || path.join(ROOT, 'evidences'),
};
const TOUCHED = Object.values(cfg.names);
const onlyArg = process.argv.indexOf('--only');
const ONLY = new Set((onlyArg > 0 ? process.argv[onlyArg + 1] : 'R1,R2').split(',').map((s) => s.trim().toUpperCase()));

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
const OUT = path.join(cfg.evidenceRoot, `oracle-resilience-${STAMP}`);
fs.mkdirSync(OUT, { recursive: true });
const JOURNAL = path.join(OUT, 'journal.jsonl');
const redact = (s) => (ADMIN_TOKEN ? String(s).split(ADMIN_TOKEN).join('***') : String(s));
const QUIET = new Set(['request', 'pm2_poll', 'http_poll']);
function log(event, extra = {}) {
  const line = redact(JSON.stringify({ event, at: Date.now(), iso: new Date().toISOString(), ...extra }));
  fs.appendFileSync(JOURNAL, line + '\n');
  if (!QUIET.has(event)) console.log(line.length > 400 ? line.slice(0, 400) + '…' : line);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepUntil = (perfT) => sleep(Math.max(0, perfT - performance.now()));
const s2 = (ms) => (ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(2)} s`);

// Garde-fou Ctrl-C : apres une interruption, plus aucune action perturbatrice (stop, restart, kill).
let aborted = false;
function guard(what) { if (aborted) throw new Error(`interrompu : ${what} annule`); }

// ---------- HTTP : gateway ----------
async function getAs(user, tag) {
  const t0 = performance.now();
  let status = 0;
  let version = '';
  try {
    const res = await fetch(cfg.gatewayUrl, { headers: { 'X-User-Id': user }, signal: AbortSignal.timeout(cfg.requestTimeoutMs) });
    status = res.status;
    version = res.headers.get('x-backend-version') || '';
    await res.arrayBuffer();
  } catch (e) {
    status = e.name === 'TimeoutError' ? 599 : 0; // memes conventions que load.js
  }
  const r = { tag, user, status, version, sentPerf: +t0.toFixed(1), recvPerf: +performance.now().toFixed(1), latencyMs: +(performance.now() - t0).toFixed(1) };
  log('request', r);
  return r;
}
const isHttpError = (r) => r.status !== 200;
const USERS = Array.from({ length: cfg.users }, (_, i) => `user-${String(i + 1).padStart(3, '0')}`);
const tolPts = (pct, n) => +((3 * Math.sqrt((pct / 100) * (1 - pct / 100) / n)) * 100).toFixed(1);

/** Un GET par utilisateur (user-001..user-200), concurrence limitee ; part de v2, erreurs, statuts. */
async function sweep(tag) {
  const t0 = performance.now();
  const rows = [];
  let i = 0;
  await Promise.all(Array.from({ length: cfg.sweepConcurrency }, async () => {
    while (i < USERS.length) { const u = USERS[i++]; rows.push(await getAs(u, tag)); }
  }));
  const v2Users = rows.filter((r) => r.version === 'v2').map((r) => r.user).sort();
  const statuses = {};
  for (const r of rows) statuses[r.status] = (statuses[r.status] || 0) + 1;
  const res = {
    tag, n: rows.length, v2Count: v2Users.length, v2Pct: +((v2Users.length / rows.length) * 100).toFixed(1),
    v1Count: rows.filter((r) => r.version === 'v1').length, httpErrors: rows.filter(isHttpError).length, statuses,
    durationMs: +(performance.now() - t0).toFixed(0), v2Users,
  };
  log('sweep', { ...res, v2Users: undefined });
  return res;
}
const sameSet = (a, b) => a.length === b.length && a.every((u, k) => u === b[k]);
const near20 = (sw) => sw.httpErrors === 0 && Math.abs(sw.v2Pct - cfg.rollout) <= tolPts(cfg.rollout, sw.n);

async function waitFor(name, fn, timeoutMs, everyMs) {
  const t0 = performance.now();
  let polls = 0;
  while (performance.now() - t0 < timeoutMs) {
    const tp = performance.now();
    polls++;
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return { ok: true, elapsedMs: +(performance.now() - t0).toFixed(1), polls, value: v };
    await sleepUntil(tp + everyMs);
  }
  log('wait_timeout', { name, timeoutMs, polls });
  return { ok: false, elapsedMs: null, polls, value: null };
}
async function unleashHealthy() {
  try { const r = await fetch(cfg.unleashHealthUrl, { signal: AbortSignal.timeout(1500) }); await r.arrayBuffer(); return r.ok; } catch { return false; }
}
async function v2DirectOk() {
  try { const r = await fetch(cfg.v2DirectUrl, { signal: AbortSignal.timeout(1000) }); await r.arrayBuffer(); return r.status === 200 ? r.status : null; } catch { return null; }
}
async function gatewayResponds() { const r = await getAs('probe', 'gateway-probe'); return r.status !== 0 && r.status !== 599 ? r : null; }

// ---------- HTTP : API admin Unleash (memes endpoints que canary-parity.mjs) ----------
const ENV_URL = () => `${cfg.unleashUrl}/api/admin/projects/${cfg.project}/features/${cfg.flag}/environments/${cfg.environment}`;
async function admin(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: ADMIN_TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(cfg.unleashUrl, '')} -> HTTP ${res.status} ${redact(text).slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const getFlagEnv = () => admin('GET', ENV_URL());
async function setFlag(action) { await admin('POST', `${ENV_URL()}/${action}`); log('flag_set', { action }); }
function rolloutStrategy(envState) {
  const list = (envState.strategies || []).filter((s) => s.name === 'flexibleRollout' && !s.disabled);
  if (list.length !== 1) throw new Error(`attendu 1 strategie flexibleRollout active, trouve ${list.length}`);
  return list[0];
}
function strategyBody(s, params) {
  return { name: s.name, title: s.title ?? null, disabled: s.disabled ?? false, sortOrder: s.sortOrder, constraints: s.constraints ?? [],
    segments: s.segments ?? [], variants: s.variants ?? [], parameters: { ...s.parameters, ...params } };
}
/** Flag ON a 20 % (relu pour verification). */
async function flagOn20() {
  const st = await getFlagEnv();
  const s = rolloutStrategy(st);
  if (s.parameters.rollout !== String(cfg.rollout)) await admin('PUT', `${ENV_URL()}/strategies/${s.id}`, strategyBody(s, { rollout: String(cfg.rollout) }));
  if (!st.enabled) await setFlag('on');
  const fin = await getFlagEnv();
  const ok = fin.enabled === true && rolloutStrategy(fin).parameters.rollout === String(cfg.rollout);
  log('flag_on_20', { ok, enabled: fin.enabled, rollout: rolloutStrategy(fin).parameters.rollout });
  if (!ok) throw new Error('impossible de mettre le flag ON a 20 %');
}

// ---------- pm2 (asynchrone : ne bloque pas la charge) ----------
async function pm2(args) {
  const [bin, pre] = cfg.pm2.endsWith('.js') ? [process.execPath, [cfg.pm2]] : [cfg.pm2, []];
  const { stdout } = await execFileP(bin, [...pre, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  return stdout;
}
async function pm2Act(args) { guard(`pm2 ${args.join(' ')}`); log('pm2_action', { args }); return pm2(args); }
/** Champs reduits : pm2 jlist contient l'environnement des processus (jetons), il n'est jamais conserve. */
async function pm2Snapshot() {
  try {
    const raw = await pm2(['jlist']);
    return JSON.parse(raw.slice(raw.indexOf('['))).map((p) => ({
      name: p.name, pid: p.pid, status: p.pm2_env?.status, restarts: p.pm2_env?.restart_time, unstableRestarts: p.pm2_env?.unstable_restarts,
      startedAt: p.pm2_env?.pm_uptime, autorestart: p.pm2_env?.autorestart, restartDelay: p.pm2_env?.restart_delay ?? 0,
      expBackoffRestartDelay: p.pm2_env?.exp_backoff_restart_delay ?? null, maxRestarts: p.pm2_env?.max_restarts ?? null, minUptime: p.pm2_env?.min_uptime ?? null,
    }));
  } catch (e) {
    log('pm2_unavailable', { error: redact(String(e.message || e)).slice(0, 200) });
    return null;
  }
}
const proc = (snap, name) => snap?.find((p) => p.name === name) ?? null;
function othersUnchanged(before, after) {
  if (!before || !after) return { ok: false, reason: 'pm2 indisponible', changed: [] };
  const changed = before.filter((b) => !TOUCHED.includes(b.name)).filter((b) => {
    const a = proc(after, b.name);
    return !a || a.pid !== b.pid || a.restarts !== b.restarts || a.startedAt !== b.startedAt || a.status !== b.status;
  }).map((b) => b.name);
  return { ok: changed.length === 0, changed, checked: before.filter((b) => !TOUCHED.includes(b.name)).map((b) => b.name) };
}

// ---------- R1 ----------
async function r1() {
  const res = {};
  await flagOn20();
  await sleep(cfg.propagationWaitMs);
  const baseline = await sweep('R1a-avant');
  res.baseline = baseline;

  // R1-a : arret a chaud
  const a = { outage: [], after: [] };
  await pm2Act(['stop', cfg.names.unleash]);
  const tStop = performance.now();
  a.unleashDownConfirmed = !(await unleashHealthy());
  a.unleashStatus = proc(await pm2Snapshot(), cfg.names.unleash)?.status;
  log('R1a_unleash_stopped', { downConfirmed: a.unleashDownConfirmed, status: a.unleashStatus });
  for (let t = cfg.r1OutageWaitMs; t <= cfg.r1OutageMs; t += cfg.r1EveryMs) {
    await sleepUntil(tStop + t);
    const sw = await sweep(`R1a-panne-${t / 1000}s`);
    a.outage.push({ ...sw, atS: t / 1000, sameUsersAsBaseline: sameSet(sw.v2Users, baseline.v2Users) });
  }
  await pm2Act(['start', cfg.names.unleash]);
  const tStart = performance.now();
  const h = await waitFor('unleash-health', unleashHealthy, 90000, 500);
  a.unleashBackMs = h.elapsedMs;
  for (let t = 0; t <= cfg.r1AfterMs; t += cfg.r1EveryMs) {
    await sleepUntil(tStart + (h.elapsedMs ?? 0) + t);
    const sw = await sweep(`R1a-apres-${t / 1000}s`);
    a.after.push({ ...sw, atS: t / 1000, sameUsersAsBaseline: sameSet(sw.v2Users, baseline.v2Users) });
  }
  a.outageErrors = a.outage.reduce((n, s) => n + s.httpErrors, 0);
  const firstNormal = a.after.find((s) => s.httpErrors === 0 && s.sameUsersAsBaseline);
  a.backToNormalAtS = firstNormal ? firstNormal.atS : null;
  a.verdict = a.unleashDownConfirmed && a.outageErrors === 0 ? 'PASS' : 'FAIL';
  if (!a.unleashDownConfirmed) a.reason = 'Unleash repondait encore apres pm2 stop : panne non realisee';
  res.a = a;
  log('R1a_done', { verdict: a.verdict, outageErrors: a.outageErrors, v2Pct: a.outage.map((s) => s.v2Pct) });

  // R1-b : demarrage a froid du gateway sans Unleash
  const b = { cold: [] };
  const backup = path.join(os.tmpdir(), 'unleash-backup-api-gateway.json'); // FileStorageProvider du SDK (backupPath = os.tmpdir())
  try { const st = fs.statSync(backup); b.backupFile = { path: backup, exists: true, bytes: st.size, mtime: st.mtime.toISOString() }; }
  catch { b.backupFile = { path: backup, exists: false }; }
  await pm2Act(['stop', cfg.names.unleash]);
  b.unleashDownConfirmed = !(await unleashHealthy());
  const gwBefore = proc(await pm2Snapshot(), cfg.names.gateway);
  await pm2Act(['restart', cfg.names.gateway]);
  const tRestart = performance.now();
  const gwUp = await waitFor('gateway-repond', gatewayResponds, 60000, 200);
  b.gatewayRespondsAfterMs = gwUp.elapsedMs;
  b.firstResponse = gwUp.value && { status: gwUp.value.status, version: gwUp.value.version };
  const gwAfter = proc(await pm2Snapshot(), cfg.names.gateway);
  b.gatewayRestarted = !!(gwBefore && gwAfter && gwAfter.pid !== gwBefore.pid);
  log('R1b_gateway_restarted', { respondsAfterMs: b.gatewayRespondsAfterMs, restarted: b.gatewayRestarted, firstResponse: b.firstResponse, backupFile: b.backupFile });
  if (gwUp.ok) {
    const tUp = performance.now();
    for (let t = 0; t <= 10000; t += cfg.r1EveryMs) {
      await sleepUntil(tUp + t);
      const sw = await sweep(`R1b-froid-${t / 1000}s`);
      b.cold.push({ ...sw, atS: t / 1000, sameUsersAsBaseline: sameSet(sw.v2Users, baseline.v2Users) });
    }
  }
  b.coldErrors = b.cold.reduce((n, s) => n + s.httpErrors, 0);
  await pm2Act(['start', cfg.names.unleash]);
  const tStart2 = performance.now();
  const h2 = await waitFor('unleash-health', unleashHealthy, 90000, 500);
  b.unleashBackMs = h2.elapsedMs;
  // Retour a ~20 % : balayages successifs jusqu'a une part de v2 dans ±3 sigma de 20 % sans erreur.
  b.recovery = [];
  let rec = null;
  while (!rec && performance.now() - tStart2 < cfg.r1RecoverMaxMs) {
    const sw = await sweep('R1b-retour');
    const item = { ...sw, sinceUnleashStartMs: +(performance.now() - tStart2).toFixed(0), sinceUnleashHealthyMs: h2.ok ? +(performance.now() - tStart2 - h2.elapsedMs).toFixed(0) : null };
    b.recovery.push(item);
    if (near20(sw)) rec = item;
  }
  b.recoveredSweep = rec ? { sinceUnleashStartMs: rec.sinceUnleashStartMs, sinceUnleashHealthyMs: rec.sinceUnleashHealthyMs, v2Pct: rec.v2Pct } : null;
  b.verdict = b.unleashDownConfirmed && gwUp.ok && b.cold.length > 0 && b.coldErrors === 0 ? 'PASS' : 'FAIL';
  if (!gwUp.ok) b.reason = 'le gateway ne repond pas dans les 60 s apres le redemarrage';
  else if (!b.unleashDownConfirmed) b.reason = 'Unleash repondait encore apres pm2 stop';
  res.b = b;
  log('R1b_done', { verdict: b.verdict, coldErrors: b.coldErrors, v2Pct: b.cold.map((s) => s.v2Pct), recoveredSweep: b.recoveredSweep });

  // Comparaison avec la phrase du rapport
  const outageShares = [...a.outage, ...b.cold].map((s) => s.v2Pct);
  res.claim = outageShares.every((p) => p === 0)
    ? { conforme: true, text: 'conforme : 0 % de v2 pendant la panne, tout le trafic en v1' }
    : { conforme: false, text: `non conforme : pendant la panne, v2 recoit encore ${[...new Set(outageShares)].join(' / ')} % (derniere configuration conservee par le SDK)` };
  return res;
}

// ---------- R2 ----------
function startLoad() {
  const rows = [];
  const pending = new Set();
  let n = 0;
  const t0 = performance.now();
  let stopped = false;
  (async () => {
    while (!stopped) {
      const user = USERS[n % USERS.length];
      n++;
      const p = getAs(user, 'R2-charge').then((r) => rows.push(r));
      pending.add(p); p.finally(() => pending.delete(p));
      await sleepUntil(t0 + n * (1000 / cfg.r2Rps));
    }
  })();
  return { rows, stop: async () => { stopped = true; await Promise.all([...pending]); } };
}
function countByVersion(rows) {
  const c = { v1: { requests: 0, errors: 0 }, v2: { requests: 0, errors: 0 }, sansVersion: { requests: 0, errors: 0 } };
  for (const r of rows) { const k = r.version === 'v1' || r.version === 'v2' ? r.version : 'sansVersion'; c[k].requests++; if (isHttpError(r)) c[k].errors++; }
  return c;
}

async function r2() {
  const res = { trials: [] };
  await flagOn20();
  await sleep(cfg.propagationWaitMs);
  const snap0 = await pm2Snapshot();
  const v2p = proc(snap0, cfg.names.v2);
  if (!v2p) throw new Error(`processus pm2 ${cfg.names.v2} introuvable`);
  res.pm2Config = { autorestart: v2p.autorestart, restartDelay: v2p.restartDelay, expBackoffRestartDelay: v2p.expBackoffRestartDelay, maxRestarts: v2p.maxRestarts, minUptime: v2p.minUptime };
  log('R2_pm2_config', res.pm2Config);
  if (!(await v2DirectOk())) throw new Error(`${cfg.v2DirectUrl} ne repond pas 200 avant R2`);

  const load = startLoad();
  const tLoad = performance.now();
  try {
    await sleep(5000); // charge de reference avant le premier crash
    for (let k = 1; k <= cfg.r2Trials; k++) {
      if (k > 1) { log('R2_stabilisation', { ms: cfg.r2StabilizeMs }); await sleep(cfg.r2StabilizeMs); }
      const before = proc(await pm2Snapshot(), cfg.names.v2);
      const trial = { trial: k, pidBefore: before?.pid, restartsBefore: before?.restarts, statusBefore: before?.status };
      if (before?.status !== 'online' || !before?.pid) { trial.ok = false; trial.reason = `${cfg.names.v2} pas online avant l'essai`; res.trials.push(trial); continue; }
      guard('kill -9');
      process.kill(before.pid, 'SIGKILL');
      const tKill = performance.now();
      const killEpoch = Date.now();
      trial.killedAt = new Date(killEpoch).toISOString();
      log('R2_kill', { trial: k, pid: before.pid, signal: 'SIGKILL' });
      let pollDur = [];
      const [pmW, httpW] = await Promise.all([
        waitFor('pm2-relance', async () => {
          const t = performance.now();
          const p = proc(await pm2Snapshot(), cfg.names.v2);
          pollDur.push(performance.now() - t);
          log('pm2_poll', { trial: k, pid: p?.pid, status: p?.status, restarts: p?.restarts });
          return p && p.status === 'online' && p.pid && p.pid !== before.pid && p.restarts >= before.restarts + 1 ? p : null;
        }, cfg.r2MaxWaitMs, cfg.r2PollMs),
        waitFor('v2-http-200', async () => { const s = await v2DirectOk(); log('http_poll', { trial: k, ok: !!s }); return s; }, cfg.r2MaxWaitMs, cfg.r2PollMs),
      ]);
      trial.pm2RestartDelayMs = pmW.ok ? +(pmW.elapsedMs).toFixed(0) : null;
      trial.httpOkDelayMs = httpW.ok ? +(httpW.elapsedMs).toFixed(0) : null;
      trial.pm2PollMeanMs = pollDur.length ? +(pollDur.reduce((a, b) => a + b, 0) / pollDur.length).toFixed(0) : null;
      // Delai independant du sondage : instant de demarrage du nouveau processus enregistre par pm2 (pm_uptime) - instant du kill.
      trial.pm2StartedAfterKillMs = pmW.value?.startedAt ? pmW.value.startedAt - killEpoch : null;
      trial.pidAfter = pmW.value?.pid ?? null;
      trial.restartsAfter = pmW.value?.restarts ?? null;
      trial.restartIncrement = pmW.value ? pmW.value.restarts - before.restarts : null;
      trial.autoRestarted = pmW.ok;
      if (!pmW.ok) {
        trial.reason = `pas de relance automatique en ${cfg.r2MaxWaitMs / 1000} s`;
        log('R2_relance_manuelle', { trial: k, note: 'pm2 start pour permettre la suite ; essai compte en FAIL' });
        await pm2Act(['start', cfg.names.v2]);
        await waitFor('v2-http-200', v2DirectOk, 60000, 500);
      }
      trial.tKill = tKill;
      trial.ok = trial.autoRestarted && trial.httpOkDelayMs !== null;
      log('R2_trial', { ...trial, tKill: undefined });
      res.trials.push(trial);
    }
    await sleep(cfg.r2StabilizeMs);
  } finally {
    await load.stop();
  }
  // Erreurs par version : total, et par essai (du kill au kill suivant / fin de charge)
  res.load = { durationS: +((performance.now() - tLoad) / 1000).toFixed(1), rps: cfg.r2Rps, ...countByVersion(load.rows) };
  const kills = res.trials.filter((t) => t.tKill).map((t) => t.tKill);
  for (const t of res.trials) {
    if (!t.tKill) continue;
    const next = kills.find((x) => x > t.tKill) ?? Infinity;
    t.window = countByVersion(load.rows.filter((r) => r.sentPerf >= t.tKill && r.sentPerf < next));
    delete t.tKill;
  }
  const auto = res.trials.filter((t) => t.autoRestarted).length;
  const stat = (key) => {
    const v = res.trials.map((t) => t[key]).filter((x) => x !== null && x !== undefined);
    return v.length ? { meanMs: Math.round(v.reduce((a, b) => a + b, 0) / v.length), minMs: Math.min(...v), maxMs: Math.max(...v), n: v.length } : null;
  };
  res.stats = { pm2Restart: stat('pm2RestartDelayMs'), pm2StartedAt: stat('pm2StartedAfterKillMs'), httpOk: stat('httpOkDelayMs'), autoRestarted: `${auto}/${cfg.r2Trials}` };
  res.verdict = auto === cfg.r2Trials && res.trials.length === cfg.r2Trials && res.load.v1.errors === 0 ? 'PASS' : 'FAIL';
  if (res.load.v1.errors) res.reason = `${res.load.v1.errors} erreur(s) cote v1`;
  return res;
}

// ---------- orchestration + restauration ----------
const results = {};
let pmInitial = null;
let watcherWasOnline = false;
let restoring = null;

async function restoreOnce() {
  const r = { steps: [] };
  const step = async (name, fn) => { try { r.steps.push({ name, ok: true, ...(await fn()) }); } catch (e) { r.steps.push({ name, ok: false, error: redact(String(e.message || e)).slice(0, 300) }); } };
  const snap = await pm2Snapshot();
  await step('unleash en ligne', async () => {
    if (proc(snap, cfg.names.unleash)?.status !== 'online') await pm2([ 'start', cfg.names.unleash ]);
    const h = await waitFor('unleash-health', unleashHealthy, 90000, 500);
    if (!h.ok) throw new Error('Unleash ne repond pas sur /health');
    return {};
  });
  await step('courses-v2 en ligne', async () => {
    if (proc(snap, cfg.names.v2)?.status !== 'online') await pm2(['start', cfg.names.v2]);
    const h = await waitFor('v2-http-200', v2DirectOk, 60000, 500);
    if (!h.ok) throw new Error(`${cfg.v2DirectUrl} ne repond pas 200`);
    return {};
  });
  await step('gateway en ligne', async () => {
    if (proc(snap, cfg.names.gateway)?.status !== 'online') await pm2(['start', cfg.names.gateway]);
    const h = await waitFor('gateway-repond', gatewayResponds, 60000, 500);
    if (!h.ok) throw new Error('le gateway ne repond pas');
    return {};
  });
  await step('flag ON a 20 %', async () => { await flagOn20(); return {}; });
  await step('rollback-watcher', async () => {
    if (!watcherWasOnline) return { note: 'ne tournait pas au depart : non relance' };
    await pm2(['start', cfg.names.watcher]);
    return {};
  });
  // Verification de l'etat final
  await sleep(cfg.propagationWaitMs);
  const fin = await pm2Snapshot();
  const fl = await getFlagEnv().catch(() => null);
  const probe = await getAs('final-check', 'final');
  r.final = {
    unleash: proc(fin, cfg.names.unleash)?.status, unleashHealthy: await unleashHealthy(),
    gateway: proc(fin, cfg.names.gateway)?.status, gatewayHttp: probe.status,
    coursesV2: proc(fin, cfg.names.v2)?.status, watcher: proc(fin, cfg.names.watcher)?.status ?? 'absent',
    flagEnabled: fl?.enabled ?? null, flagRollout: fl ? rolloutStrategy(fl).parameters.rollout : null,
    othersUnchanged: othersUnchanged(pmInitial, fin),
  };
  const f = r.final;
  r.ok = f.unleash === 'online' && f.unleashHealthy && f.gateway === 'online' && f.gatewayHttp === 200 && f.coursesV2 === 'online'
    && f.flagEnabled === true && f.flagRollout === String(cfg.rollout) && (!watcherWasOnline || f.watcher === 'online') && f.othersUnchanged.ok;
  log('restored', r);
  results.restore = r;
}
const restore = () => (restoring ??= restoreOnce());

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (aborted) { log('interrupt_ignored', { signal: sig, note: 'restauration en cours' }); return; }
    aborted = true;
    log('interrupted', { signal: sig });
    await restore();
    writeSummary();
    process.exit(130);
  });
}

function writeSummary() {
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'v2Users' ? undefined : v)));
  fs.writeFileSync(path.join(OUT, 'summary.json'), redact(JSON.stringify({ config: { ...cfg, tokenSource: TOKEN_SOURCE }, results: strip(results) }, null, 2)));
  const R1 = results.R1;
  const a = R1?.a;
  const b = R1?.b;
  const R2 = results.R2;
  const shares = (list) => list.map((s) => `${s.atS ?? ''}s:${s.v2Pct} %`).join(', ');
  const fmt = (st) => (st ? `moyenne ${s2(st.meanMs)} (min ${s2(st.minMs)} – max ${s2(st.maxMs)}, ${st.n} essais)` : 'non mesure');
  const fin = results.restore?.final;
  const rows = [];
  if (R1) {
    rows.push(`| R1-a Unleash arrete a chaud | Aucune erreur HTTP pendant la panne (part de v2 rapportee) | avant : ${R1.baseline.v2Pct} % v2 ; panne (${shares(a.outage)}) ; memes utilisateurs en v2 qu'avant : ${a.outage.every((s) => s.sameUsersAsBaseline) ? 'oui' : 'non'} ; ${a.outageErrors} erreur HTTP (statuts ${JSON.stringify(a.outage.reduce((m, s) => { for (const [k, v] of Object.entries(s.statuses)) m[k] = (m[k] || 0) + v; return m; }, {}))}) ; Unleash de retour en ${s2(a.unleashBackMs)}, apres (${shares(a.after)}) ; normal (memes utilisateurs, 0 erreur) a ${a.backToNormalAtS ?? 'jamais'} s${a.reason ? ` ; ${a.reason}` : ''} | ${a.verdict} |`);
    rows.push(`| R1-b Demarrage a froid sans Unleash | Aucune erreur HTTP pendant la panne (part de v2 rapportee) | fichier de sauvegarde SDK ${b.backupFile.exists ? `present (${b.backupFile.path}, ${b.backupFile.mtime})` : `absent (${b.backupFile.path})`} ; gateway repond ${s2(b.gatewayRespondsAfterMs)} apres le restart ; froid (${shares(b.cold)}) ; ${b.coldErrors} erreur HTTP ; Unleash de retour en ${s2(b.unleashBackMs)} ; ~20 % (±${tolPts(cfg.rollout, cfg.users)} pts, 0 erreur) ${b.recoveredSweep ? `atteint ${s2(b.recoveredSweep.sinceUnleashStartMs)} apres pm2 start unleash (${s2(b.recoveredSweep.sinceUnleashHealthyMs)} apres /health OK), ${b.recoveredSweep.v2Pct} %` : 'NON atteint en 60 s'}${b.reason ? ` ; ${b.reason}` : ''} | ${b.verdict} |`);
    const already = b.cold.length && b.cold.every(near20);
    if (already) rows[rows.length - 1] = rows[rows.length - 1].replace(/ \| (PASS|FAIL) \|$/, ' (deja ~20 % pendant la panne : le retour d\'Unleash ne change rien d\'observable) | $1 |');
    rows.push(`| R1 Phrase du rapport | « Si Unleash n'est pas configure, pas encore pret ou en erreur, tout le trafic va vers v1 » | ${R1.claim.text} | ${R1.claim.conforme ? 'CONFORME' : 'NON CONFORME'} |`);
  }
  if (R2) {
    rows.push(`| R2 Crash courses-v2 (kill -9) | Relance automatique ${cfg.r2Trials}/${cfg.r2Trials}, aucune erreur cote v1 | autorestart = ${R2.pm2Config.autorestart} (restart_delay ${R2.pm2Config.restartDelay} ms) ; relance auto ${R2.stats.autoRestarted} ; nouveau pid vu online (sondage pm2 jlist) : ${fmt(R2.stats.pm2Restart)} ; demarrage du nouveau processus d'apres pm_uptime : ${fmt(R2.stats.pm2StartedAt)} ; HTTP 200 sur :3012 : ${fmt(R2.stats.httpOk)} ; charge ${R2.load.rps} req/s pendant ${R2.load.durationS} s : v1 ${R2.load.v1.errors}/${R2.load.v1.requests} erreur, v2 ${R2.load.v2.errors}/${R2.load.v2.requests} erreur, sans version ${R2.load.sansVersion.errors}/${R2.load.sansVersion.requests} ; ${R2.trials.map((t) => `essai ${t.trial} : pid ${t.pidBefore}→${t.pidAfter ?? '-'}, +${t.restartIncrement ?? '-'} redemarrage, pm2 ${s2(t.pm2RestartDelayMs)}, HTTP ${s2(t.httpOkDelayMs)}${t.window ? `, v2 en erreur ${t.window.v2.errors}` : ''}${t.reason ? ` (${t.reason})` : ''}`).join(' ; ')} | ${R2.verdict} |`);
  }
  if (fin) {
    rows.push(`| Etat final | unleash, gateway, courses-v2 en ligne ; flag ON 20 % ; watcher relance ; autres processus intacts | unleash ${fin.unleash} (/health ${fin.unleashHealthy ? 'OK' : 'KO'}) ; gateway ${fin.gateway} (HTTP ${fin.gatewayHttp}) ; courses-v2 ${fin.coursesV2} ; flag ${fin.flagEnabled ? 'ON' : 'OFF'} ${fin.flagRollout} % ; watcher ${fin.watcher}${watcherWasOnline ? '' : ' (ne tournait pas au depart)'} ; autres (${fin.othersUnchanged.checked?.join(', ') || '-'}) ${fin.othersUnchanged.ok ? 'inchanges' : `MODIFIES : ${fin.othersUnchanged.changed.join(', ') || fin.othersUnchanged.reason}`} | ${results.restore.ok ? 'PASS' : 'FAIL'} |`);
  }
  const md = [
    `# Resilience Oracle (pm2 + nginx) — ${new Date().toISOString()}`, '',
    `Flag \`${cfg.flag}\` a ${cfg.rollout} %, ${cfg.users} utilisateurs (user-001..user-${cfg.users}), erreur = statut HTTP != 200 (0 = connexion impossible, 599 = delai depasse).`, '',
    '| Cas | Critere | Resultat observe | Verdict |', '|---|---|---|---|', ...rows,
    results.fatal ? `\n**Erreur fatale :** ${results.fatal}` : '',
    '', `Resolution R2 : sondage toutes les ${cfg.r2PollMs} ms ; un appel \`pm2 jlist\` prend ~${R2?.trials?.[0]?.pm2PollMeanMs ?? '?'} ms, ce qui borne la precision du delai pm2.`,
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'summary.md'), redact(md) + '\n');
  console.log('\n' + redact(md) + `\n\nPreuves : ${OUT}`);
}

async function main() {
  if (!ADMIN_TOKEN) throw new Error(`UNLEASH_ADMIN_TOKEN introuvable (ni dans l'environnement ni dans ${TOKEN_SOURCE})`);
  log('campaign_started', { gatewayUrl: cfg.gatewayUrl, unleashUrl: cfg.unleashUrl, flag: cfg.flag, tokenSource: TOKEN_SOURCE, only: [...ONLY], node: process.version });
  pmInitial = await pm2Snapshot();
  if (!pmInitial) throw new Error('pm2 indisponible : les tests ne peuvent pas etre realises');
  log('pm2_initial', { processes: pmInitial });
  for (const n of [cfg.names.unleash, cfg.names.gateway, cfg.names.v2]) {
    if (proc(pmInitial, n)?.status !== 'online') throw new Error(`processus pm2 ${n} pas online au depart (${proc(pmInitial, n)?.status ?? 'absent'})`);
  }
  const env0 = await getFlagEnv();
  log('initial_flag', { enabled: env0.enabled, rollout: rolloutStrategy(env0).parameters.rollout, stickiness: rolloutStrategy(env0).parameters.stickiness });
  watcherWasOnline = proc(pmInitial, cfg.names.watcher)?.status === 'online';
  if (watcherWasOnline) await pm2Act(['stop', cfg.names.watcher]);
  else log('warning', { msg: `${cfg.names.watcher} ne tournait pas (${proc(pmInitial, cfg.names.watcher)?.status ?? 'absent'})` });

  if (ONLY.has('R1')) results.R1 = await r1();
  if (ONLY.has('R2')) results.R2 = await r2();
}

main()
  .catch((e) => { results.fatal = redact(String(e.stack || e)); log('fatal', { error: results.fatal }); })
  .finally(async () => {
    if (aborted) return; // le gestionnaire de signal restaure et termine
    await restore();
    writeSummary();
    const verdicts = [results.R1?.a?.verdict, results.R1?.b?.verdict, results.R2?.verdict].filter(Boolean);
    process.exit(!results.fatal && verdicts.every((v) => v === 'PASS') && results.restore?.ok ? 0 : 1);
  });
