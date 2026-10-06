# 🚀 Context & State of the Project: Online Course Registration App

> **Note for AI Assistant**: This document serves as a complete technical context and state representation of this monorepo application. Read this file to immediately understand the architecture, database setup, running services, API contracts, and completed features.

---

## 📌 1. Executive Summary

This repository contains a **microservices-based Web Application for Online Course Registration**.
It follows a **Database-per-Service** architecture with an **API Gateway** as the single entry point for the **React Single Page Application (SPA)** frontend.

### 🛠️ Tech Stack
- **Frontend**: React 18 + Vite + TypeScript (vanilla CSS, modern UI)
- **Backend**: NestJS (v11/v10) + TypeScript
- **Database**: PostgreSQL 16 (running in Docker)
- **ORM**: Prisma (v7 / v5)
- **Communication**: Synchronous HTTP/REST calls

---

## 📐 2. Architecture & Service Map

```
                  ┌─────────────────────────────────────┐
                  │       🖥️ FRONTEND (React)           │
                  │        http://localhost:5173        │
                  └──────────────────┬──────────────────┘
                                     │ (calls only Gateway)
                                     ▼
                  ┌─────────────────────────────────────┐
                  │       🚪 API GATEWAY (NestJS)        │
                  │        http://localhost:3000        │
                  └───────┬──────────┬──────────┬───────┘
                          │          │          │
         ┌────────────────┘          │          └────────────────┐
         ▼                           ▼                           ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│ 👨‍🎓 STUDENTS       │       │  📚 COURSES       │       │ 📝 ENROLLMENTS    │
│ http://localhost: │       │ http://localhost: │       │ http://localhost: │
│ 3001              │       │ 3002              │       │ 3003              │
└────────┬──────────┘       └────────┬──────────┘       └────────┬───┬──────┘
         │                           │                           │   │
         │                           │ (HTTP client / Jalon 2)  ◄┤   │ (HTTP client / Jalon 2)
         │                           └───────────────────────────┘   ▼
         ▼                                                           ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│ 🐘 postgres-      │       │ 🐘 postgres-      │       │ 🐘 postgres-      │
│    students       │       │    courses        │       │    enrollments    │
│ Port 5432         │       │ Port 5433         │       │ Port 5434         │
│ (DB: students_db) │       │ (DB: courses_db)  │       │ (DB: enrollments) │
└───────────────────┘       └───────────────────┘       └───────────────────┘
```

---

## 🔌 3. Port & Database Mapping

| Service | Port | Database Container | DB Port Host:Container | DB Name |
|---|---|---|---|---|
| **Frontend** | `5173` | N/A | N/A | N/A |
| **Gateway** | `3000` | N/A | N/A | N/A |
| **Students** | `3001` | `postgres-students` | `5432:5432` | `students_db` |
| **Courses** | `3002` | `postgres-courses` | `5433:5432` | `courses_db` |
| **Enrollments** | `3003` | `postgres-enrollments` | `5434:5432` | `enrollments_db` |

---

## 🔐 3bis. Authentication & Roles (Jalon 3)

### Architecture
- **Localisation** : service `students` (il héberge déjà les comptes). Nouveau module `src/auth`.
- **Vérification du JWT** : à la **gateway** uniquement (via `JwtAuthGuard` + `RolesGuard`). Les services aval sont "aveugles" côté crypto.
- **Propagation d'identité** : la gateway, après avoir vérifié le JWT, pose les headers `X-User-Id` et `X-User-Role` sur les requêtes forwardées. Les services aval leur font confiance (dev — en prod, cloisonnement réseau requis).
- **Hash** : `bcryptjs` (zéro build natif, OK Windows/Node 24+).
- **Secret** : `JWT_SECRET` dans `.env` — **doit être identique** entre `students/.env` et `gateway/.env`.

### Rôles
- `ELEVE` (défaut) : login/logout, consulter catalogue, s'inscrire, voir ses inscriptions, annuler les siennes.
- `ADMIN` : tout ce qui précède + CRUD cours + voir toutes les inscriptions + annuler n'importe quelle inscription.
- Un ELEVE qui tente une action ADMIN reçoit `403 { code: "ROLE_INSUFFISANT" }`.

### Comptes de test (seedés)
Le modèle `Student` contient désormais `nom, prenom, email, telephone, password, role`.

| Rôle  | Email             | Mot de passe | Prénom | Nom | Téléphone |
|-------|-------------------|--------------|--------|-----|-----------|
| ADMIN | admin@test.com    | `admin123`   | Super  | Admin | +33 1 00 00 00 00 |
| ELEVE | eleve@test.com    | `eleve123`   | Elena  | Test  | +33 6 12 34 56 78 |
| ELEVE | jean.dupont@example.com (UUID historique `11111111-1111-4111-8111-111111111111`) | `eleve123` | Jean | Dupont | +33 6 11 22 33 44 |

**ADMIN unique** : il n'y a qu'un seul compte ADMIN et il est seedé. L'inscription publique crée **toujours** un ELEVE (voir sécurité ci-dessous).

### Matrice de permissions (gateway)

| Endpoint | Public | ELEVE | ADMIN |
|---|:-:|:-:|:-:|
| `POST /api/auth/login` | ✅ | ✅ | ✅ |
| `POST /api/auth/register` | ✅ (crée un ELEVE, pas d'ADMIN possible) | — | — |
| `GET /api/courses`, `GET /api/courses/:id` | ✅ | ✅ | ✅ |
| `POST /api/courses` | ❌ | 403 | ✅ |
| `PATCH /api/courses/:id` | ❌ | 403 | ✅ |
| `DELETE /api/courses/:id` | ❌ | 403 | ✅ |
| `POST /api/enrollments` | ❌ | ✅ (etudiantId forcé = token) | ✅ (idem) |
| `GET /api/enrollments` | ❌ | ✅ (filtre forcé = token) | ✅ (filtre libre ou tout) |
| `GET /api/enrollments/by-course/:coursId` | ❌ | 403 | ✅ |
| `DELETE /api/enrollments/:id` | ❌ | ✅ si propriétaire, sinon 403 | ✅ |

### Garanties de sécurité importantes
- **POST enrollment** : la gateway **remplace** systématiquement `etudiantId` du body par `req.user.sub`. Un ELEVE ne peut pas inscrire quelqu'un d'autre, même en forgeant le body.
- **GET enrollment** : pour un ELEVE, le filtre est forcé à son propre `sub` — il ne peut pas lister les inscriptions d'un autre élève.
- **DELETE enrollment** : la gateway propage `X-User-Id` / `X-User-Role` ; le service `enrollments` vérifie `propriétaire OU ADMIN` (sinon 403 `ACCES_INTERDIT`).
- **POST register** : triple défense pour empêcher l'auto-escalade ADMIN —
  (1) `RegisterDto` n'a PAS de champ `role` ;
  (2) `AuthService.register()` destructure uniquement les 5 champs attendus et appelle `students.create({..., role: 'ELEVE'})` en dur ;
  (3) `POST /api/students` n'est PAS exposé via la gateway, donc la seule porte d'entrée publique est register, qui force ELEVE.

### Endpoints Auth

**`POST /api/auth/login`** (public) → forward vers `students:/auth/login`
```json
// Request
{ "email": "eleve@test.com", "password": "eleve123" }
// Response 200
{
  "token": "eyJhbGciOi…",
  "user": { "id": "uuid", "email": "...", "nom": "...", "prenom": "...", "telephone": "...", "role": "ELEVE" }
}
// Response 401 — identifiants invalides
{ "code": "IDENTIFIANTS_INVALIDES", "message": "Email ou mot de passe incorrect." }
```

**`POST /api/auth/register`** (public) → forward vers `students:/auth/register`
```json
// Request
{ "nom": "Durand", "prenom": "Paul", "email": "paul@x.y",
  "telephone": "+33 6 12 34 56 78", "password": "motdepasse1" }
// Response 201 — auto-connexion
{ "token": "eyJhbGciOi…",
  "user": { "id": "uuid", "email": "paul@x.y", "nom": "Durand", "prenom": "Paul",
            "telephone": "+33 6 12 34 56 78", "role": "ELEVE" } }
// Response 409 — email deja pris
{ "code": "EMAIL_DEJA_UTILISE", "message": "Un compte avec cet email existe déjà." }
// Response 400 — validation (champs manquants / telephone invalide / password < 6)
```
Toute tentative de passer `role: "ADMIN"` dans le body est **ignorée** (le serveur force ELEVE).

### Erreurs standardisées (format `{ code, message }`)
| Code | HTTP | Signification |
|---|---|---|
| `IDENTIFIANTS_INVALIDES` | 401 | Login échoué |
| `NON_AUTHENTIFIE`        | 401 | Token manquant |
| `TOKEN_INVALIDE`         | 401 | Token invalide ou expiré |
| `ROLE_INSUFFISANT`       | 403 | Rôle insuffisant pour cette action |
| `ACCES_INTERDIT`         | 403 | Inscription non possédée par l'appelant |
| `EMAIL_DEJA_UTILISE`     | 409 | Register : email déjà pris |

---

## 🚦 4. Current Progress & Completed Features

### ✅ Completed Tasks (Jalon 1 & Jalon 2)
1. **API Gateway**:
   - Acts as a reverse proxy via `@nestjs/axios` forwarding `/api/students/*`, `/api/courses/*`, and `/api/enrollments/*` to their respective downstream microservices.
   - CORS is enabled for `http://localhost:5173`.
   - Handles downstream service errors (returns original error code/payload, or `502 Bad Gateway` if down).

2. **Microservices Inter-Service Communication (Jalon 2)**:
   - `Enrollments` microservice uses real HTTP clients (`HttpStudentsClient` & `HttpCoursesClient`) to communicate with `Students` (`:3001`) and `Courses` (`:3002`).
   - When creating an enrollment:
     1. Verifies student existence (`GET /students/:id`).
     2. Verifies course existence (`GET /courses/:id`).
     3. Checks available seats (`placesRestantes > 0`).
     4. Checks for duplicate registration (unique constraint `@@unique([etudiantId, coursId])` in Prisma).
     5. Atomically creates enrollment record in `enrollments_db` and decrements seats (`PATCH /courses/:id/seats` with `{ delta: -1 }`).

3. **Validation & Security**:
   - Strict UUID validation enforced on `etudiantId` and `coursId` via NestJS `ValidationPipe` and `class-validator` `@IsUUID()`.
   - Valid RFC-4122 v4 UUID format default test student created: `11111111-1111-4111-8111-111111111111` ("Jean Dupont").

4. **Frontend**:
   - Clean, modern tabbed UI (Catalogue vs. Mes Inscriptions).
   - Real-time visual progress bars showing remaining course capacity.
   - Handles loading states, error banners, and automatic catalog refresh upon registration.

---

## 📡 5. API Endpoints Contract

### 🚪 Gateway (`http://localhost:3000`)
- `POST /api/auth/login` → **public** — login (voir §3bis)
- `GET /api/courses` → List all courses (public)
- `GET /api/courses/:id` → Single course details (public)
- `POST /api/courses` → **ADMIN only** — body `{ titre, capacite }`
- `PATCH /api/courses/:id` → **ADMIN only** — body partiel
- `DELETE /api/courses/:id` → **ADMIN only** — 204
- `GET /api/students` → List students
- `GET /api/students/:id` → Single student details
- `POST /api/enrollments` → **auth requis** — body `{ coursId }`. `etudiantId` tiré du token.
- `GET /api/enrollments[?etudiantId=UUID]` → **auth requis**. Chaque inscription contient `coursTitre` (ou `"Cours supprimé"` si le cours n'existe plus). ELEVE : voit uniquement ses inscriptions. ADMIN : filtre libre ou tout lister.
- `GET /api/enrollments/by-course/:coursId` → **ADMIN only**. Liste des élèves inscrits à un cours, enrichie : chaque entrée a `etudiantNom` + `etudiantEmail` (ou `"Étudiant supprimé"` si le compte n'existe plus).
- `DELETE /api/enrollments/:id` → **auth requis (JWT Bearer)**. Annule l'inscription + restitue 1 place au cours. Autorisé au propriétaire OU à un ADMIN.

### 👨‍🎓 Students Service (`http://localhost:3001`)
- `POST /auth/login` → `{ email, password }` → `{ token, user }`
- `POST /auth/register` → `{ nom, prenom, email, telephone, password }` → `{ token, user }` (role **forcé** à ELEVE côté serveur)
- `GET /students` | `POST /students` (body : `nom, prenom?, email, telephone?, password, role?`)
- `GET /students/:id` | `PATCH /students/:id` | `DELETE /students/:id`

### 📚 Courses Service (`http://localhost:3002`)
- `GET /courses` | `POST /courses`
- `GET /courses/:id` | `PATCH /courses/:id` | `DELETE /courses/:id`
- `PATCH /courses/:id/seats` → Body: `{ "delta": -1 }` (decrement) ou `{ "delta": 1 }` (restitution)

### 📝 Enrollments Service (`http://localhost:3003`)
- `POST /enrollments` → Body: `{ "etudiantId": "UUID", "coursId": "UUID" }`
- `GET /enrollments[?etudiantId=UUID]` → Returns enrollments (filtered or all) **enrichies avec `coursTitre`** (appel au service courses). `"Cours supprimé"` si introuvable.
- `GET /enrollments/by-course/:coursId` → Enrollments d'un cours **enrichies avec `etudiantNom`, `etudiantPrenom`, `etudiantEmail`, `etudiantTelephone`** (appel au service students). `"Étudiant supprimé"` + chaînes vides si introuvable. (Gating ADMIN à la gateway.)
- `DELETE /enrollments/:id` → **requiert les headers `X-User-Id` et `X-User-Role`** (posés par la gateway). Supprime l'inscription puis restitue 1 place au cours (best-effort). `204 No Content` en succès.

---

## ⚡ 6. How to Start the Application (Step-by-Step)

### Step 1: Start Databases
```powershell
# From project root
docker-compose up -d
```

### Step 2: Start Microservices (5 separate terminals or background jobs)
```powershell
# Terminal 1 - Students Service
cd students
npm run start:dev   # http://localhost:3001

# Terminal 2 - Courses Service
cd courses
npm run start:dev   # http://localhost:3002

# Terminal 3 - Enrollments Service
cd enrollments
npm run start:dev   # http://localhost:3003

# Terminal 4 - Gateway
cd gateway
npm run start:dev   # http://localhost:3000

# Terminal 5 - Frontend
cd frontend
npm run dev         # http://localhost:5173
```

### Optional: Database Reset / Re-seed
```powershell
# In students/  (schema inclut password + role depuis Jalon 3)
npx prisma migrate reset --force    # drop + applique toutes les migrations
npx prisma db seed                  # recree admin@test.com + eleve@test.com + Jean Dupont

# In courses/
npx prisma db push
npx prisma db seed

# In enrollments/
npx prisma db push
```

### Configuration Auth (Jalon 3) — à faire une fois
Copier `.env.example` → `.env` dans `students/` **et** `gateway/`, puis mettre la MÊME valeur
pour `JWT_SECRET` dans les deux fichiers (sinon la gateway rejettera tout token émis par students).

---

## 🌐 7. Frontend (Jalon 3) — routage, auth, rôles

- **Routing** : `react-router-dom` v6. Routes :
  - `/login` — formulaire de connexion (public). Redirige l'utilisateur déjà connecté vers sa home.
  - `/catalogue` — tous rôles authentifiés. ELEVE : bouton « S'inscrire ». ADMIN : lecture seule.
  - `/mes-inscriptions` — ELEVE uniquement. Affiche les inscriptions + bouton « Annuler ».
  - `/admin` — ADMIN uniquement. CRUD cours (créer / modifier / supprimer).
- **Token** : stocké dans `localStorage` (`auth_token` + `auth_user`). Automatiquement injecté en `Authorization: Bearer …` par `api.ts`.
- **Déconnexion** : bouton dans le header (`data-testid="logout-btn"`) → purge localStorage + redirige `/login`.
- **ProtectedRoute** : redirige `/login` si non connecté, `/catalogue` si rôle insuffisant.

### `data-testid` pour les tests E2E Selenium
| data-testid | Élément | Écran |
|---|---|---|
| `login-form`, `email-input`, `password-input`, `login-submit`, `login-error`, `to-register-link` | Formulaire de connexion | /login |
| `register-form`, `register-nom`, `register-prenom`, `register-email`, `register-telephone`, `register-password`, `register-submit`, `register-error`, `to-login-link` | Formulaire d'inscription (sign-up) | /register |
| `logout-btn`, `user-area`, `user-name` | Zone utilisateur | header global |
| `nav-catalogue`, `nav-mes-inscriptions`, `nav-admin` | Liens de navigation | header |
| `catalogue`, `course-card-<id>`, `inscrire-btn-<id>`, `catalogue-success`, `catalogue-error` | Catalogue | /catalogue |
| `mes-inscriptions`, `inscription-card-<id>`, `annuler-btn-<id>` | Mes inscriptions | /mes-inscriptions |
| `admin-courses`, `admin-course-<id>`, `new-course-titre`, `new-course-capacite`, `create-course-submit`, `edit-btn-<id>`, `delete-btn-<id>`, `edit-titre-<id>`, `edit-capacite-<id>`, `save-edit-<id>`, `voir-inscrits-btn-<id>`, `inscrits-panel-<id>`, `inscrits-vide-<id>`, `inscrit-<inscriptionId>`, `inscrit-nom-<inscriptionId>`, `inscrit-email-<inscriptionId>`, `inscrit-telephone-<inscriptionId>` | Admin cours + inscrits par cours (nom = prénom + nom) | /admin |
| `inscription-cours-titre-<id>` | Titre du cours dans « Mes inscriptions » | /mes-inscriptions |

---

## ⚡ 8. Scénario de test complet (parcours principal)

Scénario d'acceptation du jalon 3 (correspond à la demande initiale) :

1. **Démarrer** docker-compose + les 4 microservices + le front (voir §6).
2. Un **ELEVE** ouvre `http://localhost:5173` → est redirigé vers `/login`.
3. Il se connecte avec `eleve@test.com` / `eleve123` → arrive sur `/catalogue`.
4. Il clique sur « S'inscrire » pour un premier cours (ex: cours A) → ✅ message succès, places décrémentées.
5. Il clique sur « Se déconnecter » → retour `/login`.
6. Il se reconnecte (même compte) → `/catalogue`.
7. Il clique sur « S'inscrire » pour un second cours (cours B) → ✅ succès.
8. Il va sur « Mes inscriptions » → voit les 2 inscriptions, chacune avec un bouton « Annuler ».
9. Il clique « Annuler » sur l'inscription du cours A → ✅ l'inscription disparaît, et dans le catalogue le cours A a **+1 place** restituée.

En parallèle :
- **ADMIN** `admin@test.com` / `admin123` peut aller sur `/admin`, créer / modifier / supprimer un cours.
- Un **ELEVE** qui tente `POST /api/courses` directement via curl obtient **403 `ROLE_INSUFFISANT`**.

---

## 💬 9. Copy-Paste AI Prompt (For restarting with any AI)

> *"Je travaille sur une application d'inscription aux cours basée sur une architecture microservices (NestJS, React, Prisma, PostgreSQL dans Docker). Veuillez lire attentivement le fichier `PROJECT_CONTEXT.md` à la racine pour comprendre l'architecture, la carte des ports, les contrats d'API et l'état actuel du projet avant de poursuivre."*
