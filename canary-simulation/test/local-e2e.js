#!/usr/bin/env node
/**
 * Test local de bout en bout (sans serveur Oracle) : vrai gateway + vrai watcher + vrai generateur de charge,
 * avec de FAUX services (courses v1/v2, Unleash). Verifie que la chaine detection -> rollback fonctionne.
 * Prerequis : (cd gateway && npm run build)   Usage : node canary-simulation/test/local-e2e.js [--auto]  (--auto : teste aussi la recuperation automatique)
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SIM = path.resolve(__dirname, '../simulation');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-e2e-'));
const EV = path.join(tmp, 'events.jsonl');
const CSV = path.join(tmp, 'load.csv');
const P = { gw: 13000, v1: 13002, v2: 13012, unl: 14242 };
const FLAG = 'courses-v2-canary';
const AUTO = process.argv.includes('--auto');
const children = [];
const servers = [];
let flagEnabled = true;

const ev = (e) => fs.appendFileSync(EV, JSON.stringify({ event: e, at: Date.now() }) + '\n');
const listen = (port, handler) => new Promise((res) => { const s = http.createServer(handler).listen(port, '127.0.0.1', () => res(s)); servers.push(s); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await listen(P.v1, (req, res) => { res.setHeader('content-type', 'application/json'); res.end('[]'); });
  const v2 = await listen(P.v2, (req, res) => { res.setHeader('content-type', 'application/json'); res.end('[]'); });
  await listen(P.unl, (req, res) => {
    const json = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/api/client/features')) {
      return json(200, { version: 2, features: [{ name: FLAG, type: 'release', enabled: flagEnabled, stale: false, impressionData: false, project: 'default', variants: [],
        strategies: [{ name: 'flexibleRollout', constraints: [], parameters: { rollout: '50', stickiness: 'default', groupId: FLAG } }] }] });
    }
    if (req.method === 'POST' && req.url.includes(`/features/${FLAG}/environments/development/off`)) {
      if (req.headers.authorization !== 'admintoken') return json(401, {});
      flagEnabled = false; return json(200, {});
    }
    if (req.method === 'POST' && req.url.includes(`/features/${FLAG}/environments/development/on`)) {
      if (req.headers.authorization !== 'admintoken') return json(401, {});
      flagEnabled = true; return json(200, {});
    }
    return json(202, {});
  });

  const spawnP = (cmd, args, env, name) => { const c = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); c.stdout.on('data', () => {}); c.stderr.on('data', (d) => { if (process.env.DEBUG) process.stderr.write(`[${name}] ${d}`); }); children.push(c); return c; };

  spawnP('node', [path.join(ROOT, 'gateway/dist/main.js')], {
    PORT: P.gw, COURSES_SERVICE_URL: `http://127.0.0.1:${P.v1}`, COURSES_V2_SERVICE_URL: `http://127.0.0.1:${P.v2}`,
    UNLEASH_URL: `http://127.0.0.1:${P.unl}/api/`, UNLEASH_CLIENT_TOKEN: 'clienttoken', UNLEASH_REFRESH_MS: 1000,
    CANARY_WINDOW_MS: 10000, UPSTREAM_TIMEOUT_MS: 3000,
  }, 'gateway');
  await sleep(4000);
  spawnP('node', [path.join(ROOT, 'canary-simulation/rollback-watcher/watcher.js')], {
    GATEWAY_METRICS_URL: `http://127.0.0.1:${P.gw}/internal/canary-metrics`, UNLEASH_ADMIN_URL: `http://127.0.0.1:${P.unl}`,
    UNLEASH_ADMIN_TOKEN: 'admintoken', EVENTS_FILE: EV,
    ...(AUTO ? { AUTO_RECOVERY: '1', PROBE_URL: `http://127.0.0.1:${P.v2}/courses`, RECOVERY_SUCCESSES: 3, RECOVERY_COOLDOWN_MS: 3000 } : {}),
  }, 'watcher');
  await sleep(1000);

  const DURATION = AUTO ? 70 : 40, FAULT = 12;
  const load = spawnP('node', [path.join(SIM, 'load.js'), '--duration', DURATION, '--rps', 20, '--users', 200, '--out', CSV, '--url', `http://127.0.0.1:${P.gw}/api/courses`], {}, 'load');
  await sleep(FAULT * 1000);
  v2.closeAllConnections(); await new Promise((r) => v2.close(r)); ev('fault_injected');
  if (AUTO) {
    await sleep(25000); // v2 reste en panne ~25 s : le watcher ne doit PAS reactiver le flag pendant ce temps
    const stillOff = flagEnabled === false;
    await listen(P.v2, (req, res) => { res.setHeader('content-type', 'application/json'); res.end('[]'); }); ev('v2_restarted');
    globalThis.stillOffDuringOutage = stillOff;
  }
  await new Promise((r) => load.on('exit', r));

  const s = JSON.parse(execFileSync('node', [path.join(SIM, 'summarize.js'), CSV, EV]).toString());
  console.log(JSON.stringify(s, null, 2));
  const checks = [
    ['du trafic est bien parti vers v2 avant la panne', s.beforeFault.requests > 0 && s.v2Share > 5],
    ['la panne a ete detectee et le flag desactive (rollback)', s.rolledBack],
    ['rollback en moins de 20 s', s.rollbackDelayMs !== null && s.rollbackDelayMs < 20000],
    ['plus aucune reponse v2 plus de 3 s apres la desactivation du flag', s.flagPropagationMs !== null && s.flagPropagationMs < 3000],
    ...(AUTO ? [
      ['pendant la panne de v2, le flag reste OFF (pas de reactivation prematuree)', globalThis.stillOffDuringOutage === true],
      ['apres redemarrage de v2, le watcher reactive le flag SEUL', flagEnabled === true && s.autoRecoveryDelayMs !== null],
      ['reactivation automatique en moins de 20 s apres le redemarrage', s.autoRecoveryDelayMs !== null && s.autoRecoveryDelayMs < 20000],
      ['recuperation verifiee : reponses v2 en 200 et 0 erreur apres reactivation', s.recovery && s.recovery.verified],
    ] : [['le flag est bien OFF cote Unleash', flagEnabled === false]]),
  ];
  let ok = true;
  for (const [name, pass] of checks) { console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}`); ok = ok && pass; }
  children.forEach((c) => c.kill()); servers.forEach((x) => x.close());
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); children.forEach((c) => c.kill()); process.exit(2); });
