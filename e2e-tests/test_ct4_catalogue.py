"""
CT4 — Consultation du catalogue
--------------------------------
Niveau      : test systeme / bout-en-bout (E2E)
Technique   : test fonctionnel
Regle testee: affichage du catalogue (front -> gateway -> service Cours)
Pre-condition : l'application tourne (front 5173, gateway 3000, courses 3002)
                et au moins un cours existe en base. Connexion requise (jalon 3).
"""
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence


def test_ct4_catalogue_affiche_les_cours(driver):
    app = AppPage(driver, FRONT_URL).open()
    app.login(JEAN_EMAIL, JEAN_PASSWORD)
    app.aller_catalogue()

    titres = app.titres_cours()
    assert len(titres) > 0, (
        "Le catalogue devrait afficher au moins un cours. "
        "Verifie que front(5173), gateway(3000) et courses(3002) tournent."
    )

    for titre in titres:
        assert titre != "", "Un cours a un titre vide"
        assert "places" in app.places_text(titre), f"Places manquantes pour '{titre}'"

    evidence(driver, "CT4_catalogue")
