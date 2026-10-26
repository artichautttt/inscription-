#!/usr/bin/env node
/**
 * Campagne de parite Oracle <-> Docker : rejoue T1 (CF3 stickiness), T2 (CF4 montee progressive)
 * et T3 (CF5 rollback manuel) contre le gateway reel, en pilotant le flag via l'API admin Unleash.
 *
 * Aucune dependance (Node >= 18). Ne touche pas au code applicatif.
 * - Etat initial du flag (active + strategie complete) enregistre puis RESTAURE a la fin (finally + SIGINT/SIGTERM).
 * - rollback-watcher arrete pendant les tests (pm2 stop) puis relance (pm2 start) s'il tournait au depart.
 * - Journal horodate : evidences/canary-parity-<ISO>/journal.jsonl ; resume : summary.json + summary.md.
 *
 * Secrets : UNLEASH_ADMIN_TOKEN lu dans l'environnement, sinon dans ~/.canary-secrets (meme fichier que
 * deploy-canary.sh / run-scenario.sh ; chemin modifiable par CANARY_SECRETS). Jamais ecrit dans les journaux.
 *
 * Usage : node canary-simulation/simulation/canary-parity.mjs [--only T1,T2,T3]
 *
 * Endpoints admin Unleash utilises (doc officielle docs.getunleash.io) :
 *   GET  /api/admin/projects/{p}/features/{f}/environments/{env}                    (enabled + strategies[])
 *   PUT  /api/admin/projects/{p}/features/{f}/environments/{env}/strategies/{id}    (remplace la strategie)
 *   POST /api/admin/projects/{p}/features/{f}/environments/{env}/on|off             (meme appel que watcher.js)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// ---------- configuration (memes noms de variables que watcher.js / run-scenario.sh) ----------
const cfg = {
  gatewayUrl: process.env.GATEWAY_URL || 'http://127.0.0.1:3000/api/courses',
  unleashUrl: (process.env.UNLEASH_ADMIN_URL || 'http://127.0.0.1:4242').replace(/\/$/, ''),
  flag: process.env.FLAG || 'courses-v2-canary',
  project: process.env.PROJECT || 'default',
  environment: process.env.ENVIRONMENT || 'development',
  watcherName: process.env.WATCHER_NAME || 'rollback-watcher',
  pm2: process.env.PM2_BIN || 'pm2',
  propagationWaitMs: Number(process.env.PROPAGATION_WAIT_MS || 3000), // >= 3 s exige (SDK : refresh 2 s)
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 5000),
  t1Rollout: Number(process.env.T1_ROLLOUT || 50),
  t1Requests: 10,
  t2Steps: [10, 50, 100],
  t2Users: 200,
  t3Rollout: Number(process.env.T3_ROLLOUT || 50),
  t3Trials: Number(process.env.T3_TRIALS || 3),
  t3IntervalMs: 100,
  t3MaxWaitMs: Number(process.env.T3_MAX_WAIT_MS || 15000),
  evidenceRoot: process.env.EVIDENCE_DIR || path.join(ROOT, 'evidences'),
  dockerRollbackS: 1.42, // reference campagne Docker (CF5)
};
const onlyArg = process.argv.indexOf('--only');
const ONLY = new Set((onlyArg > 0 ? process.argv[onlyArg + 1] : 'T1,T2,T3').split(',').map((s) => s.trim().toUpperCase()));

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
const OUT = path.join(cfg.evidenceRoot, `canary-parity-${STAMP}`);
fs.mkdirSync(OUT, { recursive: true });
const JOURNAL = path.join(OUT, 'journal.jsonl');
const redact = (s) => (ADMIN_TOKEN ? String(s).split(ADMIN_TOKEN).join('***') : String(s));
function log(event, extra = {}) {
  const line = redact(JSON.stringify({ event, at: Date.now(), iso: new Date().toISOString(), ...extra }));
  fs.appendFileSync(JOURNAL, line + '\n');
  if (!['request'].includes(event)) console.log(line.length > 400 ? line.slice(0, 400) + '…' : line);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTTP : gateway ----------
/** Un GET /api/courses pour un utilisateur ; renvoie statut, version servie et temps de reception. */
async function getAs(user) {
  const sentAt = Date.now();
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
  const r = { user, status, version, sentAt, recvPerf: performance.now(), latencyMs: +(performance.now() - t0).toFixed(1) };
  log('request', r);
  return r;
}
const isHttpError = (r) => r.status !== 200 || !r.version;

// ---------- HTTP : API admin Unleash ----------
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

/** Meme URL que setFlag() de watcher.js ; renvoie l'instant (performance.now) de reception de la reponse. */
async function setFlag(action) {
  await admin('POST', `${ENV_URL()}/${action}`);
  const respPerf = performance.now();
  log('flag_set', { action, respAt: Date.now() });
  return respPerf;
}

/** La strategie flexibleRollout du flag (doit etre unique, sinon les pourcentages ne seraient pas interpretables). */
function rolloutStrategy(envState) {
  const list = (envState.strategies || []).filter((s) => s.name === 'flexibleRollout' && !s.disabled);
  if (list.length !== 1) throw new Error(`attendu 1 strategie flexibleRollout active, trouve ${list.length} (sur ${(envState.strategies || []).length})`);
  return list[0];
}
/** PUT = remplacement : on renvoie la strategie complete, seul parameters.rollout change. */
function strategyBody(s, params) {
  return {
    name: s.name,
    title: s.title ?? null,
    disabled: s.disabled ?? false,
    sortOrder: s.sortOrder,
    constraints: s.constraints ?? [],
    segments: s.segments ?? [],
    variants: s.variants ?? [],
    parameters: { ...s.parameters, ...params },
  };
}
async function setRollout(strategy, pct) {
  await admin('PUT', `${ENV_URL()}/strategies/${strategy.id}`, strategyBody(strategy, { rollout: String(pct) }));
  const check = rolloutStrategy(await getFlagEnv());
  if (check.parameters.rollout !== String(pct)) throw new Error(`rollout relu = ${check.parameters.rollout}, attendu ${pct}`);
  log('rollout_set', { rollout: pct, strategyId: strategy.id });
}
/** Met le flag dans l'etat voulu (enabled, rollout) puis attend la propagation SDK. */
async function configure(strategy, enabled, pct) {
  await setRollout(strategy, pct);
  const st = await getFlagEnv();
  if (st.enabled !== enabled) await setFlag(enabled ? 'on' : 'off');
  log('propagation_wait', { ms: cfg.propagationWaitMs });
  await sleep(cfg.propagationWaitMs);
}

// ---------- pm2 ----------
function pm2(args) {
  return execFileSync(cfg.pm2, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
/** Uniquement nom/pid/statut/restarts/uptime : pm2 jlist contient l'environnement (donc des jetons), on ne le garde pas. */
function pm2Snapshot() {
  try {
    const raw = pm2(['jlist']);
    return JSON.parse(raw.slice(raw.indexOf('['))).map((p) => ({
      name: p.name, pid: p.pid, status: p.pm2_env?.status, restarts: p.pm2_env?.restart_time, unstableRestarts: p.pm2_env?.unstable_restarts,
      startedAt: p.pm2_env?.pm_uptime, uptimeMs: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
    }));
  } catch (e) {
    log('pm2_unavailable', { error: String(e.message || e).slice(0, 200) });
    return null;
  }
}
/** Compare deux instantanes : un processus a redemarre si pid, restarts ou instant de demarrage ont change. */
function pm2Diff(before, after, ignore = []) {
  if (!before || !after) return { ok: false, reason: 'pm2 indisponible', changed: [] };
  const changed = [];
  for (const b of before.filter((p) => !ignore.includes(p.name))) {
    const a = after.find((p) => p.name === b.name);
    if (!a || a.pid !== b.pid || a.restarts !== b.restarts || a.startedAt !== b.startedAt || a.status !== b.status) {
      changed.push({ name: b.name, before: b, after: a ?? null });
    }
  }
  return { ok: changed.length === 0, changed };
}

// ---------- tests ----------
const results = {};

async function t1(strategy) {
  await configure(strategy, true, cfg.t1Rollout);
  // Choix des deux utilisateurs : premier "t1-user-NNN" servi en v2 (expose) et premier servi en v1 (temoin).
  let exposed = null;
  let control = null;
  for (let i = 1; i <= 200 && (!exposed || !control); i++) {
    const r = await getAs(`t1-user-${String(i).padStart(3, '0')}`);
    if (isHttpError(r)) continue;
    if (r.version === 'v2' && !exposed) exposed = r.user;
    if (r.version === 'v1' && !control) control = r.user;
  }
  if (!exposed || !control) return { verdict: 'FAIL', observed: `impossible de trouver un utilisateur v2 ET un v1 a ${cfg.t1Rollout} %`, exposed, control };
  const run = async (user, expected) => {
    const seq = [];
    for (let i = 0; i < cfg.t1Requests; i++) seq.push(await getAs(user));
    const versions = seq.map((r) => r.version || `ERR${r.status}`);
    const transitions = versions.slice(1).filter((v, i) => v !== versions[i]).length;
    return { user, expected, versions, matches: versions.filter((v) => v === expected).length, transitions, errors: seq.filter(isHttpError).length };
  };
  const a = await run(exposed, 'v2');
  const b = await run(control, 'v1');
  const pass = [a, b].every((x) => x.matches === cfg.t1Requests && x.transitions === 0 && x.errors === 0);
  return {
    verdict: pass ? 'PASS' : 'FAIL', rollout: cfg.t1Rollout, exposed: a, control: b,
    observed: `expose ${a.user} : ${a.matches}/${cfg.t1Requests} v2, ${a.transitions} oscillation ; temoin ${b.user} : ${b.matches}/${cfg.t1Requests} v1, ${b.transitions} oscillation ; ${a.errors + b.errors} erreur`,
  };
}

async function t2(strategy) {
  const users = Array.from({ length: cfg.t2Users }, (_, i) => `user-${String(i + 1).padStart(3, '0')}`);
  const N = users.length;
  const steps = [];
  for (const pct of cfg.t2Steps) {
    await configure(strategy, true, pct);
    const rows = [];
    for (const u of users) rows.push(await getAs(u));
    const v2 = rows.filter((r) => r.version === 'v2').map((r) => r.user);
    const errors = rows.filter(isHttpError);
    const p = pct / 100;
    const tolPts = +((3 * Math.sqrt(p * (1 - p) / N)) * 100).toFixed(1); // ±3 sigma binomial, en points
    const observedPct = +((v2.length / N) * 100).toFixed(1);
    const inTol = Math.abs(observedPct - pct) <= tolPts + 1e-9;
    steps.push({ rollout: pct, N, v2Count: v2.length, observedPct, tolerancePts: tolPts, inTolerance: inTol, httpErrors: errors.length,
      errorStatuses: errors.map((r) => r.status), v2Users: v2 });
    log('t2_step', { rollout: pct, v2Count: v2.length, observedPct, tolerancePts: tolPts, inTolerance: inTol, httpErrors: errors.length });
  }
  const monotone = steps.slice(1).map((s, i) => {
    const prev = new Set(steps[i].v2Users);
    const cur = new Set(s.v2Users);
    const lost = [...prev].filter((u) => !cur.has(u));
    return { from: steps[i].rollout, to: s.rollout, included: lost.length === 0, lost };
  });
  const totalErrors = steps.reduce((n, s) => n + s.httpErrors, 0);
  const pass = steps.every((s) => s.inTolerance) && monotone.every((m) => m.included) && totalErrors === 0;
  return {
    verdict: pass ? 'PASS' : 'FAIL', steps, monotone, totalErrors,
    observed: steps.map((s) => `${s.rollout} % -> ${s.observedPct} % (${s.v2Count}/${s.N}, tol. ±${s.tolerancePts} pts${s.inTolerance ? '' : ' HORS TOL.'})`).join(' ; ')
      + ` ; monotonie ${monotone.map((m) => `${m.from}⊂${m.to} ${m.included ? 'oui' : `NON (${m.lost.length} perdus)`}`).join(', ')} ; ${totalErrors} erreur HTTP`,
  };
}

async function t3(strategy, t2res) {
  await setRollout(strategy, cfg.t3Rollout);
  // Utilisateur servi par v2 : pris dans le palier 50 % de T2 si disponible, sinon recherche.
  let user = t2res?.steps?.find((s) => s.rollout === cfg.t3Rollout)?.v2Users?.[0] ?? null;
  const trials = [];
  for (let k = 1; k <= cfg.t3Trials; k++) {
    // 1. flag ON, attendre que l'utilisateur soit servi par v2
    const st = await getFlagEnv();
    if (!st.enabled) await setFlag('on');
    await sleep(cfg.propagationWaitMs);
    if (!user) {
      for (let i = 1; i <= 200 && !user; i++) { const r = await getAs(`t3-user-${String(i).padStart(3, '0')}`); if (r.version === 'v2') user = r.user; }
      if (!user) { trials.push({ trial: k, ok: false, reason: 'aucun utilisateur servi par v2' }); continue; }
    }
    let pre = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { pre = await getAs(user); if (pre.version === 'v2') break; await sleep(200); }
    if (pre?.version !== 'v2') { trials.push({ trial: k, user, ok: false, reason: `${user} non servi par v2 avant le rollback (${pre?.version || pre?.status})` }); continue; }

    // 2. rollback : instantanes pm2, OFF via l'API admin, puis 1 requete / 100 ms jusqu'a une reponse v1
    const pmBefore = pm2Snapshot();
    const tOff = await setFlag('off');
    const responses = [];
    const pending = new Set();
    let firstV1 = null;
    let n = 0;
    const tStart = performance.now();
    while (!firstV1 && performance.now() - tStart < cfg.t3MaxWaitMs) {
      const p = getAs(user).then((r) => {
        responses.push(r);
        if (r.version === 'v1' && (!firstV1 || r.recvPerf < firstV1.recvPerf)) firstV1 = r;
      });
      pending.add(p); p.finally(() => pending.delete(p));
      n++;
      const next = tStart + n * cfg.t3IntervalMs;
      await sleep(Math.max(0, next - performance.now()));
    }
    await Promise.all([...pending]);
    const pmAfter = pm2Snapshot();
    const pmCheck = pm2Diff(pmBefore, pmAfter, [cfg.watcherName]);
    const inInterval = responses.filter((r) => r.recvPerf >= tOff && (!firstV1 || r.recvPerf <= firstV1.recvPerf));
    const trial = {
      trial: k, user,
      delayMs: firstV1 ? +(firstV1.recvPerf - tOff).toFixed(1) : null,
      requestsSent: n,
      v2ResponsesInInterval: inInterval.filter((r) => r.version === 'v2').length,
      httpErrors: responses.filter(isHttpError).length,
      pm2Before: pmBefore, pm2After: pmAfter, pm2Check: pmCheck,
    };
    trial.ok = trial.delayMs !== null && trial.httpErrors === 0 && pmCheck.ok;
    if (!firstV1) trial.reason = `aucune reponse v1 en ${cfg.t3MaxWaitMs} ms`;
    else if (!pmCheck.ok) trial.reason = `pm2 : ${pmCheck.reason || pmCheck.changed.map((c) => c.name).join(', ') + ' a redemarre'}`;
    else if (trial.httpErrors) trial.reason = `${trial.httpErrors} erreur(s) HTTP`;
    log('t3_trial', { ...trial, pm2Before: undefined, pm2After: undefined });
    trials.push(trial);
  }
  const delays = trials.map((t) => t.delayMs).filter((d) => d !== null);
  const stats = delays.length ? {
    meanS: +(delays.reduce((a, b) => a + b, 0) / delays.length / 1000).toFixed(2),
    minS: +(Math.min(...delays) / 1000).toFixed(2), maxS: +(Math.max(...delays) / 1000).toFixed(2), n: delays.length,
  } : null;
  const pass = trials.length === cfg.t3Trials && trials.every((t) => t.ok);
  return {
    verdict: pass ? 'PASS' : 'FAIL', trials, stats,
    observed: trials.map((t) => (t.delayMs !== null
      ? `essai ${t.trial} : v1 apres ${(t.delayMs / 1000).toFixed(2)} s, ${t.v2ResponsesInInterval} reponse(s) v2, ${t.pm2Check.ok ? '0 redemarrage pm2' : t.reason}`
      : `essai ${t.trial} : ECHEC (${t.reason})`)).join(' ; '),
  };
}

// ---------- orchestration + restauration ----------
let initial = null;
let watcherWasOnline = false;
let restored = false;

async function restore() {
  if (restored) return;
  restored = true;
  const r = { flag: null, watcher: null };
  if (initial) {
    try {
      await admin('PUT', `${ENV_URL()}/strategies/${initial.strategy.id}`, strategyBody(initial.strategy, {}));
      const st = await getFlagEnv();
      if (st.enabled !== initial.enabled) await setFlag(initial.enabled ? 'on' : 'off');
      const fin = await getFlagEnv();
      const rs = rolloutStrategy(fin);
      r.flag = { ok: fin.enabled === initial.enabled && rs.parameters.rollout === initial.strategy.parameters.rollout, enabled: fin.enabled, rollout: rs.parameters.rollout };
    } catch (e) { r.flag = { ok: false, error: String(e.message || e) }; }
  }
  if (watcherWasOnline) {
    try { pm2(['start', cfg.watcherName]); r.watcher = { restarted: true, status: pm2Snapshot()?.find((p) => p.name === cfg.watcherName)?.status }; }
    catch (e) { r.watcher = { restarted: false, error: String(e.message || e).slice(0, 200) }; }
  } else r.watcher = { restarted: false, reason: 'ne tournait pas au depart' };
  log('restored', r);
  results.restore = r;
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { log('interrupted', { signal: sig }); await restore(); writeSummary(); process.exit(130); });
}

function writeSummary() {
  fs.writeFileSync(path.join(OUT, 'summary.json'), redact(JSON.stringify({ config: { ...cfg, tokenSource: TOKEN_SOURCE }, initial: initial && { enabled: initial.enabled, rollout: initial.strategy.parameters.rollout, stickiness: initial.strategy.parameters.stickiness, strategyId: initial.strategy.id }, results }, null, 2)));
  const row = (c, r) => `| ${c} | ${r ? r.observed : 'non execute'} | ${r ? r.verdict : '-'} |`;
  const s = results.T3?.stats;
  const md = [
    `# Campagne canary Oracle (pm2 + nginx) — ${new Date().toISOString()}`, '',
    `Flag \`${cfg.flag}\` (projet ${cfg.project}, env. ${cfg.environment}) ; etat initial : ${initial ? `${initial.enabled ? 'ON' : 'OFF'}, ${initial.strategy.parameters.rollout} %, stickiness ${initial.strategy.parameters.stickiness}` : 'inconnu'} ; attente de propagation ${cfg.propagationWaitMs} ms.`, '',
    '| Cas | Resultat observe | Verdict (PASS/FAIL) |', '|---|---|---|',
    row('T1 / CF3 stickiness', results.T1), row('T2 / CF4 montee progressive', results.T2), row('T3 / CF5 rollback manuel', results.T3),
    `| Comparaison rollback manuel Oracle vs Docker | Oracle : ${s ? `moyenne ${s.meanS} s (min ${s.minS} – max ${s.maxS} s, ${s.n} essais)` : 'non mesure'} ; Docker : ${cfg.dockerRollbackS} s${s ? ` ; ecart ${(s.meanS - cfg.dockerRollbackS >= 0 ? '+' : '')}${(s.meanS - cfg.dockerRollbackS).toFixed(2)} s` : ''} | - |`,
    '', `Restauration : flag ${results.restore?.flag?.ok ? 'OK' : 'A VERIFIER'} ; watcher ${results.restore?.watcher?.restarted ? 'relance' : 'non relance'}.`,
    results.fatal ? `\n**Erreur fatale :** ${results.fatal}` : '',
    '', 'Resolution de la mesure T3 : une requete toutes les 100 ms, donc delai mesure a ~100 ms pres (+ latence d\'une requete).',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'summary.md'), redact(md) + '\n');
  console.log('\n' + redact(md) + `\n\nPreuves : ${OUT}`);
}

async function main() {
  if (!ADMIN_TOKEN) throw new Error(`UNLEASH_ADMIN_TOKEN introuvable (ni dans l'environnement ni dans ${TOKEN_SOURCE})`);
  log('campaign_started', { gatewayUrl: cfg.gatewayUrl, unleashUrl: cfg.unleashUrl, flag: cfg.flag, tokenSource: TOKEN_SOURCE, only: [...ONLY], node: process.version });

  // Etat initial (lu AVANT toute modification)
  const env0 = await getFlagEnv();
  initial = { enabled: env0.enabled, strategy: rolloutStrategy(env0) };
  log('initial_state', { enabled: initial.enabled, strategy: initial.strategy });
  if (initial.strategy.parameters.stickiness !== 'default') log('warning', { msg: `stickiness = ${initial.strategy.parameters.stickiness} (attendu default)` });

  const pm0 = pm2Snapshot();
  log('pm2_initial', { processes: pm0 });
  watcherWasOnline = pm0?.find((p) => p.name === cfg.watcherName)?.status === 'online';
  if (watcherWasOnline) { pm2(['stop', cfg.watcherName]); log('watcher_stopped', { name: cfg.watcherName }); }
  else log('warning', { msg: `${cfg.watcherName} ne tournait pas (statut ${pm0?.find((p) => p.name === cfg.watcherName)?.status ?? 'absent'})` });

  const probe = await getAs('preflight');
  if (isHttpError(probe)) throw new Error(`gateway KO avant les tests : HTTP ${probe.status}, version "${probe.version}"`);

  try {
    if (ONLY.has('T1')) { results.T1 = await t1(initial.strategy); log('T1_done', { verdict: results.T1.verdict, observed: results.T1.observed }); }
    if (ONLY.has('T2')) { results.T2 = await t2(initial.strategy); log('T2_done', { verdict: results.T2.verdict, observed: results.T2.observed }); }
    if (ONLY.has('T3')) { results.T3 = await t3(initial.strategy, results.T2); log('T3_done', { verdict: results.T3.verdict, observed: results.T3.observed, stats: results.T3.stats }); }
  } finally {
    log('pm2_final', { processes: pm2Snapshot() });
  }
}

main()
  .catch((e) => { results.fatal = redact(String(e.stack || e)); log('fatal', { error: results.fatal }); })
  .finally(async () => {
    await restore();
    writeSummary();
    const ok = !results.fatal && ['T1', 'T2', 'T3'].filter((t) => ONLY.has(t)).every((t) => results[t]?.verdict === 'PASS') && results.restore?.flag?.ok !== false;
    process.exit(ok ? 0 : 1);
  });
