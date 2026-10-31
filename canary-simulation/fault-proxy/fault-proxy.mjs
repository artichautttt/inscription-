#!/usr/bin/env node
/**
 * Proxy d'injection de defauts (test uniquement, aucune dependance).
 * Ecoute sur 127.0.0.1:FAULT_PORT (3013) et relaie vers FAULT_TARGET (http://127.0.0.1:3012).
 *
 *   errorRate : part des requetes qui recoivent un 500 (tirage pseudo-aleatoire a graine fixe -> rejouable)
 *   latencyMs : delai ajoute avant de relayer (ou avant le 500)
 *
 * Reglage a chaud (route locale, jamais relayee) :
 *   GET  /__fault                              -> etat + compteurs
 *   POST /__fault {"errorRate":0.6,"latencyMs":0,"seed":42}   -> applique, reinitialise la graine et les compteurs
 * Valeurs initiales : FAULT_ERROR_RATE, FAULT_LATENCY_MS, FAULT_SEED (defaut 42).
 */
import http from 'node:http';

const PORT = Number(process.env.FAULT_PORT || 3013);
const TARGET = new URL(process.env.FAULT_TARGET || 'http://127.0.0.1:3012');

/** mulberry32 : generateur deterministe a partir d'une graine 32 bits. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const state = { errorRate: 0, latencyMs: 0, seed: 42 };
let rand;
let counters;
function apply({ errorRate, latencyMs, seed }) {
  if (errorRate !== undefined) state.errorRate = Math.min(1, Math.max(0, Number(errorRate)));
  if (latencyMs !== undefined) state.latencyMs = Math.max(0, Number(latencyMs));
  if (seed !== undefined) state.seed = Number(seed) >>> 0;
  rand = rng(state.seed);
  counters = { requests: 0, injected500: 0, relayed: 0, upstreamErrors: 0, clientGone: 0, since: new Date().toISOString() };
}
apply({ errorRate: process.env.FAULT_ERROR_RATE || 0, latencyMs: process.env.FAULT_LATENCY_MS || 0, seed: process.env.FAULT_SEED || 42 });

const json = (res, code, body) => {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  if (req.url === '/__fault') {
    if (req.method === 'GET') return json(res, 200, { ...state, counters });
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        try { apply(JSON.parse(b || '{}')); } catch (e) { return json(res, 400, { error: String(e.message) }); }
        console.log(JSON.stringify({ event: 'fault_set', at: Date.now(), ...state }));
        json(res, 200, { ...state, counters });
      });
      return;
    }
    return json(res, 405, {});
  }

  counters.requests++;
  const inject = rand() < state.errorRate; // tirage fait a l'arrivee : la sequence ne depend que de l'ordre des requetes
  let gone = false;
  res.on('close', () => { if (!res.writableEnded) gone = true; });

  const go = () => {
    if (gone) { counters.clientGone++; req.resume(); return; }
    if (inject) {
      counters.injected500++;
      req.resume();
      return json(res, 500, { statusCode: 500, message: 'Internal server error' });
    }
    const up = http.request({
      hostname: TARGET.hostname, port: TARGET.port, method: req.method, path: req.url,
      headers: { ...req.headers, host: TARGET.host },
    }, (ur) => {
      counters.relayed++;
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    });
    up.on('error', () => { counters.upstreamErrors++; json(res, 502, { statusCode: 502, message: 'Bad Gateway (fault-proxy)' }); });
    res.on('close', () => up.destroy());
    req.pipe(up);
  };
  if (state.latencyMs > 0) setTimeout(go, state.latencyMs); else go();
});

server.listen(PORT, '127.0.0.1', () => console.log(JSON.stringify({ event: 'fault_proxy_started', at: Date.now(), port: PORT, target: TARGET.href, ...state })));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
