# waitlist-service — liste d'attente pour cours complets

Microservice Java (Spring Boot 4.1 / Java 17 / Maven) du monorepo « inscription aux cours en ligne ».
Quand un cours est complet, un étudiant peut rejoindre sa file d'attente ; quand une place se
libère, un admin promeut le premier de la file, qui est alors inscrit via le service Inscriptions.

- Port : **3004**
- Stockage : **en mémoire** (la file est perdue au redémarrage, pas de base de données)
- Architecture : `controller → service → repository`, plus trois clients HTTP définis comme
  interfaces (`CoursesClient`, `EnrollmentsClient`, `StudentsClient`) avec une implémentation
  `Http*Client`, sur le modèle de `enrollments/src/clients/`.

## Prérequis

- JDK 17+ (`java -version`)
- Rien d'autre : Maven est fourni par le wrapper (`mvnw` / `mvnw.cmd`), téléchargé au premier lancement.

## Lancement

```powershell
cd waitlist-service
.\mvnw.cmd spring-boot:run        # Windows
./mvnw spring-boot:run            # Linux / macOS / Git Bash
```

Le service écoute sur http://localhost:3004. Pour un usage réel il faut aussi les services
`students` (3001), `courses` (3002) et `enrollments` (3003) ; sans eux, les endpoints qui en
dépendent répondent `502 SERVICE_INDISPONIBLE`.

### Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3004` | Port d'écoute |
| `STUDENTS_SERVICE_URL` | `http://localhost:3001` | Service Étudiants |
| `COURSES_SERVICE_URL` | `http://localhost:3002` | Service Cours |
| `ENROLLMENTS_SERVICE_URL` | `http://localhost:3003` | Service Inscriptions |

Côté gateway, l'URL de ce service se règle avec `WAITLIST_SERVICE_URL` (défaut `http://localhost:3004`).

## Endpoints

### Service (http://localhost:3004)

| Méthode | Chemin | Description | Succès |
|---|---|---|---|
| `GET` | `/health` | État du service | 200 |
| `POST` | `/waitlist` | Rejoindre la file. Body `{ "etudiantId": "UUID", "coursId": "UUID" }` | 201 + l'entrée avec sa `position` |
| `GET` | `/waitlist/courses/:coursId` | File du cours, ordre FIFO, positions à partir de 1 | 200 + tableau |
| `DELETE` | `/waitlist/:id` | Quitter la file. **Headers `X-User-Id` et `X-User-Role` requis** (posés par la gateway) : autorisé au propriétaire de l'entrée ou à un `ADMIN` | 204 |
| `POST` | `/waitlist/courses/:coursId/promote` | Inscrit le premier de la file (`POST /enrollments`) puis le retire de la file | 201 + `{ etudiantId, coursId, inscription }` |

Exemple de réponse à `POST /waitlist` :

```json
{
  "id": "5f0c…",
  "etudiantId": "11111111-1111-4111-8111-111111111111",
  "coursId": "33333333-3333-4333-8333-333333333333",
  "dateAjout": "2026-10-10T08:00:00Z",
  "position": 1
}
```

Les positions ne sont pas stockées : elles sont dérivées de l'ordre de la file, donc recalculées
automatiquement quand quelqu'un la quitte ou est promu.

### Via la gateway (http://localhost:3000) — JWT requis partout

| Méthode | Chemin | Qui | Remarque |
|---|---|---|---|
| `POST` | `/api/waitlist` | tout utilisateur authentifié | body `{ coursId }` ; `etudiantId` est **forcé** depuis le token |
| `DELETE` | `/api/waitlist/:id` | propriétaire de l'entrée, ou ADMIN | identité propagée en `X-User-Id` / `X-User-Role` |
| `GET` | `/api/waitlist/courses/:coursId` | ADMIN | sinon `403 ROLE_INSUFFISANT` |
| `POST` | `/api/waitlist/courses/:coursId/promote` | ADMIN | sinon `403 ROLE_INSUFFISANT` |

### Erreurs

Même format que les autres services : `{ "code": "...", "message": "..." }`.

| Code | HTTP | Quand |
|---|---|---|
| `REQUETE_INVALIDE` | 400 | Champ manquant, JSON mal formé, identifiant qui n'est pas un UUID |
| `ACCES_INTERDIT` | 403 | `DELETE` sans identité, ou entrée d'un autre étudiant |
| `RESSOURCE_INTROUVABLE` | 404 | Étudiant, cours ou entrée de file inconnu |
| `DEJA_EN_LISTE_ATTENTE` | 409 | L'étudiant est déjà dans la file de ce cours |
| `DEJA_INSCRIT` | 409 | L'étudiant est déjà inscrit à ce cours |
| `FILE_VIDE` | 409 | Promotion demandée alors que la file est vide |
| `COURS_NON_COMPLET` | 422 | `placesRestantes > 0` : il faut s'inscrire directement |
| `COURS_COMPLET` | 422 | Promotion demandée alors qu'il n'y a aucune place libre |
| `SERVICE_INDISPONIBLE` | 502 | Un service aval est injoignable ou a répondu de façon inattendue |

Lors d'une promotion, un refus métier du service Inscriptions (4xx au format `{ code, message }`,
par ex. `INSCRIPTION_DUPLIQUEE`) est relayé tel quel, et l'étudiant **reste** dans la file.

## Tests, couverture, mutation

Toutes les commandes se lancent depuis `waitlist-service/` (remplacer `./mvnw` par `.\mvnw.cmd`
sous PowerShell/cmd).

| Objectif | Commande | Rapport |
|---|---|---|
| Tests unitaires seuls | `./mvnw test` | `target/surefire-reports/` |
| Tests + couverture JaCoCo + règle des 80 % | `./mvnw verify` | `target/site/jacoco/index.html` |
| Mutation testing (PIT) | `./mvnw test-compile org.pitest:pitest-maven:mutationCoverage` | `target/pit-reports/index.html` |

- **JaCoCo** : `verify` échoue (`Coverage checks have not been met`) si la couverture du projet
  passe sous **80 % de lignes** ou **80 % de branches**.
- **PIT** : mutateurs par défaut de PIT, sur toutes les classes de `com.inscription.waitlist`.

### Ce que couvrent les tests

- `WaitlistServiceTest` — logique métier, clients **et** repository mockés (Mockito) ; tests
  paramétrés sur les cas limites (file vide / 1 élément / plusieurs, doublon, cours non complet,
  promotion avec 0 place, frontière `placesRestantes` 0 / 1).
- `WaitlistServicePositionsTest` — service + vrai repository en mémoire : recalcul des positions.
- `InMemoryWaitlistRepositoryTest` — ordre FIFO, filtrage par cours, suppression.
- `WaitlistControllerTest` — MockMvc (`@WebMvcTest`) : codes HTTP, format d'erreur, validation.
- `Http*ClientTest` — clients HTTP contre un `MockRestServiceServer` (200 / 404 / 5xx / panne réseau).
- `ClientsConfigTest` — câblage des URLs, avec un vrai aller-retour HTTP sur un serveur local éphémère.

### Limites connues

- Stockage en mémoire, instance unique : pas de persistance ni de montée en charge horizontale.
- Les méthodes du service qui modifient la file sont `synchronized` ; ce verrouillage n'est pas
  couvert par des tests de concurrence.
- Si l'inscription du premier de la file échoue durablement (ex. étudiant supprimé), il bloque la
  file jusqu'à ce qu'un ADMIN retire son entrée (`DELETE /waitlist/:id`).
- Le texte des messages de validation (`REQUETE_INVALIDE`) dépend de la locale de la JVM ; le `code` non.
