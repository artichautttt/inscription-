# API Gateway (gateway) — Dev B

Point d'entrée unique de l'application. Le front n'appelle QUE la gateway ;
elle relaie chaque requête vers le bon service (proxy, sans logique métier).

```
Front ─▶ Gateway ─▶ /api/students     ▶ Service Étudiants (A) :3001
                ─▶ /api/courses      ▶ Service Cours (A)     :3002
                ─▶ /api/enrollments  ▶ Service Inscriptions  :3003
```

## Démarrage
```bash
cp .env.example .env
npm install
npm run start:dev        # http://localhost:3000
```
Vérifier : GET http://localhost:3000/health -> { "status": "ok", ... }

## État
- [x] Squelette + /health
- [x] ProxyService (relais générique + gestion d'erreurs 502)
- [x] /api/courses (exemple de référence, complet)
- [ ] /api/students     (à compléter — copier courses.controller.ts)
- [ ] /api/enrollments  (à compléter — POST + GET ?etudiantId=)
