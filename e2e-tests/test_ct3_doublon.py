"""
CT3 — Doublon (deja inscrit)
Regle : pas de doublon (meme etudiant + meme cours).
Pre-requis services : students(3001), courses(3002), enrollments(3003), gateway(3000), front(5173).
"""
import time
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct3_doublon(driver):
    titre = f"CT3 Doublon {int(time.time())}"
    cours_id = data_api.creer_cours(titre, 10)
    insc = data_api.creer_inscription(cours_id)   # 1ere inscription via API pour Jean
    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(JEAN_EMAIL, JEAN_PASSWORD)
        app.aller_catalogue()

        app.sinscrire(titre)                      # 2e tentative via l'IHM

        msg = app.message_erreur()
        assert msg != "", "Un message d'erreur (doublon) devrait apparaitre"

        evidence(driver, "CT3_doublon")
    finally:
        if insc:
            data_api.supprimer_inscription_direct(insc["id"])
        data_api.supprimer_cours(cours_id)
