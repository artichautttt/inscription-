# Service Inscriptions (enrollments) — Dev B

Cœur métier du projet : inscrit un étudiant à un cours en consommant les
services du Dev A (Étudiants, Cours). Squelette du **Jalon 0** : structure
complète, `/health` opérationnel, logique métier prête à être écrite au Jalon 1.

## Démarrage

```bash
cp .env.example .env
npm install
docker compose up -d enrollments-db     # Postgres local
npm run prisma:migrate                   # crée la table "inscriptions"
npm run start:dev                        # http://localhost:3003
```

Vérifier : `GET http://localhost:3003/health` -> `{ "status": "ok", ... }`

## Tests

```bash
npm test
```

## Ce qui est fait (Jalon 0) / à faire (Jalon 1)

- [x] Squelette NestJS : module, controller, service
- [x] Entité Prisma `Inscription` (UUID, contrainte unique étudiant+cours)
- [x] Endpoint `/health`
- [x] DTO validé (UUID), erreurs métier standard `{ code, message }`
- [x] Contrats + clients MOCKÉS pour Étudiants / Cours
- [x] `GET /enrollments?etudiantId=...` ("Mes inscriptions")
- [ ] **`create()` : les 4 règles métier** (voir le commentaire de la méthode)
- [ ] Compléter les tests Jest `it.todo(...)` des règles

## Routes

| Méthode | Route | Rôle |
|---|---|---|
| GET  | `/health` | Vérification de vie du service |
| POST | `/enrollments` | Inscrire un étudiant (`{ etudiantId, coursId }`) |
| GET  | `/enrollments?etudiantId=<uuid>` | Inscriptions d'un étudiant |

## Codes d'erreur (contrat partagé avec Dev A)

| HTTP | code | Cas |
|---|---|---|
| 404 | `RESSOURCE_INTROUVABLE` | étudiant ou cours inconnu |
| 409 | `INSCRIPTION_DUPLIQUEE` | doublon étudiant + cours |
| 422 | `COURS_COMPLET` | plus de place |
