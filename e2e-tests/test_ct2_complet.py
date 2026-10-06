"""
CT2 — Cours complet (valeur limite : placesRestantes = 0)
Regle : il doit rester des places.
Pre-requis services : courses(3002), gateway(3000), front(5173).
"""
import time
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct2_cours_complet(driver):
    titre = f"CT2 Complet {int(time.time())}"
    cours_id = data_api.creer_cours(titre, 5)
    data_api.mettre_places_a_zero(cours_id, 5)
    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(JEAN_EMAIL, JEAN_PASSWORD)
        app.aller_catalogue()

        bouton = app.bouton_inscrire(titre)
        assert not bouton.is_enabled(), "Le bouton devrait etre desactive (cours complet)"
        assert "Complet" in (bouton.get_attribute("textContent") or "")

        evidence(driver, "CT2_complet")
    finally:
        data_api.supprimer_cours(cours_id)
