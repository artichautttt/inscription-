#!/usr/bin/env node
/**
 * Resume d'un run : node summarize.js run.csv events.jsonl  -> JSON sur stdout
 * Une reponse est une ERREUR si status = 0, 599 ou >= 500.
 */
const fs = require('fs');
const [csvFile, evFile] = process.argv.slice(2);
const rows = fs.readFileSync(csvFile, 'utf8').trim().split('\n').slice(1).map((l) => {
  const [sent, user, status, version, lat] = l.split(',');
  return { sent: +sent, user, status: +status, version, lat: +lat, err: +status === 0 || +status === 599 || +status >= 500 };
});
const events = fs.existsSync(evFile) ? fs.readFileSync(evFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const first = (name) => events.find((e) => e.event === name);
const faultAt = first('fault_injected')?.at;
const detected = first('rollback_triggered')?.at;
const disabled = first('flag_disabled')?.at;
const reenabledAt = first('flag_reenabled')?.at ?? first('flag_enabled')?.at; // manuel (D) ou automatique (E)

const pct = (a, b) => (b ? +((a / b) * 100).toFixed(2) : 0);
const seg = (from, to) => rows.filter((r) => r.sent >= from && r.sent < to);
const t0 = rows.length ? rows[0].sent : 0;
const end = rows.length ? rows[rows.length - 1].sent + 1 : 0;
const phase = (list) => ({ requests: list.length, errors: list.filter((r) => r.err).length, errorRatePct: pct(list.filter((r) => r.err).length, list.length) });
// Derniere reponse v2 apres la desactivation du flag ; en cas de reactivation (scenario D), on s'arrete a la reactivation.
const lastV2 = [...rows].reverse().find((r) => r.version === 'v2' && disabled && r.sent >= disabled && (!reenabledAt || r.sent < reenabledAt));
const lastV2Err = [...rows].reverse().find((r) => r.version === 'v2' && r.err);

const out = {
  total: phase(rows),
  v2Share: pct(rows.filter((r) => r.version === 'v2').length, rows.length),
  faultAt: faultAt ?? null,
  detectionDelayMs: faultAt && detected ? detected - faultAt : null,
  rollbackDelayMs: faultAt && disabled ? disabled - faultAt : null,
  // Temps entre la desactivation du flag et la derniere reponse servie par v2 (propagation du flag jusqu'au gateway).
  flagPropagationMs: disabled && lastV2 ? Math.max(0, lastV2.sent - disabled) : null,
  lastV2ErrorAfterFaultMs: faultAt && lastV2Err ? lastV2Err.sent - faultAt : null,
  beforeFault: faultAt ? phase(seg(t0, faultAt)) : null,
  faultToRollback: faultAt && disabled ? phase(seg(faultAt, disabled)) : null,
  afterRollback: disabled ? phase(seg(disabled, end)) : null,
  rolledBack: !!disabled,
  // Scenario E : du redemarrage de v2 a la reactivation automatique du flag par le watcher.
  autoRecoveryDelayMs: first('flag_enabled') && first('v2_restarted') ? first('flag_enabled').at - first('v2_restarted').at : null,
  autoRecoveryProbesOk: first('v2_healthy')?.consecutiveProbes ?? null,
  // Recovery (scenario D) : apres la reactivation manuelle, des reponses v2 en 200 reapparaissent.
  recovery: reenabledAt ? (() => {
    const after = rows.filter((r) => r.sent >= reenabledAt);
    const v2ok = after.filter((r) => r.version === 'v2' && r.status === 200);
    const v2err = after.filter((r) => r.version === 'v2' && r.err);
    return { v2OkAfterReenable: v2ok.length, v2ErrorsAfterReenable: v2err.length, verified: v2ok.length > 0 && v2err.length === 0 };
  })() : null,
};
console.log(JSON.stringify(out, null, 2));
