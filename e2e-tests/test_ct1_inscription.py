"""
CT1 — Inscription reussie (cas nominal)
Regle : places > 0, etudiant + cours existent, pas de doublon.
Pre-requis services : students(3001), courses(3002), enrollments(3003), gateway(3000), front(5173).
"""
import time
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct1_inscription_reussie(driver):
    titre = f"CT1 Nominal {int(time.time())}"
    cours_id = data_api.creer_cours(titre, 10)
    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(JEAN_EMAIL, JEAN_PASSWORD)
        app.aller_catalogue()

        app.sinscrire(titre)

        msg = app.message_succes()
        assert "réussi" in msg.lower(), f"Message inattendu : {msg!r}"

        evidence(driver, "CT1_inscription")
    finally:
        data_api.supprimer_cours(cours_id)
