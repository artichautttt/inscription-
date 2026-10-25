#!/usr/bin/env node
/**
 * Rollback automatique du canary.
 * Lit les metriques du gateway ; si le taux d'erreur de la version v2 depasse le seuil
 * pendant N controles consecutifs (avec un minimum de requetes), desactive le feature
 * flag via l'API d'administration Unleash. Ne reactive JAMAIS le flag tout seul.
 * Aucune dependance (Node >= 18).
 */
const fs = require('fs');

const cfg = {
  metricsUrl: process.env.GATEWAY_METRICS_URL || 'http://127.0.0.1:3000/internal/canary-metrics',
  unleashUrl: (process.env.UNLEASH_ADMIN_URL || 'http://127.0.0.1:4242').replace(/\/$/, ''),
  token: process.env.UNLEASH_ADMIN_TOKEN || '',
  flag: process.env.FLAG || 'courses-v2-canary',
  project: process.env.PROJECT || 'default',
  environment: process.env.ENVIRONMENT || 'development',
  intervalMs: Number(process.env.CHECK_INTERVAL_MS || 1000),
  threshold: Number(process.env.ERROR_THRESHOLD || 0.5),
  consecutive: Number(process.env.CONSECUTIVE_CHECKS || 3),
  minRequests: Number(process.env.MIN_REQUESTS || 10),
  eventsFile: process.env.EVENTS_FILE || '',
};

function log(event, extra = {}) {
  const line = JSON.stringify({ event, at: Date.now(), iso: new Date().toISOString(), ...extra });
  console.log(line);
  if (cfg.eventsFile) fs.appendFileSync(cfg.eventsFile, line + '\n');
}

async function disableFlag() {
  const url = `${cfg.unleashUrl}/api/admin/projects/${cfg.project}/features/${cfg.flag}/environments/${cfg.environment}/off`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: cfg.token } });
      if (res.ok) return { ok: true, status: res.status, attempt };
      log('disable_failed', { status: res.status, attempt });
    } catch (e) {
      log('disable_failed', { error: String(e.message || e), attempt });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false };
}

let state = 'WATCHING'; // WATCHING -> ROLLED_BACK (fin : redemarrer le watcher pour rearmer)
let breaches = 0;

async function tick() {
  let snap;
  try {
    const res = await fetch(cfg.metricsUrl, { signal: AbortSignal.timeout(1500) });
    snap = await res.json();
  } catch (e) {
    log('metrics_unreachable', { error: String(e.message || e) });
    return; // pas d'action sur une mesure absente
  }
  const v2 = snap.v2;

  if (state === 'ROLLED_BACK') return; // rien a faire tant que le watcher n'est pas redemarre

  const breach = v2.requests >= cfg.minRequests && v2.errorRate >= cfg.threshold;
  breaches = breach ? breaches + 1 : 0;
  if (breach) log('breach', { count: breaches, requests: v2.requests, errorRate: v2.errorRate, p95Ms: v2.p95Ms });
  if (breaches >= cfg.consecutive) {
    log('rollback_triggered', { requests: v2.requests, errorRate: v2.errorRate });
    const r = await disableFlag();
    if (r.ok) {
      state = 'ROLLED_BACK';
      log('flag_disabled', { status: r.status, attempt: r.attempt });
    } else {
      log('rollback_failed');
      breaches = 0;
    }
  }
}

if (!cfg.token) {
  console.error('UNLEASH_ADMIN_TOKEN manquant');
  process.exit(1);
}
log('watcher_started', {
  threshold: cfg.threshold, consecutive: cfg.consecutive, minRequests: cfg.minRequests, intervalMs: cfg.intervalMs,
});
setInterval(() => tick().catch((e) => log('tick_error', { error: String(e) })), cfg.intervalMs);
