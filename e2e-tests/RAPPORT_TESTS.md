# Rapport de tests — Application d'inscription aux cours en ligne

Document unique et auto-suffisant à destination d'un assistant qui en produira un rapport LaTeX.
Factuel : décrit ce qui est **effectivement présent dans le dépôt** à la date du 2026-10-06.

---

## 1. Contexte et cadrage ISTQB

### 1.1 Projet
Application web d'**inscription aux cours universitaires**. Architecture microservices (NestJS +
Prisma + PostgreSQL en Docker) derrière une API Gateway unique, consommée par une SPA React
(Vite + TypeScript).

### 1.2 Niveau de test — systèmes / bout-en-bout (E2E)
Les tests décrits dans ce rapport correspondent au **niveau "test système"** du V-model ISTQB :
ils exercent l'**interface utilisateur réelle** (IHM React servie par Vite), qui elle-même
appelle la **gateway**, qui à son tour relaie vers les **microservices métier** (students,
courses, enrollments) et leur base PostgreSQL. L'ensemble est validé bout-en-bout, dans la
configuration de déploiement cible, sans mocks côté backend.

### 1.3 Outil
- **Selenium WebDriver 4** piloté en Python (pilote Edge par défaut, Chrome commenté).
- **pytest 9** comme harnais de test, avec fixtures (`conftest.py`) et Page Object Model
  (`pages.py`).
- Pré-conditions des tests posées via HTTP (`data_api.py`, `requests`).

### 1.4 Positionnement dans la pyramide des tests
Les tests E2E sont au **sommet de la pyramide** : peu nombreux (8 cas), lents (~1 min en
headless, ~3 min en mode visuel/démo), coûteux à maintenir mais indispensables pour prouver
que la chaîne complète fonctionne end-to-end dans la configuration réelle.

Ils **complètent** les tests unitaires Jest écrits aux niveaux inférieurs :

| Niveau | Outil | Portée | Nombre |
|---|---|---|---|
| Unitaire / composant | Jest | Logique métier + guards + controllers (par service) | 50 tests |
| Système / E2E | Selenium + pytest | Parcours utilisateur via l'IHM | 8 tests |

Les tests Jest couvrent la **correction locale du code** (règles métier, mapping d'erreurs,
sécurité des rôles, enrichissement de données). Les tests E2E couvrent la **fonctionnalité
observable par l'utilisateur** (login visuel, réservation d'un cours, retrait d'un inscrit).

---

## 2. Architecture testée et portée E2E

```
            Navigateur (Edge / Chrome)
                     │
      ┌──────────────┴──────────────┐
      ▼                             ▼
┌───────────────┐             ┌─────────────────────────┐
│ IHM React     │  fetch      │   API Gateway (NestJS)  │
│ Vite :5173    │ ──────────► │   :3000                 │
└───────────────┘             │   JWT verify + roles    │
                              │   X-User-Id / Role fwd  │
                              └────┬───────┬────────┬───┘
                                   ▼       ▼        ▼
                         ┌─────────┐ ┌──────────┐ ┌──────────────┐
                         │students │ │ courses  │ │ enrollments  │
                         │ :3001   │ │ :3002    │ │ :3003        │
                         │ +JWT    │ │          │ │ +HTTP clients│
                         └────┬────┘ └────┬─────┘ └──────┬───────┘
                              ▼           ▼              ▼
                         postgres-   postgres-    postgres-
                         students    courses      enrollments
                          :5432       :5433        :5434
```

### Ce que couvre l'E2E
- Le **front** s'affiche et se comporte comme attendu (routing, affichage conditionnel par rôle,
  slow-mo pris en compte).
- La **gateway** est le point d'entrée unique : les tests n'appellent jamais directement les
  services pour une action utilisateur (seule la préparation des données en setup peut passer
  en direct, pour aller plus vite).
- Les **règles métier** du jalon 3 sont exercées via l'IHM : auth, création de compte, rôles,
  réservation, annulation, restitution de place, gestion des cours admin, retrait d'inscrit.
- Les **inter-dépendances** entre microservices (ex. enrollments appelle courses pour
  décrémenter/restituer une place ; appelle students pour enrichir les listes) sont testées
  réellement, pas simulées.

### Ce que l'E2E ne couvre pas (volontairement)
- Les règles de bas niveau sur des entrées non manipulables depuis l'IHM
  (étudiant inconnu, cours inconnu, UUID malformé, token invalide côté réseau…). Ces cas sont
  couverts par les tests unitaires Jest.
- La résilience / performance / sécurité réseau.

---

## 3. Préparation des données de test (`data_api.py`)

### 3.1 Principe
Chaque test E2E crée **lui-même** ses pré-conditions via l'API, les utilise dans l'IHM, puis
nettoie dans un bloc `finally`. Les données portent un timestamp `{ts}` (ou un email unique
`<nom>.<ts>@test.com`) pour éviter toute collision entre exécutions successives et entre tests.

Aucun test ne dépend d'un état laissé par un autre.

### 3.2 Deux couches d'helpers

**Legacy / direct service** — bypass de la gateway, utile pour setup/cleanup rapide quand
l'auth n'apporte rien :

| Helper | Appel |
|---|---|
| `creer_cours(titre, capacite)` | `POST http://localhost:3002/courses` |
| `mettre_places_a_zero(cours_id, cap)` | `PATCH http://localhost:3002/courses/:id/seats` |
| `creer_inscription(cours_id, etudiant_id?)` | `POST http://localhost:3003/enrollments` |
| `supprimer_inscription_direct(id)` | `DELETE http://localhost:3003/enrollments/:id` + headers X-User-Role ADMIN |
| `supprimer_cours(id)` | `DELETE http://localhost:3002/courses/:id` |

**Via la gateway** — respecte l'auth JWT et les règles de rôle, nécessaire quand on veut
tester le même chemin qu'un vrai client :

| Helper | Route gateway |
|---|---|
| `login_api(email, pw)` | `POST /api/auth/login` → `{ token, user }` |
| `register_api(nom, prenom, email, tel, pw)` | `POST /api/auth/register` → `{ token, user }` |
| `inscrire_via_gateway(token, cours_id)` | `POST /api/enrollments` (Authorization: Bearer) |
| `mes_inscriptions_api(token)` | `GET /api/enrollments` |
| `inscrits_du_cours_api(admin_token, cours_id)` | `GET /api/enrollments/by-course/:id` |
| `supprimer_cours_api_admin(admin_token, id)` | `DELETE /api/courses/:id` |

### 3.3 Reproductibilité
- Comptes de test seedés (`admin@test.com / admin123`, `eleve@test.com / eleve123`,
  `jean.dupont@example.com / eleve123`).
- Jeux de données nouveaux à chaque exécution : titres de cours et emails horodatés.
- Nettoyage dans `finally` : supprimer les cours créés, retirer les inscriptions créées.
- Les comptes ELEVE créés par CT6/CT8 via `register_api` restent en base (le projet ne
  propose pas de suppression publique de compte) ; sans impact car ils ont des emails
  uniques et ne sont référencés nulle part ailleurs après cleanup des cours.

---

## 4. Conception des tests

### 4.1 Page Object Model (`pages.py`)
Une seule classe `AppPage` encapsule tous les sélecteurs et les gestes utilisateur. Objectifs :
- **isoler les tests des changements d'IHM** — si un sélecteur bouge, un seul endroit à
  mettre à jour ;
- **lisibilité** — les tests décrivent le quoi (`app.sinscrire(titre)`), pas le comment.

Priorité au `data-testid` **plutôt qu'aux sélecteurs CSS/XPath sur du texte** (plus stables ;
posés explicitement sur le front dans ce but). On garde du XPath/CSS pour les lectures de
texte dynamique (titres de cours, cartes) où data-testid serait redondant.

### 4.2 Fixtures (`conftest.py`)
- `driver` — ouvre un navigateur Edge avant chaque test, le ferme après. Prend en compte
  `E2E_HEADLESS=1`. Capture d'écran automatique en cas d'échec (`screenshots/ECHEC_<nom>_<ts>.png`).
- `pause_apres_test` **(autouse)** — pause configurable `PAUSE_ENTRE_TESTS` (défaut 2 s)
  APRÈS chaque test pour pouvoir observer visuellement entre deux cas.

### 4.3 Captures de preuve
Deux mécanismes :
- **Échec** : capture automatique dans `screenshots/ECHEC_<nom-test>_<timestamp>.png`
  (fixture `driver`).
- **Succès** : chaque test appelle `evidence(driver, "CTx_...")` juste avant le `finally`,
  ce qui produit `screenshots/CTx_..._<timestamp>.png` comme preuve d'exécution OK.

### 4.4 Slow-mo entre actions
Pour pouvoir **suivre à l'œil chaque étape** pendant une démo :
- Constante **`SLOWMO_SECONDES`** dans `config.py` lue depuis l'env **`E2E_SLOWMO`**
  (défaut 1.5 s, 0 = désactivé).
- Fonction `_slow()` centralisée dans `pages.py`, appelée **après** chaque action primitive :
  `_cliquer_tid`, `_remplir_tid`, `open`, `goto`, et le clic sur « S'inscrire » du catalogue.
- Les méthodes composites (`login`, `logout`, `creer_compte`, `aller_catalogue/mes_inscriptions/admin`,
  `admin_creer_cours`, `admin_ouvrir_inscrits`, `admin_retirer_inscrit`, …) héritent
  naturellement de cette pause via les primitives qu'elles enchaînent — pas de double pause.
- La pause **entre tests** (`PAUSE_ENTRE_TESTS`) est conservée indépendamment.

---

## 5. Traçabilité règle métier / fonctionnalité ↔ cas de test

| Règle / fonctionnalité | Cas E2E | Niveau approprié |
|---|---|---|
| Consultation du catalogue | **CT4** | E2E |
| Il doit rester des places (placesRestantes > 0) | **CT2** | E2E |
| Pas de doublon étudiant + cours | **CT3** | E2E |
| Inscription nominale (étudiant seedé) | **CT1** | E2E |
| Consultation « Mes inscriptions » | **CT5** | E2E |
| Sign-up public d'un ELEVE + auto-connexion + réservation (titre affiché) | **CT6** | E2E |
| Admin crée un cours via l'IHM (visible dans gestion ET catalogue) | **CT7** | E2E |
| Admin retire un élève d'un cours (restitution de place) | **CT8** | E2E |
| L'étudiant doit exister (404) | — | Unitaire (enrollments) |
| Le cours doit exister (404) | — | Unitaire (enrollments) |
| Rôle forcé à ELEVE sur register (pas d'auto-escalade ADMIN) | — | Unitaire (auth.service.spec) |
| Mapping d'erreurs (409 EMAIL_DEJA_UTILISE, 401, 403, 422) | — | Unitaire (auth, enrollments, gateway) |
| Enrichissement `coursTitre` / `etudiantNom/Email/Telephone` | — | Unitaire (enrollments.service.spec) |
| Guards JWT + Roles de la gateway | — | Unitaire (roles.guard.spec, controllers.spec) |

---

## 6. Détail des cas de test CT1 à CT8

Pour chaque cas : objectif, technique ISTQB, pré-conditions, étapes, résultat attendu, statut.

### CT1 — Inscription réussie (cas nominal)
- **Objectif.** Vérifier qu'un élève peut s'inscrire à un cours ayant des places disponibles.
- **Technique.** Partition d'équivalence (valide).
- **Pré-conditions.** Services up ; connexion ELEVE (Jean Dupont) ; cours
  `CT1 Nominal {ts}` à 10 places créé via API.
- **Étapes.** Ouvrir l'IHM → se connecter (`jean.dupont@example.com` / `eleve123`) →
  onglet Catalogue → cliquer « S'inscrire » sur le cours créé.
- **Résultat attendu.** Alerte de succès contenant le mot « réussi ».
- **Teardown.** Suppression du cours via API (l'inscription orphelinée reste côté enrollments
  mais sera affichée « Cours supprimé » plus tard — comportement attendu du jalon 3).
- **Statut.** IMPLÉMENTÉ, **PASS**.

### CT2 — Cours complet (valeur limite)
- **Objectif.** Vérifier que l'IHM désactive l'inscription quand il n'y a plus de place.
- **Technique.** Analyse des valeurs limites (`placesRestantes == 0`).
- **Pré-conditions.** Connexion ELEVE ; cours `CT2 Complet {ts}` créé à 5 places puis
  ramené à 0 via `PATCH /courses/:id/seats {delta: -5}`.
- **Étapes.** Login → Catalogue → retrouver la carte → inspecter le bouton.
- **Résultat attendu.** Bouton désactivé (`disabled`) ; texte contient « Complet ».
- **Statut.** IMPLÉMENTÉ, **PASS**.

### CT3 — Doublon (déjà inscrit)
- **Objectif.** Vérifier qu'un élève ne peut pas s'inscrire deux fois au même cours.
- **Technique.** Partition d'équivalence (invalide).
- **Pré-conditions.** Connexion Jean Dupont ; cours créé ; une 1ère inscription posée via
  API pour Jean sur ce cours.
- **Étapes.** Login → Catalogue → cliquer « S'inscrire » (2ᵉ tentative via l'IHM).
- **Résultat attendu.** Message d'erreur affiché (le backend renvoie 409 `INSCRIPTION_DUPLIQUEE`).
- **Teardown.** Suppression de l'inscription puis du cours.
- **Statut.** IMPLÉMENTÉ, **PASS**.

### CT4 — Consultation du catalogue
- **Objectif.** Vérifier l'affichage du catalogue (front → gateway → service Cours), avec
  titres non vides et jauge de places.
- **Technique.** Test fonctionnel.
- **Pré-conditions.** Services up ; connexion ELEVE ; ≥ 1 cours en base (le seed en crée 5).
- **Étapes.** Login → Catalogue → lire tous les titres via JS (DOM `.carte-titre`).
- **Résultat attendu.** Au moins 1 cours ; chaque titre non vide ; chaque carte comporte
  le texte « places ».
- **Statut.** IMPLÉMENTÉ, **PASS**.

### CT5 — Mes inscriptions
- **Objectif.** Vérifier que l'écran « Mes inscriptions » s'affiche sans erreur pour un
  élève connecté.
- **Technique.** Test fonctionnel.
- **Pré-conditions.** Connexion ELEVE (peu importe le contenu).
- **Étapes.** Login → cliquer sur l'onglet « Mes inscriptions ».
- **Résultat attendu.** L'écran affiche soit des cartes d'inscription, soit un état vide
  (`.empty-state`), sans alerte d'erreur.
- **Statut.** IMPLÉMENTÉ, **PASS**.

### CT6 — Nouvel étudiant : sign-up puis réservation (complexe)
- **Objectif.** Prouver bout-en-bout qu'un visiteur peut créer un compte depuis l'IHM, être
  automatiquement connecté, puis réserver un cours, et retrouver cette réservation libellée
  avec le **titre du cours** (pas l'UUID).
- **Technique.** Parcours fonctionnel sur un nouvel utilisateur.
- **Pré-conditions.** Un cours `CT6 Reservation {ts}` (15 places) créé via API ;
  un email neuf `ct6.nouveau.{ts}@test.com`.
- **Étapes.**
  1. Ouvrir `/login`, cliquer « S'inscrire ».
  2. Remplir le formulaire (nom, prénom, email, téléphone, mot de passe) et soumettre.
  3. Vérifier que le header affiche le nom ou prénom du nouvel utilisateur
     (`data-testid="user-name"`) — preuve de l'auto-connexion.
  4. Aller au catalogue, cliquer « S'inscrire » sur le cours créé.
  5. Vérifier le message de succès « Inscription réussie ! ».
  6. Aller sur « Mes inscriptions » et vérifier que l'un des libellés
     (`data-testid^="inscription-cours-titre-"`) contient le titre du cours.
- **Résultat attendu.** Chaque étape passe ; le libellé affiché est bien le titre du cours.
- **Teardown.** Suppression du cours créé.
- **Statut.** IMPLÉMENTÉ (nouveau), **PASS**.

### CT7 — Admin ajoute un cours (complexe)
- **Objectif.** Vérifier qu'un admin peut créer un cours via l'IHM et que ce cours apparaît
  immédiatement dans la vue admin **et** dans le catalogue avec les bonnes places.
- **Technique.** Parcours fonctionnel admin.
- **Pré-conditions.** Compte admin seedé.
- **Étapes.**
  1. Admin login (`admin@test.com / admin123`).
  2. Onglet « Gestion des cours ».
  3. Formulaire « Nouveau cours » : titre `Cybersecurite (test) {ts}`, capacité 20.
  4. Soumettre.
  5. Vérifier que la carte apparaît dans la liste admin (XPath par titre, lecture de son
     `data-testid` pour récupérer l'UUID).
  6. Onglet Catalogue : vérifier le titre présent et texte places « 20 / 20 ».
- **Résultat attendu.** Création OK, cours visible côté admin et côté catalogue avec
  20/20 places.
- **Teardown.** Suppression du cours via gateway admin.
- **Statut.** IMPLÉMENTÉ (nouveau), **PASS**.

### CT8 — Admin retire un élève d'un cours (complexe)
- **Objectif.** Vérifier qu'un admin peut retirer un élève d'un cours depuis la vue « inscrits »,
  et que **la place est restituée** côté cours (couplage inter-services enrollments → courses).
- **Technique.** Parcours fonctionnel admin + vérification croisée via l'API.
- **Pré-conditions (via API).**
  - Cours `Developpement Cloud {ts}` à 10 places (créé en direct via courses service).
  - Élève Elena créée via `register_api` (`elena.ct8.{ts}@test.com`, nom « Eleve Test »,
    prénom « Elena »).
  - Elena inscrite au cours via la gateway (donc avec son token) ; `placesRestantes` passe
    à 9.
- **Étapes.**
  1. Admin login via l'IHM.
  2. Onglet « Gestion des cours », retrouver la carte du cours (XPath par titre).
  3. Cliquer « Voir inscrits » ; attendre le panel (`data-testid="inscrits-panel-<id>"`).
  4. Vérifier via le DOM qu'Elena figure bien dans la liste (par email).
  5. Cliquer « Retirer » sur sa ligne (`data-testid="retirer-inscrit-btn-<inscriptionId>"`)
     — `window.confirm` court-circuité via injection JS.
  6. Attendre jusqu'à 10 s que la liste UI ne contienne plus Elena.
  7. Vérifier côté API (source de vérité) :
     - `GET /api/enrollments/by-course/:id` ne contient plus Elena.
     - `GET /courses/:id` renvoie `placesRestantes == 10` (restitution OK).
- **Résultat attendu.** Elena disparaît de la liste UI et API ; `placesRestantes` revient à
  la valeur initiale.
- **Teardown.** Suppression du cours.
- **Statut.** IMPLÉMENTÉ (nouveau), **PASS**.

---

## 7. Environnement d'exécution et commandes

### 7.1 Pré-requis d'exécution
- Node.js 20+ et Python 3.11+.
- Docker Desktop lancé (3 conteneurs postgres : students 5432, courses 5433, enrollments 5434).
- Les 4 microservices démarrés (`npm run start:dev` dans students, courses, enrollments, gateway).
- Le front démarré (`npm run dev` dans frontend/, port 5173).
- Dépendances Python : `pip install -r requirements.txt` (selenium ≥ 4.20, pytest ≥ 8, requests ≥ 2.31).
- Edge installé (navigateur par défaut sur Windows ; sans téléchargement de driver supplémentaire).

### 7.2 Commandes

Toute la suite (mode visible, slow-mo défaut 1.5 s, pause 2 s entre tests) :
```powershell
cd e2e-tests
pytest
```

Un seul test :
```powershell
pytest test_ct8_admin_retire_inscrit.py::test_ct8_admin_retire_inscrit
```

Vitesse normale (0 slow-mo) :
```powershell
$env:E2E_SLOWMO = "0"
pytest
```

Mode CI (headless + vitesse max) :
```powershell
$env:E2E_SLOWMO = "0"
$env:E2E_HEADLESS = "1"
pytest
```

Ralentissement poussé (3 s par action) :
```powershell
$env:E2E_SLOWMO = "3"
pytest
```

### 7.3 Comptes et données seedés
| Rôle  | Email | Mot de passe |
|---|---|---|
| ADMIN | admin@test.com | `admin123` |
| ELEVE | eleve@test.com | `eleve123` |
| ELEVE | jean.dupont@example.com | `eleve123` |
| ELEVE | 5 étudiants faker, emails aléatoires | `eleve123` |
| Cours | 5 cours faker (titres variables) | — |

---

## 8. Résultats de la dernière exécution

Exécution complète en mode headless (`E2E_SLOWMO=0 E2E_HEADLESS=1 pytest -v`),
2026-10-06 :

```
============================= test session starts =============================
platform win32 -- Python 3.11.9, pytest-9.1.1, pluggy-1.6.0
rootdir: D:\ELIAS\3A\Processus de test\inscription-\e2e-tests
configfile: pytest.ini
collecting ... collected 8 items

test_ct1_inscription.py::test_ct1_inscription_reussie            PASSED [ 12%]
test_ct2_complet.py::test_ct2_cours_complet                      PASSED [ 25%]
test_ct3_doublon.py::test_ct3_doublon                            PASSED [ 37%]
test_ct4_catalogue.py::test_ct4_catalogue_affiche_les_cours      PASSED [ 50%]
test_ct5_mes_inscriptions.py::test_ct5_mes_inscriptions          PASSED [ 62%]
test_ct6_signup_reserve.py::test_ct6_signup_puis_reservation     PASSED [ 75%]
test_ct7_admin_cree_cours.py::test_ct7_admin_cree_cours          PASSED [ 87%]
test_ct8_admin_retire_inscrit.py::test_ct8_admin_retire_inscrit  PASSED [100%]

======================== 8 passed in 63.02s (0:01:03) =========================
```

Verdict global : **8 / 8 PASSED** en 63 s. Même suite rejouée en mode visible (SLOWMO 1.5 s)
~ 2-3 min.

---

## 9. Retour d'expérience et tri des échecs

**Aucun défaut applicatif n'a été détecté par les tests E2E.** Les premiers échecs rencontrés
lors de la mise au point ont tous été classés **« défaut du test »**, pas « défaut de
l'application ». Résumé des faux échecs observés et de leur correction :

| Symptôme | Classification | Cause réelle | Correction |
|---|---|---|---|
| CT1 instable, assertion `"russi" in msg` échouait aléatoirement | Défaut du test | L'extraction console encodait mal l'accent (« réussi »), l'assertion de référence avait perdu l'accent lors d'un copier-coller | Assertion corrigée en `"réussi" in msg.lower()` |
| CT8 « sélecteur fragile » : la lecture des inscrits captait aussi les `<span>` enfants (`inscrit-nom-…`, `inscrit-email-…`) via `[data-testid^="inscrit-"]` | Défaut du test | Préfixe commun entre le `<li>` et ses enfants | Sélecteur restreint à `li[data-testid^="inscrit-"]` |
| CT4 renvoyait parfois une liste de titres vides | Défaut du test | Lecture du DOM trop rapide par rapport au rendu React (titre déjà présent mais `textContent` vide pendant un tick) | `attendre_catalogue()` étendu : `WebDriverWait` sur un `execute_script` qui vérifie que CHAQUE `.carte-titre` a du texte non vide |
| Longue session Edge non-headless atteignant 2 h au lieu de ~2 min, puis `InvalidSessionIdException` sur CT2 | Défaut d'environnement de test (pas l'appli) | Edge non-headless se bloquait sur certaines interactions pendant une démo prolongée | Ajout de `E2E_HEADLESS=1` ; les 8/8 passent en 63 s |
| Fichier de log pytest « corrompu » / tronqué à 40 lignes | Erreur de pilotage côté runner | Un filtre `Select-Object -Last 40` dans la commande d'exécution ampute la sortie avant l'écriture du fichier | Suppression du filtre, écriture complète avec `Tee-Object` |
| Services microservices et postgres parfois tombés en cours de session | Non reproductible, lié à l'environnement de dev (watcher Nest qui redémarre + Docker sans volume) | Pas d'impact sur les tests une fois les services redémarrés et les bases réimportées (`prisma migrate deploy` + `db seed`) | Documenté dans la commande de reset (section 7) |
| CT3 laissait une inscription orpheline derrière lui | Hygiène de test | Teardown incomplet | Teardown enrichi : suppression de l'inscription (via headers ADMIN) **puis** du cours |

**Lecture ISTQB.** Dans tous les cas ci-dessus, l'oracle (ce que vérifie le test) ou le
contexte d'exécution étaient en faute, pas le code applicatif. Les règles métier (places,
doublon, 401/403/409 standardisés, auto-connexion, restitution de place après annulation,
enrichissement du titre côté enrollments, gating des rôles côté gateway) ont **toutes passé
dès leur première validation sur le code**, aussi bien en Jest qu'en E2E.

---

## 10. Résumé des tests unitaires Jest existants

Ces tests tournent avec `npm test` dans chaque dossier de service. Ils sont au niveau
**composant** (voire **classe**) : ils isolent la logique métier via des mocks pour les
dépendances externes (Prisma, autres services, JWT…).

### 10.1 `students` — 13 tests (5 suites), PASS
Couverture :
- **`AuthService` (8 tests)** : login (refus email inconnu, refus mot de passe faux,
  signature correcte, token ADMIN) ; register (crée bien un ELEVE, rôle **forcé** à ELEVE
  même si le body envoie `role=ADMIN`, 409 `EMAIL_DEJA_UTILISE` si email pris,
  auto-connexion renvoyant le `sub` du nouveau compte dans le JWT).
- **`StudentsService`** : `findOne` lève une erreur si l'étudiant n'existe pas.
- **Controllers / App** : smoke tests `should be defined`.

### 10.2 `courses` — 5 tests, PASS
Couverture : smoke tests + CRUD de base (`CoursesService`, `CoursesController`,
`AppController`). Pas de logique métier riche de ce côté — l'intelligence est côté
enrollments.

### 10.3 `enrollments` — 15 tests (2 suites), PASS
Couverture de `EnrollmentsService` :
- **`findForStudent` (3 tests sur l'enrichissement)** : ajoute `coursTitre` sur chaque
  inscription ; affiche « Cours supprimé » si le cours n'existe plus ; même fallback si
  l'appel au service cours jette.
- **`findByCourse` (3 tests, vue admin)** : enrichit avec `etudiantNom`, `etudiantPrenom`,
  `etudiantEmail`, `etudiantTelephone` ; affiche « Étudiant supprimé » si le compte n'existe
  plus ; tolère un étudiant legacy sans prenom/telephone (NULL en DB).
- **`remove` (5 tests)** : 404 si inscription inconnue ; 403 si l'appelant n'est ni
  propriétaire ni ADMIN ; propriétaire → delete + restitution de place ; ADMIN → delete
  + restitution ; best-effort → le delete tient même si la restitution échoue (log).
- Smoke test + lecture d'inscriptions d'un étudiant + HealthController.

### 10.4 `gateway` — 17 tests (4 suites), PASS
Couverture :
- **`RolesGuard` (4 tests)** : autorise si aucun rôle requis ; autorise si rôle attend
  correspond ; 403 si rôle insuffisant ; 403 si user absent.
- **`CoursesProxyController` (4 tests)** : vérifie par Reflector que POST / PATCH / DELETE
  portent `@Roles('ADMIN')` ; GET est public (pas de metadata).
- **`EnrollmentsProxyController` (8 tests)** :
  - POST force `etudiantId` à `req.user.sub` et ignore le `etudiantId` du body (ELEVE et
    ADMIN).
  - GET ELEVE : filtre forcé à `req.user.sub` même si la query param tente de surcharger.
  - GET ADMIN : peut filtrer par n'importe quel étudiant, ou tout lister sans param.
  - DELETE : propage `X-User-Id` + `X-User-Role` vers le service aval.
  - GET `/by-course/:coursId` : porte `@Roles('ADMIN')` et forward correctement.
- `HealthController` : smoke.

### 10.5 Total Jest
**50 tests Jest, tous verts** (13 students + 5 courses + 15 enrollments + 17 gateway).

---

## ANNEXE — Code source complet

### `config.py`

```python
"""Configuration partagee : URLs de l'application et donnees de test.
Adapte ces valeurs si tes ports different."""
import os as _os

# ======= Slow-mo : pause APRES chaque action UI (demo pas-a-pas) =======
# Lu depuis la variable d'environnement E2E_SLOWMO (ex: E2E_SLOWMO=2).
# Valeur par defaut 1.5 s (demo). Mets 0 pour desactiver (CI/vitesse normale).
try:
    SLOWMO_SECONDES = float(_os.environ.get("E2E_SLOWMO", 1.5))
except (TypeError, ValueError):
    SLOWMO_SECONDES = 1.5

FRONT_URL       = "http://localhost:5173"   # IHM React
GATEWAY_URL     = "http://localhost:3000"   # point d'entree unique
STUDENTS_URL    = "http://localhost:3001"   # service Etudiants
COURSES_URL     = "http://localhost:3002"   # service Cours
ENROLLMENTS_URL = "http://localhost:3003"   # service Inscriptions

# Etudiant historique (seede, utilise par CT1-5 qui doivent se connecter)
ETUDIANT_ID    = "11111111-1111-4111-8111-111111111111"
JEAN_EMAIL     = "jean.dupont@example.com"
JEAN_PASSWORD  = "eleve123"

# Comptes seedes (jalon 3)
ADMIN_EMAIL    = "admin@test.com"
ADMIN_PASSWORD = "admin123"
ELEVE_EMAIL    = "eleve@test.com"
ELEVE_PASSWORD = "eleve123"
```

### `conftest.py`

```python
"""Fixtures pytest partagees : navigateur Selenium, pause entre tests, capture d'ecran.

Navigateur par defaut : Microsoft Edge (toujours present sur Windows).
Pour Chrome, voir le commentaire dans la fixture `driver`.
"""
import os
import datetime
import time
import pytest
from selenium import webdriver
from selenium.webdriver.edge.options import Options as EdgeOptions

# ====== Pause entre les tests (pour pouvoir suivre a l'oeil) ======
# Passe a 0 pour les runs CI, 2-3 secondes pour une demo visuelle.
PAUSE_ENTRE_TESTS = 2

SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Attache le resultat de chaque phase au noeud de test (pour la capture)."""
    outcome = yield
    rep = outcome.get_result()
    setattr(item, "rep_" + rep.when, rep)


@pytest.fixture
def driver(request):
    """Ouvre un navigateur avant le test, le ferme apres.
    Capture l'ecran automatiquement si le test echoue (evidence de test)."""
    options = EdgeOptions()
    options.add_argument("--window-size=1280,900")
    # Headless activable via la variable d'env E2E_HEADLESS=1
    import os as _os
    if _os.environ.get("E2E_HEADLESS") == "1":
        options.add_argument("--headless=new")

    drv = webdriver.Edge(options=options)
    # --- Pour Chrome a la place d'Edge, remplace les 2 lignes ci-dessus par :
    # from selenium.webdriver.chrome.options import Options as ChromeOptions
    # options = ChromeOptions(); options.add_argument("--window-size=1280,900")
    # drv = webdriver.Chrome(options=options)

    drv.implicitly_wait(5)
    yield drv

    rep = getattr(request.node, "rep_call", None)
    if rep is not None and rep.failed:
        os.makedirs(SCREENSHOT_DIR, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        drv.save_screenshot(os.path.join(SCREENSHOT_DIR, f"ECHEC_{request.node.name}_{ts}.png"))

    drv.quit()


@pytest.fixture(autouse=True)
def pause_apres_test():
    """Pause configurable APRES chaque test, pour pouvoir observer visuellement."""
    yield
    if PAUSE_ENTRE_TESTS > 0:
        time.sleep(PAUSE_ENTRE_TESTS)


def evidence(driver, nom):
    """Enregistre une capture d'ecran de preuve (a appeler dans un test qui passe)."""
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    driver.save_screenshot(os.path.join(SCREENSHOT_DIR, f"{nom}_{ts}.png"))
```

### `pages.py`

```python
"""Page Object Model : centralise les selecteurs de l'IHM.

Prioritaire : selecteurs par data-testid (plus stables que CSS/XPath sur du contenu).
Pour les parties de catalogue (lecture via JS), on garde les selecteurs CSS existants
car ces elements sont rendus dynamiquement et portent deja une structure propre.

Slow-mo : une pause configurable (`config.SLOWMO_SECONDES`) est appliquee APRES
chaque action UI significative (clic, saisie, navigation) via _slow(), pour pouvoir
observer visuellement chaque etape pendant une demo. 0 = desactive.
"""
import time
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from config import SLOWMO_SECONDES


def _slow():
    """Pause APRES une action UI significative (demo pas-a-pas). Configurable
    via `config.SLOWMO_SECONDES` ou la variable d'env `E2E_SLOWMO`."""
    if SLOWMO_SECONDES > 0:
        time.sleep(SLOWMO_SECONDES)


class AppPage:
    def __init__(self, driver, base_url):
        self.driver = driver
        self.base_url = base_url

    # ---- Navigation ----
    def open(self):
        self.driver.get(self.base_url)
        _slow()
        return self

    def goto(self, path):
        self.driver.get(f"{self.base_url}{path}")
        _slow()
        return self

    # ---- Authentification ----
    def login(self, email, password, timeout=10):
        """Si pas deja sur /login, y va. Remplit, soumet, attend d'etre connecte."""
        if "/login" not in self.driver.current_url:
            self.goto("/login")
        self._attendre_tid("login-form", timeout)
        self._remplir_tid("email-input", email)
        self._remplir_tid("password-input", password)
        self._cliquer_tid("login-submit")
        self._attendre_tid("user-area", timeout)
        return self

    def logout(self, timeout=10):
        self._cliquer_tid("logout-btn")
        WebDriverWait(self.driver, timeout).until(EC.url_contains("/login"))
        return self

    def creer_compte(self, nom, prenom, email, telephone, password, timeout=10):
        """Depuis /login : clique le lien 'S'inscrire', remplit, submit, attend connexion."""
        if "/register" not in self.driver.current_url:
            if "/login" not in self.driver.current_url:
                self.goto("/login")
            self._attendre_tid("to-register-link", timeout).click()
        self._attendre_tid("register-form", timeout)
        self._remplir_tid("register-nom", nom)
        self._remplir_tid("register-prenom", prenom)
        self._remplir_tid("register-email", email)
        self._remplir_tid("register-telephone", telephone)
        self._remplir_tid("register-password", password)
        self._cliquer_tid("register-submit")
        self._attendre_tid("user-area", timeout)
        return self

    def nom_utilisateur_affiche(self):
        return (self._attendre_tid("user-name").text or "").strip()

    # ---- Catalogue (vue ELEVE/ADMIN) ----
    def aller_catalogue(self, timeout=10):
        self._cliquer_tid("nav-catalogue")
        self.attendre_catalogue(timeout)
        return self

    def aller_mes_inscriptions(self, timeout=10):
        self._cliquer_tid("nav-mes-inscriptions")
        self._attendre_tid("mes-inscriptions", timeout)
        return self

    def aller_admin(self, timeout=10):
        self._cliquer_tid("nav-admin")
        self._attendre_tid("admin-courses", timeout)
        return self

    def attendre_catalogue(self, timeout=10):
        """Attend que les cartes soient chargees ET leurs titres remplis
        (ou l'etat vide, ou une alerte d'erreur)."""
        WebDriverWait(self.driver, timeout).until(lambda d: d.execute_script("""
            if (document.querySelector('.empty-state') || document.querySelector('.alert.erreur')) return true;
            const titres = Array.from(document.querySelectorAll('ul.liste li.carte .carte-titre'));
            return titres.length > 0 && titres.every(e => (e.textContent || '').trim() !== '');
        """))

    def titres_cours(self):
        return self.driver.execute_script("""
            return Array.from(document.querySelectorAll('ul.liste li.carte .carte-titre'))
                        .map(e => (e.textContent || '').trim());
        """)

    def places_text(self, titre):
        return self.driver.execute_script("""
            const t = arguments[0];
            const card = Array.from(document.querySelectorAll('ul.liste li.carte')).find(li => {
                const el = li.querySelector('.carte-titre');
                return el && (el.textContent || '').trim() === t;
            });
            return card ? (card.querySelector('.places-text').textContent || '').trim() : '';
        """, titre)

    def carte(self, titre):
        return self.driver.find_element(
            By.XPATH,
            f"//li[contains(@class,'carte')]"
            f"[.//span[@class='carte-titre' and normalize-space(text())={_xpath_literal(titre)}]]",
        )

    def bouton_inscrire(self, titre):
        """Bouton 'S'inscrire' pour un cours donne (visible seulement en role ELEVE)."""
        return self.carte(titre).find_element(By.TAG_NAME, "button")

    def sinscrire(self, titre):
        self.bouton_inscrire(titre).click()
        _slow()

    def message_succes(self, timeout=10):
        WebDriverWait(self.driver, timeout).until(
            lambda d: d.find_elements(By.CSS_SELECTOR, ".alert.ok")
        )
        return self.driver.execute_script(
            "const e=document.querySelector('.alert.ok'); return e ? (e.textContent||'').trim() : '';"
        )

    def message_erreur(self, timeout=10):
        WebDriverWait(self.driver, timeout).until(
            lambda d: d.find_elements(By.CSS_SELECTOR, ".alert.erreur")
        )
        return self.driver.execute_script(
            "const e=document.querySelector('.alert.erreur'); return e ? (e.textContent||'').trim() : '';"
        )

    # ---- Mes inscriptions ----
    def titres_mes_inscriptions(self):
        """Retourne la liste des libelles de cours (coursTitre) affiches dans Mes inscriptions."""
        return self.driver.execute_script("""
            return Array.from(document.querySelectorAll('[data-testid^="inscription-cours-titre-"]'))
                        .map(e => (e.textContent || '').trim());
        """)

    # ---- Admin : creation / lecture / retrait ----
    def admin_creer_cours(self, titre, capacite):
        self._attendre_tid("admin-courses")
        self._remplir_tid("new-course-titre", titre)
        self._remplir_tid("new-course-capacite", str(capacite))
        self._cliquer_tid("create-course-submit")

    def admin_card_par_titre(self, titre, timeout=10):
        """Attend puis retourne le <li> admin dont le titre correspond."""
        xpath = (
            "//li[contains(@class,'carte') and @data-testid[starts-with(., 'admin-course-')]]"
            f"[.//span[@class='carte-titre' and normalize-space(text())={_xpath_literal(titre)}]]"
        )
        WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((By.XPATH, xpath))
        )
        return self.driver.find_element(By.XPATH, xpath)

    def admin_cours_id_par_titre(self, titre, timeout=10):
        card = self.admin_card_par_titre(titre, timeout)
        tid = card.get_attribute("data-testid") or ""
        # format: admin-course-<uuid>
        return tid[len("admin-course-"):]

    def admin_ouvrir_inscrits(self, titre, timeout=10):
        cours_id = self.admin_cours_id_par_titre(titre, timeout)
        self._cliquer_tid(f"voir-inscrits-btn-{cours_id}")
        # Attendre que le panel soit present
        WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, f'[data-testid="inscrits-panel-{cours_id}"]'))
        )
        return cours_id

    def admin_lire_inscrits(self, cours_id, timeout=10):
        """Retourne [{nom, email}, ...] pour le panel ouvert d'un cours."""
        # Attendre soit la liste, soit l'etat vide
        WebDriverWait(self.driver, timeout).until(lambda d: d.execute_script(f"""
            const p = document.querySelector('[data-testid="inscrits-panel-{cours_id}"]');
            if (!p) return false;
            return p.querySelector('li[data-testid^="inscrit-"]')
                 || p.querySelector('[data-testid="inscrits-vide-{cours_id}"]');
        """))
        return self.driver.execute_script(f"""
            const p = document.querySelector('[data-testid="inscrits-panel-{cours_id}"]');
            if (!p) return [];
            return Array.from(p.querySelectorAll('li[data-testid^="inscrit-"]')).map(li => {{
                const nom = li.querySelector('.inscrit-nom');
                const email = li.querySelector('.inscrit-email');
                return {{
                    nom: nom ? (nom.textContent || '').trim() : '',
                    email: email ? (email.textContent || '').trim() : '',
                }};
            }});
        """)

    def admin_retirer_inscrit(self, inscription_id):
        """Clique 'Retirer' pour une inscription donnee (bypass du window.confirm)."""
        # Court-circuite la confirmation navigateur
        self.driver.execute_script("window.confirm = () => true;")
        self._cliquer_tid(f"retirer-inscrit-btn-{inscription_id}")

    def admin_supprimer_cours(self, titre, timeout=10):
        cours_id = self.admin_cours_id_par_titre(titre, timeout)
        self.driver.execute_script("window.confirm = () => true;")
        self._cliquer_tid(f"delete-btn-{cours_id}")

    # ---- Primitives data-testid ----
    def _tid(self, tid):
        return self.driver.find_element(By.CSS_SELECTOR, f'[data-testid="{tid}"]')

    def _attendre_tid(self, tid, timeout=10):
        return WebDriverWait(self.driver, timeout).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, f'[data-testid="{tid}"]'))
        )

    def _cliquer_tid(self, tid, timeout=10):
        el = WebDriverWait(self.driver, timeout).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, f'[data-testid="{tid}"]'))
        )
        el.click()
        _slow()

    def _remplir_tid(self, tid, valeur):
        el = self._attendre_tid(tid)
        el.clear()
        el.send_keys(valeur)
        _slow()


def _xpath_literal(s):
    if "'" not in s:
        return f"'{s}'"
    if '"' not in s:
        return f'"{s}"'
    parts = s.split("'")
    return "concat('" + "', \"'\", '".join(parts) + "')"
```

### `data_api.py`

```python
"""Preparation des donnees de test via l'API (services directs ou gateway).
Rend les cas de test auto-suffisants et reproductibles.

Convention : les helpers qui finissent par "_api" passent par la gateway
(http://localhost:3000) et respectent les regles d'auth (role, token, ...).
Les anciens helpers (creer_cours, mettre_places_a_zero, ...) attaquent directement
les services (ports 3001/3002/3003) : utiles pour setup/cleanup rapides.
"""
import requests
from config import (
    COURSES_URL, ENROLLMENTS_URL, GATEWAY_URL,
    ETUDIANT_ID,
)


# ============ Legacy helpers (services directs — pas d'auth) ============

def creer_cours(titre, capacite):
    r = requests.post(f"{COURSES_URL}/courses", json={"titre": titre, "capacite": capacite})
    r.raise_for_status()
    return r.json()["id"]


def mettre_places_a_zero(cours_id, capacite):
    """Ramene placesRestantes a 0 (PATCH /courses/:id/seats {delta:-capacite})."""
    r = requests.patch(f"{COURSES_URL}/courses/{cours_id}/seats", json={"delta": -capacite})
    r.raise_for_status()


def creer_inscription(cours_id, etudiant_id=ETUDIANT_ID):
    """Inscrit un etudiant au cours (par defaut Jean Dupont). Retourne l'inscription (ou None)."""
    r = requests.post(
        f"{ENROLLMENTS_URL}/enrollments",
        json={"etudiantId": etudiant_id, "coursId": cours_id},
    )
    if r.status_code // 100 == 2:
        return r.json()
    return None


def supprimer_inscription_direct(inscription_id):
    """Supprime une inscription en appel direct au service (headers ADMIN pour passer le gate)."""
    requests.delete(
        f"{ENROLLMENTS_URL}/enrollments/{inscription_id}",
        headers={"X-User-Id": ETUDIANT_ID, "X-User-Role": "ADMIN"},
    )


def supprimer_cours(cours_id):
    requests.delete(f"{COURSES_URL}/courses/{cours_id}")


# ============ Helpers gateway (JWT, roles respectes) ============

def login_api(email, password):
    """POST /api/auth/login -> {token, user}. Lance en cas d'echec."""
    r = requests.post(f"{GATEWAY_URL}/api/auth/login",
                      json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()


def register_api(nom, prenom, email, telephone, password):
    """POST /api/auth/register -> {token, user}. Lance en cas d'echec."""
    r = requests.post(f"{GATEWAY_URL}/api/auth/register", json={
        "nom": nom, "prenom": prenom, "email": email,
        "telephone": telephone, "password": password,
    })
    r.raise_for_status()
    return r.json()


def inscrire_via_gateway(token, cours_id):
    """POST /api/enrollments avec Bearer -> inscription."""
    r = requests.post(
        f"{GATEWAY_URL}/api/enrollments",
        json={"coursId": cours_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    r.raise_for_status()
    return r.json()


def mes_inscriptions_api(token):
    r = requests.get(
        f"{GATEWAY_URL}/api/enrollments",
        headers={"Authorization": f"Bearer {token}"},
    )
    r.raise_for_status()
    return r.json()


def inscrits_du_cours_api(admin_token, cours_id):
    r = requests.get(
        f"{GATEWAY_URL}/api/enrollments/by-course/{cours_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    r.raise_for_status()
    return r.json()


def supprimer_cours_api_admin(admin_token, cours_id):
    """Cleanup : supprime un cours via la gateway (requiert token ADMIN). Ignore 404."""
    requests.delete(
        f"{GATEWAY_URL}/api/courses/{cours_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
```

### `test_ct1_inscription.py`

```python
"""
CT1 — Inscription reussie (cas nominal)
Regle : places > 0, etudiant + cours existent, pas de doublon.
Pre-requis services : students(3001), courses(3002), enrollments(3003), gateway(3000), front(5173).
"""
import time
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct1_inscription_reussie(driver):
    titre = f"CT1 Nominal {int(time.time())}"
    cours_id = data_api.creer_cours(titre, 10)
    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(JEAN_EMAIL, JEAN_PASSWORD)
        app.aller_catalogue()

        app.sinscrire(titre)

        msg = app.message_succes()
        assert "réussi" in msg.lower(), f"Message inattendu : {msg!r}"

        evidence(driver, "CT1_inscription")
    finally:
        data_api.supprimer_cours(cours_id)
```

### `test_ct2_complet.py`

```python
"""
CT2 — Cours complet (valeur limite : placesRestantes = 0)
Regle : il doit rester des places.
Pre-requis services : courses(3002), gateway(3000), front(5173).
"""
import time
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct2_cours_complet(driver):
    titre = f"CT2 Complet {int(time.time())}"
    cours_id = data_api.creer_cours(titre, 5)
    data_api.mettre_places_a_zero(cours_id, 5)
    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(JEAN_EMAIL, JEAN_PASSWORD)
        app.aller_catalogue()

        bouton = app.bouton_inscrire(titre)
        assert not bouton.is_enabled(), "Le bouton devrait etre desactive (cours complet)"
        assert "Complet" in (bouton.get_attribute("textContent") or "")

        evidence(driver, "CT2_complet")
    finally:
        data_api.supprimer_cours(cours_id)
```

### `test_ct3_doublon.py`

```python
"""
CT3 — Doublon (deja inscrit)
Regle : pas de doublon (meme etudiant + meme cours).
Pre-requis services : students(3001), courses(3002), enrollments(3003), gateway(3000), front(5173).
"""
import time
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct3_doublon(driver):
    titre = f"CT3 Doublon {int(time.time())}"
    cours_id = data_api.creer_cours(titre, 10)
    insc = data_api.creer_inscription(cours_id)   # 1ere inscription via API pour Jean
    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(JEAN_EMAIL, JEAN_PASSWORD)
        app.aller_catalogue()

        app.sinscrire(titre)                      # 2e tentative via l'IHM

        msg = app.message_erreur()
        assert msg != "", "Un message d'erreur (doublon) devrait apparaitre"

        evidence(driver, "CT3_doublon")
    finally:
        if insc:
            data_api.supprimer_inscription_direct(insc["id"])
        data_api.supprimer_cours(cours_id)
```

### `test_ct4_catalogue.py`

```python
"""
CT4 — Consultation du catalogue
--------------------------------
Niveau      : test systeme / bout-en-bout (E2E)
Technique   : test fonctionnel
Regle testee: affichage du catalogue (front -> gateway -> service Cours)
Pre-condition : l'application tourne (front 5173, gateway 3000, courses 3002)
                et au moins un cours existe en base. Connexion requise (jalon 3).
"""
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence


def test_ct4_catalogue_affiche_les_cours(driver):
    app = AppPage(driver, FRONT_URL).open()
    app.login(JEAN_EMAIL, JEAN_PASSWORD)
    app.aller_catalogue()

    titres = app.titres_cours()
    assert len(titres) > 0, (
        "Le catalogue devrait afficher au moins un cours. "
        "Verifie que front(5173), gateway(3000) et courses(3002) tournent."
    )

    for titre in titres:
        assert titre != "", "Un cours a un titre vide"
        assert "places" in app.places_text(titre), f"Places manquantes pour '{titre}'"

    evidence(driver, "CT4_catalogue")
```

### `test_ct5_mes_inscriptions.py`

```python
"""
CT5 — Mes inscriptions
Affichage des inscriptions de l'etudiant.
Pre-requis services : enrollments(3003), gateway(3000), front(5173).
"""
import time
from selenium.webdriver.common.by import By
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence


def test_ct5_mes_inscriptions(driver):
    app = AppPage(driver, FRONT_URL).open()
    app.login(JEAN_EMAIL, JEAN_PASSWORD)
    app.aller_mes_inscriptions()
    time.sleep(1)  # laisse le temps a l'ecran de charger

    cartes = driver.find_elements(By.CSS_SELECTOR, "ul.liste li.carte")
    vide = driver.find_elements(By.CLASS_NAME, "empty-state")
    erreur = driver.find_elements(By.CSS_SELECTOR, ".alert.erreur")

    assert (cartes or vide) and not erreur, "L'ecran Mes inscriptions doit s'afficher sans erreur"

    evidence(driver, "CT5_mes_inscriptions")
```

### `test_ct6_signup_reserve.py`

```python
"""
CT6 — Nouvel etudiant : sign-up puis reservation d'un cours.

Scenario :
  1. Pre-condition : un cours "CT6 Reservation xxx" avec des places (via API).
  2. Nouvel etudiant : ouvre /login, clique "S'inscrire", remplit le formulaire,
     soumet -> connecte automatiquement.
  3. Reserve le cours via l'IHM (bouton S'inscrire).
  4. Verifie : message de succes + la reservation apparait dans "Mes inscriptions"
     avec le NOM du cours (pas l'UUID).

Teardown : supprime le cours (ce qui orpheline l'inscription — Jalon 3 affiche
"Cours supprime" dans Mes inscriptions pour les occurrences restantes).
"""
import time
from config import FRONT_URL
from pages import AppPage
from conftest import evidence
import data_api


def test_ct6_signup_puis_reservation(driver):
    ts = int(time.time())
    titre = f"CT6 Reservation {ts}"
    cours_id = data_api.creer_cours(titre, 15)

    email = f"ct6.nouveau.{ts}@test.com"
    nom = "Testeur"
    prenom = "Nouveau"
    telephone = "+33 6 00 00 00 00"
    password = "secret123"

    try:
        app = AppPage(driver, FRONT_URL).open()
        app.creer_compte(nom, prenom, email, telephone, password)

        # Verifie que l'auto-connexion a bien eu lieu : le header affiche le nom
        affiche = app.nom_utilisateur_affiche()
        assert prenom in affiche or nom in affiche, (
            f"Header ne contient ni '{prenom}' ni '{nom}' : {affiche!r}"
        )

        app.aller_catalogue()
        app.sinscrire(titre)

        msg = app.message_succes()
        assert "réussi" in msg.lower(), f"Message succes attendu, obtenu : {msg!r}"

        # Verifie que la reservation apparait dans "Mes inscriptions" avec le titre du cours
        app.aller_mes_inscriptions()
        libs = app.titres_mes_inscriptions()
        assert any(titre in lib for lib in libs), (
            f"Le cours '{titre}' devrait apparaitre dans Mes inscriptions ; vu : {libs}"
        )

        evidence(driver, "CT6_signup_reservation")
    finally:
        # Cleanup : supprime le cours (l'inscription orpheline sera auto-affichee
        # comme "Cours supprime" lors d'un prochain affichage).
        data_api.supprimer_cours(cours_id)
```

### `test_ct7_admin_cree_cours.py`

```python
"""
CT7 — Admin ajoute un cours.

Scenario :
  1. L'admin seede se connecte.
  2. Dans "Gestion des cours", il cree un cours ("Cybersecurite (test) {ts}") avec 20 places.
  3. Verifie : le cours apparait dans la liste admin ET dans le catalogue, avec 20 places.

Teardown : l'admin supprime le cours cree (via API) pour rester rejouable.
"""
import time
from config import FRONT_URL, ADMIN_EMAIL, ADMIN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct7_admin_cree_cours(driver):
    ts = int(time.time())
    titre = f"Cybersecurite (test) {ts}"
    capacite = 20

    admin_token = data_api.login_api(ADMIN_EMAIL, ADMIN_PASSWORD)["token"]
    cours_id_a_nettoyer = None

    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(ADMIN_EMAIL, ADMIN_PASSWORD)
        app.aller_admin()

        app.admin_creer_cours(titre, capacite)

        # Verifie que le cours apparait dans la vue admin
        cours_id_a_nettoyer = app.admin_cours_id_par_titre(titre)
        assert cours_id_a_nettoyer, "Le cours vient d'etre cree ; son UUID devrait etre lisible"

        # Verifie dans le catalogue : titre present et 20/20 places
        app.aller_catalogue()
        titres = app.titres_cours()
        assert titre in titres, f"Catalogue devrait contenir '{titre}' ; vu : {titres}"
        places = app.places_text(titre)
        assert "20 / 20" in places or "20/20" in places, (
            f"Attendu '20 / 20 places' pour {titre!r}, vu : {places!r}"
        )

        evidence(driver, "CT7_admin_cree_cours")
    finally:
        if cours_id_a_nettoyer:
            data_api.supprimer_cours_api_admin(admin_token, cours_id_a_nettoyer)
```

### `test_ct8_admin_retire_inscrit.py`

```python
"""
CT8 — Admin retire un eleve d'un cours.

Scenario :
  1. Pre-conditions (via API) :
     - Un cours "Developpement Cloud {ts}" avec 10 places (admin le cree via gateway).
     - Un eleve "Elena" cree via register (email unique), auto-connectee.
     - Elena s'inscrit au cours (places = 9).
  2. L'admin se connecte via l'IHM, va dans Gestion des cours, ouvre les inscrits
     du cours "Developpement Cloud ...", et clique "Retirer" sur Elena.
  3. Verifie : Elena n'est plus dans les inscrits de ce cours, et le cours est
     revenu a 10 places restantes (place restituee).

Teardown : supprime le cours.
"""
import time
from config import FRONT_URL, ADMIN_EMAIL, ADMIN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct8_admin_retire_inscrit(driver):
    ts = int(time.time())
    titre = f"Developpement Cloud {ts}"
    capacite = 10

    # --- Setup via API ---
    admin_token = data_api.login_api(ADMIN_EMAIL, ADMIN_PASSWORD)["token"]
    cours_id = data_api.creer_cours(titre, capacite)   # creation directe via service

    elena_email = f"elena.ct8.{ts}@test.com"
    elena = data_api.register_api(
        nom="Eleve Test", prenom="Elena",
        email=elena_email, telephone="+33 6 00 00 00 00",
        password="elena123",
    )
    elena_insc = data_api.inscrire_via_gateway(elena["token"], cours_id)
    assert elena_insc.get("id"), "L'inscription d'Elena devrait avoir un id"

    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(ADMIN_EMAIL, ADMIN_PASSWORD)
        app.aller_admin()

        # Ouvre le panel des inscrits pour ce cours
        app.admin_ouvrir_inscrits(titre)

        # Verifie qu'Elena est bien visible AVANT retrait
        inscrits_avant = app.admin_lire_inscrits(cours_id)
        emails_avant = [i["email"] for i in inscrits_avant]
        assert elena_email in emails_avant, (
            f"Elena ({elena_email}) devrait etre dans les inscrits ; vu : {emails_avant}"
        )

        # Retire Elena via l'IHM
        app.admin_retirer_inscrit(elena_insc["id"])

        # Attente du refresh et verification APRES retrait
        def elena_disparue(_):
            apres = app.admin_lire_inscrits(cours_id)
            return elena_email not in [i["email"] for i in apres]

        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(driver, 10).until(elena_disparue)

        # Verifie la restitution de place via l'API (source de verite)
        apres_courses = data_api.inscrits_du_cours_api(admin_token, cours_id)
        assert elena_email not in [i["etudiantEmail"] for i in apres_courses], \
            "Elena ne devrait plus etre inscrite au cours (API)."

        import requests
        from config import COURSES_URL
        cours = requests.get(f"{COURSES_URL}/courses/{cours_id}").json()
        assert cours["placesRestantes"] == capacite, (
            f"Place devrait etre restituee a {capacite} ; vu : {cours['placesRestantes']}"
        )

        evidence(driver, "CT8_admin_retire_inscrit")
    finally:
        data_api.supprimer_cours_api_admin(admin_token, cours_id)
```

---

*Fin du rapport.*
