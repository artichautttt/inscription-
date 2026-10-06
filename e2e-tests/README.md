# Tests E2E Selenium — Projet Inscriptions

Tests de **niveau système (bout-en-bout)** pilotant l'IHM React via Selenium.
Complètent les tests unitaires Jest (niveau composant).

## Installation (une fois)
```bash
cd e2e-tests
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
```

## Pré-requis avant d'exécuter
L'application doit tourner (voir PROJECT_CONTEXT.md) :
bases Docker + students(3001) + courses(3002) + enrollments(3003) + gateway(3000) + frontend(5173).

## Exécution
```bash
pytest                       # tous les tests
pytest test_ct4_catalogue.py # un seul cas
```
Navigateur par défaut : **Edge** (présent sur Windows). Pour Chrome, voir `conftest.py`.
Les captures d'écran de preuve/échec sont dans `screenshots/`.

## Traçabilité cas de test ↔ règles métier
| Cas | Fichier | Règle / fonctionnalité |
|---|---|---|
| CT4 | test_ct4_catalogue.py | Consultation du catalogue |
| CT1 | (à venir) | Inscription nominale |
| CT2 | (à venir) | Cours complet (places = 0) |
| CT3 | (à venir) | Doublon (déjà inscrit) |
