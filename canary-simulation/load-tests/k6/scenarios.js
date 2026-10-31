// Tests de charge par scénarios (S1 visiteur, S2 étudiant, S3 = S1 + S2 en parallèle à 80/20).
// Lancement (depuis canary-simulation/load-tests) : k6 run -e BASE_URL=... -e PROFIL=smoke k6/scenarios.js   (smoke | load | stress | spike | soak)
// Synthese : results/<PROFIL>.json (handleSummary, sans dependance reseau) + resume texte en console.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Variable obligatoire : aucune adresse par défaut dans le code (ce script n'utilise pas de compte admin).
function requis(nom) {
  const v = __ENV[nom];
  if (!v) throw new Error(`Variable d'environnement ${nom} manquante : passer -e ${nom}=... ou la définir dans le terminal (voir README).`);
  return v;
}
const BASE = requis('BASE_URL');
const PROFIL = __ENV.PROFIL || 'smoke';
const JSON_H = { 'Content-Type': 'application/json' };

// --- Métriques du canary (par version) et des erreurs serveur ---
const latenceV1 = new Trend('canary_latence_v1', true);
const latenceV2 = new Trend('canary_latence_v2', true);
const serviV1 = new Counter('canary_servi_v1');
const serviV2 = new Counter('canary_servi_v2');
const erreursV1 = new Counter('canary_erreurs_v1');
const erreursV2 = new Counter('canary_erreurs_v2');
const erreurs5xx = new Counter('erreurs_serveur_5xx');

// --- Profils : nombre TOTAL d'utilisateurs virtuels (réparti 80 % S1 / 20 % S2) ---
const PROFILS = {
  smoke:  [{ duration: '5s', target: 2 }, { duration: '55s', target: 2 }],
  load:   [{ duration: '1m', target: 30 }, { duration: '5m', target: 30 }, { duration: '30s', target: 0 }],
  stress: [{ duration: '1m', target: 30 }, { duration: '2m', target: 30 },
           { duration: '1m', target: 60 }, { duration: '2m', target: 60 },
           { duration: '1m', target: 100 }, { duration: '2m', target: 100 },
           { duration: '1m', target: 150 }, { duration: '2m', target: 150 },
           { duration: '1m', target: 200 }, { duration: '2m', target: 200 },
           { duration: '1m', target: 0 }],
  spike:  [{ duration: '10s', target: 5 }, { duration: '50s', target: 5 }, { duration: '10s', target: 100 }, { duration: '1m', target: 100 },
           { duration: '10s', target: 5 }, { duration: '1m', target: 5 }],
  soak:   [{ duration: '1m', target: 20 }, { duration: '15m', target: 20 }, { duration: '30s', target: 0 }],
};
const etapes = PROFILS[PROFIL];
if (!etapes) throw new Error(`Profil inconnu : ${PROFIL}`);
const part = (k) => etapes.map((e) => ({ duration: e.duration, target: e.target === 0 ? 0 : Math.max(1, Math.round(e.target * k)) }));

const seuilsStricts = PROFIL === 'smoke' || PROFIL === 'load';
export const options = {
  scenarios: {
    S1_visiteur: { executor: 'ramping-vus', startVUs: 0, stages: part(0.8), exec: 'visiteur', gracefulRampDown: '10s' },
    S2_etudiant: { executor: 'ramping-vus', startVUs: 0, stages: part(0.2), exec: 'etudiant', gracefulRampDown: '10s' },
  },
  thresholds: seuilsStricts ? {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{scenario:S1_visiteur}': ['p(95)<500'],
    'http_req_duration{scenario:S2_etudiant}': ['p(95)<500'],
  } : {
    // stress / spike / soak : on mesure, et on arrête seulement si plus de 10 % d'erreurs
    'http_req_failed': [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '30s' }],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function reflexion() { sleep(1 + Math.random() * 2); }
function liste(r) { try { const b = r.json(); return Array.isArray(b) ? b : (b && b.data) || []; } catch (e) { return []; } }
function suivre(r) {
  if (r.status >= 500 || r.status === 0) erreurs5xx.add(1);
  const v = r.headers['X-Backend-Version'];
  const ko = r.status >= 500 || r.status === 0;
  if (v === 'v1') { serviV1.add(1); latenceV1.add(r.timings.duration); if (ko) erreursV1.add(1); }
  if (v === 'v2') { serviV2.add(1); latenceV2.add(r.timings.duration); if (ko) erreursV2.add(1); }
}

// S1 — visiteur : catalogue puis détail d'un cours
export function visiteur() {
  const uid = `user-${Math.floor(Math.random() * 200) + 1}`;
  const h = { 'X-User-Id': uid };
  const r = http.get(`${BASE}/api/courses`, { headers: h, tags: { name: 'GET catalogue' } });
  check(r, { 'S1 catalogue 200': (x) => x.status === 200 });
  suivre(r);
  const cours = liste(r);
  if (cours.length) {
    reflexion();
    const c = cours[Math.floor(Math.random() * cours.length)];
    const d = http.get(`${BASE}/api/courses/${c.id}`, { headers: h, tags: { name: 'GET détail cours' } });
    check(d, { 'S1 détail 200': (x) => x.status === 200 });
    suivre(d);
  }
  reflexion();
}

// S2 — étudiant : création de compte, connexion, catalogue, inscription, mes inscriptions
export function etudiant() {
  const email = `k6.${__VU}.${__ITER}.${Date.now()}@example.com`;
  // Mot de passe aleatoire, jamais conserve : aucun secret dans le depot, et les comptes k6.* restants
  // sur le serveur ne sont pas utilisables apres coup. (Le register exige au moins 6 caracteres.)
  const password = `k6-${Math.random().toString(36).slice(2, 12)}${__VU}`;

  group('compte', () => {
    const reg = http.post(`${BASE}/api/auth/register`,
      JSON.stringify({ nom: 'Charge', prenom: `VU${__VU}`, email, telephone: '0600000000', password }),
      { headers: JSON_H, tags: { name: 'POST register' } });
    check(reg, { 'S2 register 201': (x) => x.status === 201 });
    if (reg.status >= 500 || reg.status === 0) erreurs5xx.add(1);
  });
  reflexion();

  const log = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password }),
    { headers: JSON_H, tags: { name: 'POST login' } });
  check(log, { 'S2 login 200': (x) => x.status === 200 });
  if (log.status >= 500 || log.status === 0) erreurs5xx.add(1);
  if (log.status !== 200) return;
  const auth = { ...JSON_H, Authorization: `Bearer ${log.json('token')}` };
  reflexion();

  const cat = http.get(`${BASE}/api/courses`, { headers: auth, tags: { name: 'GET catalogue' } });
  check(cat, { 'S2 catalogue 200': (x) => x.status === 200 });
  suivre(cat);
  const coursK6 = liste(cat).filter((c) => String(c.titre).startsWith('k6-'));
  reflexion();

  if (coursK6.length) {
    const c = coursK6[Math.floor(Math.random() * coursK6.length)];
    const ins = http.post(`${BASE}/api/enrollments`, JSON.stringify({ coursId: c.id }),
      { headers: auth, tags: { name: 'POST inscription' } });
    check(ins, { 'S2 inscription 201': (x) => x.status === 201 || x.status === 200 });
    if (ins.status >= 500 || ins.status === 0) erreurs5xx.add(1);
    reflexion();
  }

  const mes = http.get(`${BASE}/api/enrollments`, { headers: auth, tags: { name: 'GET mes inscriptions' } });
  check(mes, { 'S2 mes inscriptions 200': (x) => x.status === 200 });
  if (mes.status >= 500 || mes.status === 0) erreurs5xx.add(1);
  reflexion();
}

// --- Synthese de fin de test -------------------------------------------------------------------
// handleSummary remplace le resume par defaut : on ecrit le JSON complet (meme format que --summary-export,
// y compris les sous-metriques par scenario utilisees par les seuils) ET un resume texte en console.
// Aucune dependance reseau (le textSummary officiel de jslib.k6.io n'est pas embarque dans k6 v2.2.0).
const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));
export function handleSummary(data) {
  const dossier = __ENV.SUMMARY_DIR || 'results';
  const lignes = ['', `Resume k6 — profil ${PROFIL}`];
  for (const [nom, m] of Object.entries(data.metrics).sort(([a], [b]) => a.localeCompare(b))) {
    const seuils = m.thresholds ? ' ' + Object.entries(m.thresholds).map(([s, r]) => `[${r.ok ? 'OK' : 'ECHEC'} ${s}]`).join(' ') : '';
    lignes.push(`  ${nom.padEnd(52)} ${Object.entries(m.values).map(([k, v]) => `${k}=${fmt(v)}`).join(' ')}${seuils}`);
  }
  lignes.push(`  -> synthese JSON : ${dossier}/${PROFIL}.json`);
  return { stdout: lignes.join('\n') + '\n\n', [`${dossier}/${PROFIL}.json`]: JSON.stringify(data, null, 2) };
}
