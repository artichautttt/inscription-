// Tests de charge par PARCOURS UTILISATEURS réalistes (temps de lecture explicites).
// Lancement : k6 run -e BASE_URL=... -e PROFIL=smoke -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... k6/scenarios-parcours.js
//   PROFIL : smoke | load | stress | spike | soak
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Variables obligatoires : aucune adresse ni identifiant par défaut dans le code.
// Une variable absente arrête k6 dès le démarrage (P4 ne peut plus échouer en silence).
function requis(nom) {
  const v = __ENV[nom];
  if (!v) throw new Error(`Variable d'environnement ${nom} manquante : passer -e ${nom}=... ou la définir dans le terminal (voir README).`);
  return v;
}
const BASE = requis('BASE_URL');
const ADMIN_EMAIL = requis('ADMIN_EMAIL');
const ADMIN_PASSWORD = requis('ADMIN_PASSWORD');
const PROFIL = __ENV.PROFIL || 'smoke';
const JSON_H = { 'Content-Type': 'application/json' };
const NB_HABITUES = Number(__ENV.NB_HABITUES || 50);

// ---------- Métriques ----------
const latV1 = new Trend('canary_latence_v1', true);
const latV2 = new Trend('canary_latence_v2', true);
const serviV1 = new Counter('canary_servi_v1');
const serviV2 = new Counter('canary_servi_v2');
const errV1 = new Counter('canary_erreurs_v1');
const errV2 = new Counter('canary_erreurs_v2');
const err5xx = new Counter('erreurs_serveur_5xx');
const dureeParcours = {
  P1: new Trend('parcours_P1_visiteur_duree', true),
  P2: new Trend('parcours_P2_nouvel_etudiant_duree', true),
  P3: new Trend('parcours_P3_etudiant_habitue_duree', true),
  P4: new Trend('parcours_P4_admin_duree', true),
};

// ---------- Profils : nombre TOTAL d'utilisateurs virtuels ----------
const PROFILS = {
  smoke:  [{ duration: '5s', target: 4 }, { duration: '1m55s', target: 4 }],
  load:   [{ duration: '1m', target: 50 }, { duration: '6m', target: 50 }, { duration: '30s', target: 0 }],
  stress: [{ duration: '1m', target: 50 },  { duration: '2m', target: 50 },
           { duration: '1m', target: 100 }, { duration: '2m', target: 100 },
           { duration: '1m', target: 200 }, { duration: '2m', target: 200 },
           { duration: '1m', target: 300 }, { duration: '2m', target: 300 },
           { duration: '1m', target: 400 }, { duration: '2m', target: 400 },
           { duration: '1m', target: 0 }],
  spike:  [{ duration: '10s', target: 10 }, { duration: '1m', target: 10 },
           { duration: '10s', target: 200 }, { duration: '2m', target: 200 },
           { duration: '10s', target: 10 }, { duration: '1m', target: 10 }],
  soak:   [{ duration: '1m', target: 40 }, { duration: '15m', target: 40 }, { duration: '30s', target: 0 }],
};
const etapes = PROFILS[PROFIL];
if (!etapes) throw new Error(`Profil inconnu : ${PROFIL}`);
// Répartition du trafic : 60 % visiteurs, 20 % nouveaux étudiants, 15 % habitués, 5 % admins
const POIDS = { P1: 0.60, P2: 0.20, P3: 0.15, P4: 0.05 };
const part = (k) => etapes.map((e) => ({
  duration: e.duration, target: e.target === 0 ? 0 : Math.max(1, Math.round(e.target * k)),
}));

const stricts = PROFIL === 'smoke' || PROFIL === 'load';
export const options = {
  scenarios: {
    P1_visiteur:         { executor: 'ramping-vus', startVUs: 0, stages: part(POIDS.P1), exec: 'visiteur',       gracefulRampDown: '30s' },
    P2_nouvel_etudiant:  { executor: 'ramping-vus', startVUs: 0, stages: part(POIDS.P2), exec: 'nouvelEtudiant', gracefulRampDown: '30s' },
    P3_etudiant_habitue: { executor: 'ramping-vus', startVUs: 0, stages: part(POIDS.P3), exec: 'etudiantHabitue', gracefulRampDown: '30s' },
    P4_admin:            { executor: 'ramping-vus', startVUs: 0, stages: part(POIDS.P4), exec: 'admin',          gracefulRampDown: '30s' },
  },
  thresholds: stricts ? {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{scenario:P1_visiteur}': ['p(95)<500'],
    'http_req_duration{scenario:P2_nouvel_etudiant}': ['p(95)<800'],
    'http_req_duration{scenario:P3_etudiant_habitue}': ['p(95)<800'],
    'http_req_duration{scenario:P4_admin}': ['p(95)<800'],
  } : {
    'http_req_failed': [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '30s' }],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  setupTimeout: '5m',
};

// ---------- Outils ----------
// Pause de lecture : durée nominale ± 20 % (évite que tous les utilisateurs agissent en même temps)
function lire(secondes) { sleep(secondes * (0.8 + Math.random() * 0.4)); }
function liste(r) { try { const b = r.json(); return Array.isArray(b) ? b : (b && b.data) || []; } catch (e) { return []; } }
function hasard(t) { return t[Math.floor(Math.random() * t.length)]; }
function motDePasse() { return `k6-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`; }
function erreur(r) { if (r.status >= 500 || r.status === 0) err5xx.add(1); }
function suivre(r) {
  erreur(r);
  const v = r.headers['X-Backend-Version'];
  const ko = r.status >= 500 || r.status === 0;
  if (v === 'v1') { serviV1.add(1); latV1.add(r.timings.duration); if (ko) errV1.add(1); }
  if (v === 'v2') { serviV2.add(1); latV2.add(r.timings.duration); if (ko) errV2.add(1); }
}
function connexion(email, password, tag) {
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password }), { headers: JSON_H, tags: { name: 'POST login' } });
  check(r, { [`${tag} connexion 200`]: (x) => x.status === 200 });
  erreur(r);
  return r.status === 200 ? { ...JSON_H, Authorization: `Bearer ${r.json('token')}` } : null;
}
function catalogue(headers, tag) {
  const r = http.get(`${BASE}/api/courses`, { headers, tags: { name: 'GET catalogue' } });
  check(r, { [`${tag} catalogue 200`]: (x) => x.status === 200 });
  suivre(r);
  return liste(r).filter((c) => String(c.titre).startsWith('k6-'));
}
function detail(headers, c, tag) {
  const r = http.get(`${BASE}/api/courses/${c.id}`, { headers, tags: { name: 'GET détail cours' } });
  check(r, { [`${tag} détail 200`]: (x) => x.status === 200 });
  suivre(r);
}

// ---------- Préparation : comptes "habitués" (P3) ----------
export function setup() {
  const comptes = [];
  for (let i = 0; i < NB_HABITUES; i++) {
    const email = `k6.habitue.${Date.now()}.${i}@example.com`;
    const password = motDePasse();
    const r = http.post(`${BASE}/api/auth/register`,
      JSON.stringify({ nom: 'Habitue', prenom: `H${i}`, email, telephone: '0600000000', password }),
      { headers: JSON_H, tags: { name: 'setup register' } });
    if (r.status === 201) comptes.push({ email, password });
  }
  if (!comptes.length) throw new Error('Aucun compte habitué créé : vérifier l’API.');
  return { comptes };
}

// ---------- P1 : visiteur anonyme ----------
// Arrive sur le catalogue (lit 5 s), ouvre un cours (lit 10 s), revient au catalogue (3 s),
// ouvre un second cours (lit 8 s), puis quitte le site.
export function visiteur() {
  const t0 = Date.now();
  const h = { 'X-User-Id': `visiteur-${Math.floor(Math.random() * 1000)}` };
  group('P1 visiteur', () => {
    const cours = catalogue(h, 'P1'); lire(5);
    if (cours.length) { detail(h, hasard(cours), 'P1'); lire(10); }
    catalogue(h, 'P1'); lire(3);
    if (cours.length) { detail(h, hasard(cours), 'P1'); lire(8); }
  });
  dureeParcours.P1.add(Date.now() - t0);
}

// ---------- P2 : nouvel étudiant ----------
// Remplit le formulaire d'inscription (15 s), crée son compte, se connecte, parcourt le catalogue (10 s),
// lit le détail d'un cours (8 s), s'inscrit à ce cours, consulte ses inscriptions (5 s), puis quitte.
export function nouvelEtudiant() {
  const t0 = Date.now();
  const email = `k6.nouveau.${__VU}.${__ITER}.${Date.now()}@example.com`;
  const password = motDePasse();
  group('P2 nouvel étudiant', () => {
    lire(15);
    const reg = http.post(`${BASE}/api/auth/register`,
      JSON.stringify({ nom: 'Nouveau', prenom: `VU${__VU}`, email, telephone: '0600000000', password }),
      { headers: JSON_H, tags: { name: 'POST register' } });
    check(reg, { 'P2 création de compte 201': (x) => x.status === 201 });
    erreur(reg);
    lire(2);
    const auth = connexion(email, password, 'P2');
    if (!auth) return;
    const cours = catalogue(auth, 'P2'); lire(10);
    if (!cours.length) return;
    const c = hasard(cours);
    detail(auth, c, 'P2'); lire(8);
    const ins = http.post(`${BASE}/api/enrollments`, JSON.stringify({ coursId: c.id }), { headers: auth, tags: { name: 'POST inscription' } });
    check(ins, { 'P2 inscription au cours 201': (x) => x.status === 201 || x.status === 200 });
    erreur(ins);
    lire(3);
    const mes = http.get(`${BASE}/api/enrollments`, { headers: auth, tags: { name: 'GET mes inscriptions' } });
    check(mes, { 'P2 mes inscriptions 200': (x) => x.status === 200 });
    erreur(mes);
    lire(5);
  });
  dureeParcours.P2.add(Date.now() - t0);
}

// ---------- P3 : étudiant habitué ----------
// Se connecte avec son compte (saisie 5 s), consulte ses inscriptions (5 s), parcourt le catalogue (10 s),
// s'inscrit à un nouveau cours, vérifie ses inscriptions (5 s), puis quitte.
export function etudiantHabitue(data) {
  const t0 = Date.now();
  const compte = data.comptes[(__VU + __ITER) % data.comptes.length];
  group('P3 étudiant habitué', () => {
    lire(5);
    const auth = connexion(compte.email, compte.password, 'P3');
    if (!auth) return;
    lire(2);
    const mes = http.get(`${BASE}/api/enrollments`, { headers: auth, tags: { name: 'GET mes inscriptions' } });
    check(mes, { 'P3 mes inscriptions 200': (x) => x.status === 200 });
    erreur(mes);
    const dejaInscrits = new Set(liste(mes).map((e) => e.coursId));
    lire(5);
    const cours = catalogue(auth, 'P3').filter((c) => !dejaInscrits.has(c.id)); lire(10);
    if (cours.length) {
      const ins = http.post(`${BASE}/api/enrollments`, JSON.stringify({ coursId: hasard(cours).id }), { headers: auth, tags: { name: 'POST inscription' } });
      // 409 possible si deux itérations du même compte choisissent le même cours : comportement métier normal
      check(ins, { 'P3 inscription 201 ou 409': (x) => x.status === 201 || x.status === 200 || x.status === 409 });
      erreur(ins);
      lire(3);
    }
    const verif = http.get(`${BASE}/api/enrollments`, { headers: auth, tags: { name: 'GET mes inscriptions' } });
    check(verif, { 'P3 vérification 200': (x) => x.status === 200 });
    erreur(verif);
    lire(5);
  });
  dureeParcours.P3.add(Date.now() - t0);
}

// ---------- P4 : administrateur ----------
// Se connecte (5 s), consulte le catalogue (8 s), ouvre la liste des inscrits d'un cours (10 s),
// en consulte un second (10 s), puis quitte.
export function admin() {
  const t0 = Date.now();
  group('P4 administrateur', () => {
    lire(5);
    const auth = connexion(ADMIN_EMAIL, ADMIN_PASSWORD, 'P4');
    if (!auth) return;
    const cours = catalogue(auth, 'P4'); lire(8);
    for (let i = 0; i < 2 && cours.length; i++) {
      const r = http.get(`${BASE}/api/enrollments/by-course/${hasard(cours).id}`, { headers: auth, tags: { name: 'GET inscrits d’un cours' } });
      check(r, { 'P4 inscrits du cours 200': (x) => x.status === 200 });
      erreur(r);
      lire(10);
    }
  });
  dureeParcours.P4.add(Date.now() - t0);
}

// ---------- Synthèse JSON (sans dépendance) ----------
export function handleSummary(data) {
  const out = {};
  // setup_data contient les emails ET mots de passe des comptes habitues : on ne l'ecrit pas dans le JSON (fichier versionne).
  const { setup_data, ...sansSecrets } = data;
  out[`results/parcours-${PROFIL}.json`] = JSON.stringify(sansSecrets, null, 2);
  const m = data.metrics;
  const v = (k, s) => (m[k] && m[k].values && m[k].values[s] !== undefined ? m[k].values[s] : null);
  const lignes = [
    `Profil ${PROFIL}`,
    `Requêtes : ${v('http_reqs', 'count')}  |  débit : ${v('http_reqs', 'rate') && v('http_reqs', 'rate').toFixed(1)} req/s`,
    `Erreurs (http_req_failed) : ${(100 * (v('http_req_failed', 'rate') || 0)).toFixed(2)} %  |  5xx : ${v('erreurs_serveur_5xx', 'count') || 0}`,
    `Latence globale p50/p95/p99 : ${v('http_req_duration', 'med')} / ${v('http_req_duration', 'p(95)')} / ${v('http_req_duration', 'p(99)')} ms`,
    `Canary : v1 ${v('canary_servi_v1', 'count') || 0} (p95 ${v('canary_latence_v1', 'p(95)')} ms), v2 ${v('canary_servi_v2', 'count') || 0} (p95 ${v('canary_latence_v2', 'p(95)')} ms)`,
    'Seuils :',
  ];
  for (const [k, met] of Object.entries(m)) {
    if (met.thresholds) for (const [t, r] of Object.entries(met.thresholds)) lignes.push(`  ${r.ok ? 'OK ' : 'KO '} ${k} ${t}`);
  }
  out.stdout = lignes.join('\n') + '\n';
  return out;
}
