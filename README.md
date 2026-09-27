# Application d'inscription aux cours en ligne — Services Étudiants & Cours (Dev A)

## Prérequis
- Node.js 20+
- Docker Desktop
- npm

## 1. Lancer les bases de données

Depuis la racine du monorepo :
```bash
docker-compose up -d
```
Ça lance 3 conteneurs PostgreSQL :
- `postgres-students` sur le port `5432`
- `postgres-courses` sur le port `5433`
- `postgres-enrollments` sur le port `5434`

## 2. Configurer les variables d'environnement

Dans `students/` et `courses/`, copier le fichier d'exemple :
```bash
cp .env.example .env
```
(Les valeurs par défaut correspondent au `docker-compose.yml` fourni — pas besoin de les modifier en local.)

## 3. Installer les dépendances

```bash
cd students
npm install

cd ../courses
npm install
```

## 4. Lancer les migrations Prisma (première fois uniquement)

```bash
cd students
npx prisma migrate dev

cd ../courses
npx prisma migrate dev
```

## 5. Charger des données de démo (optionnel)

```bash
cd students
npx prisma db seed

cd ../courses
npx prisma db seed
```

## 6. Démarrer les services

Dans deux terminaux séparés :
```bash
cd students
npm run start:dev   # écoute sur http://localhost:3001
```
```bash
cd courses
npm run start:dev   # écoute sur http://localhost:3002
```

## Endpoints disponibles

Voir le contrat complet dans `openapi-etudiants-cours.yaml`.

**Étudiants** (`http://localhost:3001`)
- `GET /students` — liste
- `POST /students` — créer
- `GET /students/:id` — un étudiant
- `PATCH /students/:id` — modifier
- `DELETE /students/:id` — supprimer

**Cours** (`http://localhost:3002`)
- `GET /courses` — liste
- `POST /courses` — créer
- `GET /courses/:id` — un cours
- `PATCH /courses/:id` — modifier
- `PATCH /courses/:id/seats` — ajuster les places (`{ "delta": -1 }`)
- `DELETE /courses/:id` — supprimer

## Tests

```bash
cd students
npm run test

cd courses
npm run test
```

## Notes importantes pour Dev B
- NestJS a été downgradé de la v12 vers la **v11** pour résoudre un conflit de compatibilité ESM/CommonJS avec Jest. Si ton service utilise aussi NestJS 12, tu rencontreras probablement le même problème — downgrade recommandé.
- Node.js a été mis à jour vers la **v24+** sur cette machine (nécessaire pour certaines dépendances).