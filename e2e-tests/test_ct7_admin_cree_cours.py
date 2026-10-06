"""
CT7 — Admin ajoute un cours.

Scenario :
  1. L'admin seede se connecte.
  2. Dans "Gestion des cours", il cree un cours ("Cybersecurite (test) {ts}") avec 20 places.
  3. Verifie : le cours apparait dans la liste admin ET dans le catalogue, avec 20 places.

Teardown : l'admin supprime le cours cree (via API) pour rester rejouable.
"""
import time
from config import FRONT_URL, ADMIN_EMAIL, ADMIN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct7_admin_cree_cours(driver):
    ts = int(time.time())
    titre = f"Cybersecurite (test) {ts}"
    capacite = 20

    admin_token = data_api.login_api(ADMIN_EMAIL, ADMIN_PASSWORD)["token"]
    cours_id_a_nettoyer = None

    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(ADMIN_EMAIL, ADMIN_PASSWORD)
        app.aller_admin()

        app.admin_creer_cours(titre, capacite)

        # Verifie que le cours apparait dans la vue admin
        cours_id_a_nettoyer = app.admin_cours_id_par_titre(titre)
        assert cours_id_a_nettoyer, "Le cours vient d'etre cree ; son UUID devrait etre lisible"

        # Verifie dans le catalogue : titre present et 20/20 places
        app.aller_catalogue()
        titres = app.titres_cours()
        assert titre in titres, f"Catalogue devrait contenir '{titre}' ; vu : {titres}"
        places = app.places_text(titre)
        assert "20 / 20" in places or "20/20" in places, (
            f"Attendu '20 / 20 places' pour {titre!r}, vu : {places!r}"
        )

        evidence(driver, "CT7_admin_cree_cours")
    finally:
        if cours_id_a_nettoyer:
            data_api.supprimer_cours_api_admin(admin_token, cours_id_a_nettoyer)
