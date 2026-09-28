# Frontend (React + Vite + TS) — Dev B

Interface : catalogue des cours, inscription, "Mes inscriptions".
N'appelle QUE l'API Gateway (VITE_API_URL).

## Démarrage
```bash
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
```
Prérequis : la Gateway (:3000) et les services doivent tourner pour voir les données.

## État
- [x] Projet Vite + client API + gestion des 3 états (chargement/erreur/données)
- [x] Catalogue (liste + s'inscrire) — exemple de référence
- [ ] MesInscriptions.tsx — à compléter sur le modèle de Catalogue.tsx

## Note
`ETUDIANT_ID` (dans src/App.tsx) est fixé en dur (pas d'auth dans ce projet).
Remplace-le par un ID réel du service Étudiants de A.
