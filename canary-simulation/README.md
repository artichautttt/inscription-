# Canary release + rollback automatique (sans Docker / Kubernetes)

## Principe
- `courses` existe en deux instances : **v1** (stable, :3002) et **v2** (canary, :3012, meme build, lancee sous pm2).
- Le **gateway** evalue le feature flag Unleash `courses-v2-canary` (strategie *Gradual rollout*, stickiness `default` = userId)
  et route les **lectures** `GET /api/courses[/:id]` vers v1 ou v2. Les ecritures vont toujours vers v1.
  Reponse : en-tete `X-Backend-Version: v1|v2`.
- Le gateway tient des metriques en fenetre glissante par version : `GET /internal/canary-metrics` (route interne, non relayee par nginx).
- Le **rollback-watcher** lit ces metriques ; si le taux d'erreur de v2 >= seuil pendant N controles consecutifs (min. de requetes requis),
  il **desactive le flag** via l'API admin Unleash. Il ne reactive jamais le flag seul.
- Securite : si Unleash n'est pas configure / pas pret, tout va vers v1. **Aucun repli par requete** de v2 vers v1 (sinon la panne serait masquee).

## Parametres (valeurs de la simulation)
| Parametre | Valeur | Ou |
|---|---|---|
| Pourcentage du flag | 20 % (a regler dans Unleash) | Unleash |
| Rafraichissement du flag (SDK) | 2 s | `UNLEASH_REFRESH_MS` (gateway) |
| Fenetre de metriques | 10 s | `CANARY_WINDOW_MS` (gateway) |
| Delai max vers un service | 3 s | `UPSTREAM_TIMEOUT_MS` (gateway) |
| Seuil d'erreur | 50 % | `ERROR_THRESHOLD` (watcher) |
| Controles consecutifs | 3 | `CONSECUTIVE_CHECKS` |
| Intervalle de controle | 1 s | `CHECK_INTERVAL_MS` |
| Minimum de requetes v2 | 10 | `MIN_REQUESTS` |

Erreur = reponse >= 500, delai depasse ou service injoignable. Un 4xx n'est pas une erreur.

## Scenarios (`simulation/run-scenario.sh <A|B|C|D> <run>`)
- **A** sain : aucune panne, le watcher ne doit pas declencher.
- **B** panne franche : `pm2 stop courses-v2`.
- **C** degradation : `pm2 sendSignal SIGSTOP courses-v2` (le processus gele, les requetes depassent le delai).
- **D** panne puis **recovery** : comme B, puis redemarrage de v2, reactivation MANUELLE du flag, watcher rearme ; on verifie des reponses v2 en 200.

Mesures par run (`summary.json`) : delai de detection et de rollback depuis la panne, delai de propagation du flag jusqu'au gateway,
erreurs avant / pendant / apres, part de trafic v2. Resultats bruts dans `~/canary-results/<scenario>-<run>/`.

## Test local (faux services)
`(cd gateway && npm run build) && node canary-simulation/test/local-e2e.js` : verifie la chaine detection -> rollback avec de faux
services (ce n'est PAS un resultat de simulation, seulement un test du dispositif).
