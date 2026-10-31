#!/usr/bin/env node
/**
 * Generateur de charge : GET /api/courses a debit constant, avec N utilisateurs distincts
 * (en-tete X-User-Id) afin que le canary, collant a l'utilisateur, route une partie vers v2.
 * Ecrit un CSV : sent_ms,user,status,version,latency_ms
 * Usage : node load.js --duration 90 --rps 20 --users 200 --out run.csv [--url http://127.0.0.1:3000/api/courses]
 */
const fs = require('fs');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []),
);
const duration = Number(args.duration || 90);
const rps = Number(args.rps || 20);
const users = Number(args.users || 200);
const out = args.out || 'run.csv';
const url = args.url || 'http://127.0.0.1:3000/api/courses';
const timeoutMs = Number(args.timeout || 6000);

const stream = fs.createWriteStream(out);
stream.write('sent_ms,user,status,version,latency_ms\n');
let n = 0;
let inflight = 0;

async function one() {
  const user = `user-${n++ % users}`;
  const sent = Date.now();
  inflight++;
  let status = 0;
  let version = '';
  try {
    const res = await fetch(url, { headers: { 'X-User-Id': user }, signal: AbortSignal.timeout(timeoutMs) });
    status = res.status;
    version = res.headers.get('x-backend-version') || '';
    await res.arrayBuffer();
  } catch (e) {
    status = e.name === 'TimeoutError' ? 599 : 0; // 599 = pas de reponse dans le delai ; 0 = connexion impossible
  }
  inflight--;
  stream.write(`${sent},${user},${status},${version},${Date.now() - sent}\n`);
}

const timer = setInterval(() => { for (let i = 0; i < Math.max(1, Math.round(rps / 10)); i++) one(); }, 1000 / (rps / Math.max(1, Math.round(rps / 10))));
setTimeout(() => {
  clearInterval(timer);
  const wait = setInterval(() => {
    if (inflight === 0) { clearInterval(wait); stream.end(() => process.exit(0)); }
  }, 100);
}, duration * 1000);
