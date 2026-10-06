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
