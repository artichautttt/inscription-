"""
CT8 — Admin retire un eleve d'un cours.

Scenario :
  1. Pre-conditions (via API) :
     - Un cours "Developpement Cloud {ts}" avec 10 places (admin le cree via gateway).
     - Un eleve "Elena" cree via register (email unique), auto-connectee.
     - Elena s'inscrit au cours (places = 9).
  2. L'admin se connecte via l'IHM, va dans Gestion des cours, ouvre les inscrits
     du cours "Developpement Cloud ...", et clique "Retirer" sur Elena.
  3. Verifie : Elena n'est plus dans les inscrits de ce cours, et le cours est
     revenu a 10 places restantes (place restituee).

Teardown : supprime le cours.
"""
import time
from config import FRONT_URL, ADMIN_EMAIL, ADMIN_PASSWORD
from pages import AppPage
from conftest import evidence
import data_api


def test_ct8_admin_retire_inscrit(driver):
    ts = int(time.time())
    titre = f"Developpement Cloud {ts}"
    capacite = 10

    # --- Setup via API ---
    admin_token = data_api.login_api(ADMIN_EMAIL, ADMIN_PASSWORD)["token"]
    cours_id = data_api.creer_cours(titre, capacite)   # creation directe via service

    elena_email = f"elena.ct8.{ts}@test.com"
    elena = data_api.register_api(
        nom="Eleve Test", prenom="Elena",
        email=elena_email, telephone="+33 6 00 00 00 00",
        password="elena123",
    )
    elena_insc = data_api.inscrire_via_gateway(elena["token"], cours_id)
    assert elena_insc.get("id"), "L'inscription d'Elena devrait avoir un id"

    try:
        app = AppPage(driver, FRONT_URL).open()
        app.login(ADMIN_EMAIL, ADMIN_PASSWORD)
        app.aller_admin()

        # Ouvre le panel des inscrits pour ce cours
        app.admin_ouvrir_inscrits(titre)

        # Verifie qu'Elena est bien visible AVANT retrait
        inscrits_avant = app.admin_lire_inscrits(cours_id)
        emails_avant = [i["email"] for i in inscrits_avant]
        assert elena_email in emails_avant, (
            f"Elena ({elena_email}) devrait etre dans les inscrits ; vu : {emails_avant}"
        )

        # Retire Elena via l'IHM
        app.admin_retirer_inscrit(elena_insc["id"])

        # Attente du refresh et verification APRES retrait
        def elena_disparue(_):
            apres = app.admin_lire_inscrits(cours_id)
            return elena_email not in [i["email"] for i in apres]

        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(driver, 10).until(elena_disparue)

        # Verifie la restitution de place via l'API (source de verite)
        apres_courses = data_api.inscrits_du_cours_api(admin_token, cours_id)
        assert elena_email not in [i["etudiantEmail"] for i in apres_courses], \
            "Elena ne devrait plus etre inscrite au cours (API)."

        import requests
        from config import COURSES_URL
        cours = requests.get(f"{COURSES_URL}/courses/{cours_id}").json()
        assert cours["placesRestantes"] == capacite, (
            f"Place devrait etre restituee a {capacite} ; vu : {cours['placesRestantes']}"
        )

        evidence(driver, "CT8_admin_retire_inscrit")
    finally:
        data_api.supprimer_cours_api_admin(admin_token, cours_id)
