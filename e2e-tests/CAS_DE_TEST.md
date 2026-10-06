# Spécification des cas de test — Tests E2E Selenium

Projet « Test Logiciel » — Application d'inscription aux cours en ligne
Livrable de l'étape 3 (Conception du test) du processus ISTQB.

---

## 1. Contexte

| Élément | Valeur |
|---|---|
| Niveau de test | Système / bout-en-bout (E2E) |
| Objet testé | IHM React (http://localhost:5173) + chaîne front → Gateway → microservices |
| Outil | Selenium WebDriver (Python + pytest) |
| Approche | Scripts de test écrits (WebDriver), pas d'enregistrement Selenium IDE |
| Base de test | Règles métier du service Inscriptions + fonctionnalités du front (dont auth jalon 3) |
| Emplacement | dossier e2e-tests/ |

Positionnement : les tests E2E sont au sommet de la pyramide (peu nombreux, lents),
ils couvrent quelques parcours clés et complètent les tests unitaires Jest.

Depuis le jalon 3 : les cas CT1-CT5 commencent par se connecter (le catalogue
exige d'être authentifié).

---

## 2. Traçabilité (règle / fonctionnalité ↔ cas de test)

| Règle / fonctionnalité | Cas | Niveau approprié |
|---|---|---|
| Consultation du catalogue | CT4 | E2E |
| Il doit rester des places (places > 0) | CT2 | E2E |
| Pas de doublon | CT3 | E2E |
| Inscription nominale (élève seedé) | CT1 | E2E |
| Consultation « Mes inscriptions » | CT5 | E2E |
| Sign-up public d'un nouvel ELEVE + auto-connexion + réservation | **CT6** | E2E |
| Admin crée un cours via l'IHM | **CT7** | E2E |
| Admin retire un élève d'un cours (restitution de place) | **CT8** | E2E |
| L'étudiant doit exister (404) | — | API / unitaire |
| Le cours doit exister (404) | — | API / unitaire |
| Rôle forcé ELEVE sur register (pas d'auto-escalade) | — | unitaire (auth.service.spec) |

Les règles « étudiant/cours inconnu » et « rôle forcé » ne sont pas pertinentes
en E2E (données non manipulables depuis l'IHM) : couvertes au niveau unitaire.

---

## 3. Cas de test détaillés

### CT1 — Inscription réussie (nominal)
- Technique : partition d'équivalence (valide).
- Pré-conditions : cours avec places > 0 ; étudiant non encore inscrit à ce cours ; connexion ELEVE.
- Données : cours « CT1 Nominal {ts} » (10 places) ; étudiant Jean Dupont.
- Étapes : se connecter (Jean / eleve123) → catalogue → cliquer « S'inscrire ».
- Résultat attendu : message « Inscription réussie ! ».
- Statut : IMPLÉMENTÉ.

### CT2 — Cours complet
- Technique : valeur limite (placesRestantes = 0).
- Pré-conditions : un cours à 0 place ; connexion ELEVE.
- Données : cours « CT2 Complet {ts} » ramené à 0 via l'API.
- Étapes : se connecter → catalogue → repérer le cours complet.
- Résultat attendu : bouton « Complet » désactivé ; texte « Complet » présent.
- Statut : IMPLÉMENTÉ.

### CT3 — Doublon
- Technique : partition d'équivalence (invalide).
- Pré-conditions : Jean Dupont est déjà inscrit à un cours donné ; connexion Jean.
- Données : inscription pré-créée via API.
- Étapes : se connecter → tenter une nouvelle inscription au même cours via l'IHM.
- Résultat attendu : message d'erreur affiché (409 doublon côté backend).
- Statut : IMPLÉMENTÉ.

### CT4 — Consultation du catalogue
- Technique : test fonctionnel.
- Pré-conditions : ≥1 cours en base ; connexion ELEVE.
- Étapes : se connecter → catalogue → parcourir les cartes.
- Résultat attendu : ≥1 cours listé ; titre non vide + indicateur de places.
- Statut : IMPLÉMENTÉ.

### CT5 — Mes inscriptions
- Technique : test fonctionnel.
- Pré-conditions : connexion ELEVE.
- Étapes : se connecter → cliquer sur l'onglet « Mes inscriptions ».
- Résultat attendu : l'écran s'affiche (inscriptions OU état vide), sans erreur.
- Statut : IMPLÉMENTÉ.

### CT6 — Sign-up puis réservation
- Technique : parcours fonctionnel (nouveau utilisateur).
- Pré-conditions : un cours avec des places (créé via API).
- Données : nouvel email unique `ct6.nouveau.{ts}@test.com`.
- Étapes :
  1. Ouvrir `/login` → cliquer « S'inscrire » → remplir le formulaire → soumettre.
  2. Vérifier que le header affiche le nom du nouvel élève (auto-connexion).
  3. Aller au catalogue → cliquer « S'inscrire » sur le cours.
  4. Aller à « Mes inscriptions » et vérifier que la réservation apparaît
     avec le **nom du cours**, pas l'UUID (`inscription-cours-titre-*`).
- Résultat attendu : message de succès + titre du cours dans Mes inscriptions.
- Statut : IMPLÉMENTÉ (nouveau).

### CT7 — Admin crée un cours
- Technique : parcours fonctionnel admin.
- Pré-conditions : connexion admin seedée (`admin@test.com / admin123`).
- Données : titre « Cybersécurité (test) {ts} », 20 places.
- Étapes : se connecter admin → onglet « Gestion des cours » → remplir le
  formulaire « Nouveau cours » → cliquer « Créer » → aller sur le catalogue.
- Résultat attendu : le cours apparaît dans la gestion ET dans le catalogue
  avec 20/20 places restantes.
- Teardown : suppression du cours via l'API (idempotent).
- Statut : IMPLÉMENTÉ (nouveau).

### CT8 — Admin retire un élève d'un cours
- Technique : parcours fonctionnel admin + vérification métier
  (restitution de place).
- Pré-conditions (via API) :
  - Cours « Développement Cloud {ts} » (10 places) créé.
  - Élève Elena (prénom Elena, nom « Eleve Test », email unique) créée via register.
  - Elena inscrite au cours.
- Étapes : admin se connecte → Gestion des cours → clique « Voir inscrits »
  sur le cours → clique « Retirer » sur la ligne d'Elena.
- Résultat attendu : Elena disparaît des inscrits (UI + API) ; placesRestantes
  revient à 10 (vérifié via `GET /courses/{id}`).
- Teardown : suppression du cours via API gateway (admin token).
- Statut : IMPLÉMENTÉ (nouveau).

---

## 4. État d'avancement

| Cas | Statut | Verdict |
|---|---|---|
| CT1 | implémenté | — (à exécuter) |
| CT2 | implémenté | — |
| CT3 | implémenté | — |
| CT4 | implémenté | PASS (évidence antérieure) |
| CT5 | implémenté | — |
| CT6 | implémenté (nouveau) | — |
| CT7 | implémenté (nouveau) | — |
| CT8 | implémenté (nouveau) | — |

---

## 5. Environnement d'exécution

- Pré-requis : bases Docker + students(3001), courses(3002), enrollments(3003),
  gateway(3000), frontend(5173). Comptes seedés : voir PROJECT_CONTEXT.md § 3bis.
- Fixture `pause_apres_test` dans `conftest.py` : pause configurable **après chaque
  test** (constante `PAUSE_ENTRE_TESTS`, défaut `2` s) pour pouvoir observer
  visuellement. Mettre à `0` pour une exécution CI rapide.
- Les pré-conditions se posent exclusivement **via l'API** (`data_api.py`) :
  création de cours / comptes / inscriptions, chaque test cleanse après lui ;
  les données portent un `{ts}` (timestamp) pour éviter les collisions.
- Lancement :
  - Suite complète : `pytest`
  - Un seul cas : `pytest test_ct7_admin_cree_cours.py`
  - Un test précis : `pytest test_ct8_admin_retire_inscrit.py::test_ct8_admin_retire_inscrit`
- Navigateur : Edge par défaut (`conftest.py`), captures dans `screenshots/`.
