"""Preparation des donnees de test via l'API (services directs ou gateway).
Rend les cas de test auto-suffisants et reproductibles.

Convention : les helpers qui finissent par "_api" passent par la gateway
(http://localhost:3000) et respectent les regles d'auth (role, token, ...).
Les anciens helpers (creer_cours, mettre_places_a_zero, ...) attaquent directement
les services (ports 3001/3002/3003) : utiles pour setup/cleanup rapides.
"""
import requests
from config import (
    COURSES_URL, ENROLLMENTS_URL, GATEWAY_URL,
    ETUDIANT_ID,
)


# ============ Legacy helpers (services directs — pas d'auth) ============

def creer_cours(titre, capacite):
    r = requests.post(f"{COURSES_URL}/courses", json={"titre": titre, "capacite": capacite})
    r.raise_for_status()
    return r.json()["id"]


def mettre_places_a_zero(cours_id, capacite):
    """Ramene placesRestantes a 0 (PATCH /courses/:id/seats {delta:-capacite})."""
    r = requests.patch(f"{COURSES_URL}/courses/{cours_id}/seats", json={"delta": -capacite})
    r.raise_for_status()


def creer_inscription(cours_id, etudiant_id=ETUDIANT_ID):
    """Inscrit un etudiant au cours (par defaut Jean Dupont). Retourne l'inscription (ou None)."""
    r = requests.post(
        f"{ENROLLMENTS_URL}/enrollments",
        json={"etudiantId": etudiant_id, "coursId": cours_id},
    )
    if r.status_code // 100 == 2:
        return r.json()
    return None


def supprimer_inscription_direct(inscription_id):
    """Supprime une inscription en appel direct au service (headers ADMIN pour passer le gate)."""
    requests.delete(
        f"{ENROLLMENTS_URL}/enrollments/{inscription_id}",
        headers={"X-User-Id": ETUDIANT_ID, "X-User-Role": "ADMIN"},
    )


def supprimer_cours(cours_id):
    requests.delete(f"{COURSES_URL}/courses/{cours_id}")


# ============ Helpers gateway (JWT, roles respectes) ============

def login_api(email, password):
    """POST /api/auth/login -> {token, user}. Lance en cas d'echec."""
    r = requests.post(f"{GATEWAY_URL}/api/auth/login",
                      json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()


def register_api(nom, prenom, email, telephone, password):
    """POST /api/auth/register -> {token, user}. Lance en cas d'echec."""
    r = requests.post(f"{GATEWAY_URL}/api/auth/register", json={
        "nom": nom, "prenom": prenom, "email": email,
        "telephone": telephone, "password": password,
    })
    r.raise_for_status()
    return r.json()


def inscrire_via_gateway(token, cours_id):
    """POST /api/enrollments avec Bearer -> inscription."""
    r = requests.post(
        f"{GATEWAY_URL}/api/enrollments",
        json={"coursId": cours_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    r.raise_for_status()
    return r.json()


def mes_inscriptions_api(token):
    r = requests.get(
        f"{GATEWAY_URL}/api/enrollments",
        headers={"Authorization": f"Bearer {token}"},
    )
    r.raise_for_status()
    return r.json()


def inscrits_du_cours_api(admin_token, cours_id):
    r = requests.get(
        f"{GATEWAY_URL}/api/enrollments/by-course/{cours_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    r.raise_for_status()
    return r.json()


def supprimer_cours_api_admin(admin_token, cours_id):
    """Cleanup : supprime un cours via la gateway (requiert token ADMIN). Ignore 404."""
    requests.delete(
        f"{GATEWAY_URL}/api/courses/{cours_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
