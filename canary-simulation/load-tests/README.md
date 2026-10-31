# Tests de charge (k6) — VM de test (pm2 + nginx)

Tests lancés **depuis un poste client** (Windows) vers une **VM de test** (Oracle Cloud, pm2 + nginx) qui héberge l'application et le canary courses v1/v2. Aucun code applicatif n'est modifié par ces tests.

> Les résultats ci-dessous ont été mesurés le **27/10/2026** contre cette VM de test. Ils **ne sont pas représentatifs d'une production** : une seule petite VM, des données de test, et des latences qui incluent le trajet Internet entre le poste client et la VM.

## Contenu

| Fichier | Rôle |
|---|---|
| `k6/scenarios-parcours.js` | **Script principal** : 4 parcours utilisateurs réalistes (visiteur, nouvel étudiant, étudiant habitué, administrateur) joués en parallèle |
| `k6/scenarios.js` | Script préliminaire : S1 visiteur (80 %) et S2 étudiant (20 %) en parallèle |
| `k6/prepare.js` | Préparation : crée les cours de test `k6-cours-01` à `k6-cours-20` (capacité 100 000) avec un compte admin |
| `k6/cleanup.js` | Nettoyage : supprime les inscriptions aux cours `k6-*`, puis ces cours |
| `results/` | Synthèses JSON et sorties console des exécutions conservées (voir [Résultats conservés](#résultats-conservés)) |

## Chemin : `/api/api/...`

nginx relaie `/api/` vers le gateway **en retirant le préfixe** `/api`. Le gateway expose lui-même ses routes sous `/api/...`.
L'API publique est donc sous `http://<hôte>/api/api/...` : `BASE_URL` vaut `http://<hôte>/api`, et les scripts appellent `${BASE_URL}/api/courses`, etc.
Contre un gateway local sans nginx, `BASE_URL` vaut simplement l'adresse du gateway (par exemple `http://localhost:3000`).

## Prérequis

- k6 v2.2.0 (`winget install k6 --source winget`). Si `k6` n'est pas reconnu dans un terminal ouvert avant l'installation, ouvrir un nouveau terminal, ou utiliser `"C:\Program Files\k6\k6.exe"`.
- Un compte **ADMIN** de test (rôle donné en base), utilisé par `prepare.js`, `cleanup.js` et le parcours P4.
- Côté serveur, pendant chaque test : `vmstat -t 5 | tee ~/vmstat-<profil>.log`, puis après : `pm2 ls` et `pm2 logs rollback-watcher --lines 20 --nostream`.

## Variables d'environnement

Aucune adresse, aucun identifiant et aucun mot de passe n'ont de valeur par défaut dans le code. Si une variable obligatoire manque, k6 s'arrête **dès le démarrage** avec le message `Variable d'environnement <NOM> manquante : ...`.

| Variable | Scripts | Rôle | Défaut |
|---|---|---|---|
| `BASE_URL` | tous (**obligatoire**) | base publique, avant le second `/api` : `http://<BASE_URL>` | — |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | scenarios-parcours.js, prepare.js, cleanup.js (**obligatoires**) | compte admin de test | — |
| `PROFIL` | scenarios-parcours.js, scenarios.js | `smoke`, `load`, `stress`, `spike`, `soak` | `smoke` |
| `NB_HABITUES` | scenarios-parcours.js | nombre de comptes créés pour P3 | `50` |
| `NB_COURS` | prepare.js | nombre de cours `k6-cours-NN` | `20` |
| `SUMMARY_DIR` | scenarios.js | dossier de la synthèse JSON | `results` |
| `K6_WEB_DASHBOARD`, `K6_WEB_DASHBOARD_EXPORT` | (k6) | tableau de bord HTML exporté en fin de test | — |

Le mot de passe admin ne doit **jamais** être écrit dans un fichier versionné (`.env` et `*.secret` sont exclus par `.gitignore`). k6 lit aussi les variables d'environnement du terminal : le plus sûr est de le saisir de façon masquée dans la session (commande ci-dessous, valable sous Windows PowerShell 5.1 et PowerShell 7).

## Lancement (PowerShell, depuis `canary-simulation/load-tests`)

```powershell
mkdir results -Force
$env:BASE_URL = "http://<BASE_URL>"            # adresse de l'environnement de test
$env:ADMIN_EMAIL = "<ADMIN_EMAIL>"
$env:ADMIN_PASSWORD = [Net.NetworkCredential]::new("", (Read-Host "mot de passe admin" -AsSecureString)).Password
k6 run k6/prepare.js                             # 1 fois : crée les 20 cours k6-*
$env:K6_WEB_DASHBOARD = "true"
$env:K6_WEB_DASHBOARD_EXPORT = "results\parcours-smoke.html"; k6 run -e PROFIL=smoke k6/scenarios-parcours.js
# on ne continue que si le smoke passe ; puis les autres profils, UN SEUL A LA FOIS
# (changer K6_WEB_DASHBOARD_EXPORT et PROFIL a chaque fois ; vmstat sur le serveur avant chaque test)
k6 run k6/cleanup.js                             # tout a la fin
```

Les tableaux de bord HTML (`results/*.html`) sont **générés localement et non versionnés** : ils contiennent le chemin local du script. Les valeurs mesurées sont conservées dans les synthèses JSON et les sorties console.

## Script principal : `k6/scenarios-parcours.js` (parcours utilisateurs)

| Parcours | Part des VU | Étapes (temps de lecture nominal, ±20 % aléatoire) |
|---|---|---|
| P1 visiteur anonyme | 60 % | catalogue (5 s) → détail d'un cours (10 s) → catalogue (3 s) → détail d'un second cours (8 s) |
| P2 nouvel étudiant | 20 % | formulaire (15 s) → création du compte (2 s) → connexion → catalogue (10 s) → détail (8 s) → inscription au cours (3 s) → mes inscriptions (5 s) |
| P3 étudiant habitué | 15 % | saisie (5 s) → connexion (2 s) → mes inscriptions (5 s) → catalogue (10 s) → inscription à un nouveau cours (3 s ; un 409 est accepté) → mes inscriptions (5 s) |
| P4 administrateur | 5 % | saisie (5 s) → connexion → catalogue (8 s) → inscrits d'un cours (10 s) → inscrits d'un second cours (10 s) |

- Routes appelées : `GET /api/courses`, `GET /api/courses/:id`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/enrollments`, `GET /api/enrollments`, `GET /api/enrollments/by-course/:id`.
- `setup()` crée `NB_HABITUES` comptes (50 par défaut) pour P3. Ces requêtes `setup register` sont comptées dans les totaux globaux (`http_reqs`, `http_req_failed`).
- Le canary est suivi sur les lectures du catalogue et du détail (en-tête `X-Backend-Version`) : P1 envoie `X-User-Id: visiteur-0..999`, et P2 à P4 sont identifiés par leur JWT.
- Seuils `smoke` et `load` : erreurs < 1 % ; p95 < 500 ms pour P1 et < 800 ms pour P2, P3 et P4. Pour `stress`, `spike` et `soak` : on mesure seulement, et le test s'arrête au-delà de 10 % d'erreurs (après 30 s).
- Synthèse : `results/parcours-<profil>.json`, écrite par `handleSummary` **sans `setup_data`**, qui contient les mots de passe aléatoires des comptes habitués. Un résumé court est affiché en console.

### Profils (VU réels, après arrondi par parcours)

| Profil | Paliers | VU max (P1/P2/P3/P4) | Durée (+ jusqu'à 30 s d'arrêt progressif) |
|---|---|---|---|
| smoke | 4 VU pendant 2 min | 5 (2/1/1/1) | 2 min |
| load | 0→50 en 1 min, 50 pendant 6 min, →0 en 30 s | 51 (30/10/8/3) | 7 min 30 |
| stress | 50 → 100 → 200 → 300 → 400 (1 min de montée, puis 2 min de palier à chaque niveau), →0 en 1 min | 400 (240/80/60/20) | 16 min |
| spike | 10 VU pendant 1 min, saut à 200 en 10 s pendant 2 min, retour à 10 pendant 1 min | 200 (120/40/30/10) | 4 min 30 |
| soak | 40 VU pendant 15 min | 40 (24/8/6/2) | 16 min 30 |

## Script préliminaire : `k6/scenarios.js`

S1 visiteur (80 % : catalogue → détail) et S2 étudiant (20 % : création de compte → connexion → catalogue → inscription → mes inscriptions) en parallèle, avec 1 à 3 s de réflexion entre deux actions. Executor `ramping-vus`.
Profils : smoke 2 VU pendant 1 min ; load 30 VU (1 min + 5 min + 30 s) ; stress jusqu'à 200 VU ; spike jusqu'à 100 VU ; soak 20 VU pendant 15 min.
Seuils (smoke, load) : erreurs < 1 %, p95 < 500 ms pour S1 et S2. Synthèse : `results/<profil>.json`, écrite par `handleSummary`.

## Résultats conservés

Tous les chiffres ci-dessous sont **lus dans les fichiers cités**, sans arrondi autre que l'affichage (ms à 0,1 près). Cible : la VM de test, le 27/10/2026.

| Script, profil | Date (UTC) | Fichier source | Requêtes | VU max | Durée | Débit | Latence méd / p90 / p95 / max (ms) | p95 par scénario (ms) | Erreurs | Checks | Seuils |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `scenarios.js`, smoke | 27/10/2026 (date du fichier) | `results/smoke.json` | 81 | 3 | **non vérifiée** | 1,28 req/s | 27,0 / 223,8 / 266,4 / 456,1 | S1 97,8 ; S2 304,2 | 0 % | 81/81 | 3/3 non franchis |
| `scenarios.js`, load (1er essai) | 15:43:42 → 15:50:17 | `results/load-extrait-dashboard.json` (extrait partiel) | 5076 | 30 | 6 min 34 s (début → fin) | 12,9 req/s | 15,9 / 81,8 / 208,3 / 584,3 | non disponible | 0 % | 100 % | p95 par scénario non disponibles |
| `scenarios.js`, load | 16:36:37 → 16:43:11 | `results/load.json`, `results/load-2.console.txt` | 5111 | 30 | 393,1 s | 13,0 req/s | 15,2 / 76,2 / 206,1 / 2201,4 | S1 57,0 ; S2 255,9 | 0 % | 5111/5111 | 3/3 OK |
| `scenarios-parcours.js`, smoke | 16:47:47 → 16:50:23 | `results/parcours-smoke.json`, `results/parcours-smoke.console.txt` | 144 | 5 | 155,4 s | 0,93 req/s | 134,6 / 305,7 / 314,6 / 386,5 | P1 125,4 ; P2 364,4 ; P3 210,4 ; P4 249,2 | 0 % | 94/94 | 5/5 OK |

Notes :
- **`smoke.json`** est à l'ancien format (`--summary-export`) : il ne contient ni durée ni horodatage, sa durée n'est donc pas vérifiée. Dans ce format, `false` sur un seuil signifie « seuil non franchi » ; les valeurs mesurées sont bien sous les seuils (erreurs 0 %, p95 S1 97,8 ms et S2 304,2 ms < 500 ms).
- **Premier essai load** : seul le tableau de bord HTML (non versionné) en a été conservé ; `load-extrait-dashboard.json` en est un extrait décodé, sans sous-métriques par scénario. Il a été produit par une version antérieure non versionnée de `scenarios.js`.
- **`scenarios-parcours.js` smoke** : la sortie console donne la latence globale p50 / p95 / p99 = 134,6 / 314,6 / 352,3 ms, identique à `parcours-smoke.json` ; les p95 par parcours (P1 à P4) ne figurent que dans le JSON. Le canary a servi 37 réponses par v1 et 17 par v2.
- **`scenarios.js` load** : le canary a servi 3640 réponses par v1 et 675 par v2 (p95 56,4 ms et 58,2 ms).
- Les dates de début et de fin viennent des fichiers `*.started` et `*.ended` relevés localement (non versionnés) et, pour le premier essai, de l'extrait du tableau de bord.
- **Aucun résultat n'est conservé pour `stress`, `spike` et `soak`**, ni pour le profil `load` de `scenarios-parcours.js` : ces profils sont définis dans les scripts mais aucune mesure n'est disponible.

## Limites

- `cleanup.js` supprime les inscriptions aux cours `k6-*`, puis ces cours. Les **comptes `k6.*` restent** : il n'existe aucune route de suppression de compte. Chaque exécution de `scenarios-parcours.js` en ajoute au moins 50 (comptes habitués), plus un par itération de P2.
- Le client (poste Windows et sa connexion) fait partie de la mesure : les latences incluent le trajet Internet jusqu'à la VM.
- Une charge de quelques dizaines d'utilisateurs virtuels sur une VM de test ne dit rien de la tenue en charge d'une production.
