// Nettoyage : supprime les inscriptions aux cours "k6-*", puis ces cours.
// Les comptes "k6.*" restent (aucune route de suppression de compte dans le gateway).
// Lancement : k6 run -e BASE_URL=... -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... k6/cleanup.js
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
export const options = { vus: 1, iterations: 1 };

function liste(r) { const b = r.json(); return Array.isArray(b) ? b : (b && b.data) || []; }

export default function () {
  const login = http.post(`${BASE}/api/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } });
  if (login.status !== 200) fail(`Connexion admin impossible : ${login.status} ${login.body}`);
  const auth = { Authorization: `Bearer ${login.json('token')}` };

  const coursK6 = liste(http.get(`${BASE}/api/courses`)).filter((c) => String(c.titre).startsWith('k6-'));
  let inscr = 0, suppr = 0;
  for (const c of coursK6) {
    const ins = liste(http.get(`${BASE}/api/enrollments/by-course/${c.id}`, { headers: auth }));
    for (const e of ins) {
      const r = http.del(`${BASE}/api/enrollments/${e.id}`, null, { headers: auth });
      if (r.status === 204 || r.status === 200) inscr++;
    }
    const r = http.del(`${BASE}/api/courses/${c.id}`, null, { headers: auth });
    if (check(r, { 'cours supprimé': (x) => x.status === 204 || x.status === 200 })) suppr++;
    else console.error(`Échec suppression ${c.titre} : ${r.status} ${r.body}`);
  }
  console.log(`Inscriptions supprimées : ${inscr} ; cours supprimés : ${suppr} / ${coursK6.length}`);
}
