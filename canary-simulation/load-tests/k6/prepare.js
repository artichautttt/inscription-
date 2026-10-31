// Préparation des données de test : crée des cours "k6-cours-NN" à très grande capacité.
// Lancement : k6 run -e BASE_URL=... -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... k6/prepare.js
import http from 'k6/http';
import { check, fail } from 'k6';

// Variables obligatoires : aucune adresse ni identifiant par défaut dans le code.
function requis(nom) {
  const v = __ENV[nom];
  if (!v) throw new Error(`Variable d'environnement ${nom} manquante : passer -e ${nom}=... ou la définir dans le terminal (voir README).`);
  return v;
}
const BASE = requis('BASE_URL');
const ADMIN_EMAIL = requis('ADMIN_EMAIL');
const ADMIN_PASSWORD = requis('ADMIN_PASSWORD');
const NB_COURS = Number(__ENV.NB_COURS || 20);

export const options = { vus: 1, iterations: 1 };

export default function () {
  const login = http.post(`${BASE}/api/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } });
  if (!check(login, { 'connexion admin 200': (r) => r.status === 200 })) {
    fail(`Connexion admin impossible : ${login.status} ${login.body}`);
  }
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.json('token')}` };

  // Cours "k6-" déjà présents : on ne les recrée pas.
  const liste = http.get(`${BASE}/api/courses`);
  const cours = Array.isArray(liste.json()) ? liste.json() : (liste.json('data') || []);
  const existants = new Set(cours.map((c) => c.titre));

  let crees = 0;
  for (let i = 1; i <= NB_COURS; i++) {
    const titre = `k6-cours-${String(i).padStart(2, '0')}`;
    if (existants.has(titre)) continue;
    const r = http.post(`${BASE}/api/courses`, JSON.stringify({ titre, capacite: 100000 }), { headers: auth });
    if (check(r, { 'cours créé (201)': (x) => x.status === 201 || x.status === 200 })) crees++;
    else console.error(`Échec création ${titre} : ${r.status} ${r.body}`);
  }
  console.log(`Cours créés : ${crees} ; déjà présents : ${existants.size ? [...existants].filter((t) => t.startsWith('k6-')).length : 0}`);
}
