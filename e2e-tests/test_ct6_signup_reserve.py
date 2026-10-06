"""
CT6 — Nouvel etudiant : sign-up puis reservation d'un cours.

Scenario :
  1. Pre-condition : un cours "CT6 Reservation xxx" avec des places (via API).
  2. Nouvel etudiant : ouvre /login, clique "S'inscrire", remplit le formulaire,
     soumet -> connecte automatiquement.
  3. Reserve le cours via l'IHM (bouton S'inscrire).
  4. Verifie : message de succes + la reservation apparait dans "Mes inscriptions"
     avec le NOM du cours (pas l'UUID).

Teardown : supprime le cours (ce qui orpheline l'inscription — Jalon 3 affiche
"Cours supprime" dans Mes inscriptions pour les occurrences restantes).
"""
import time
from config import FRONT_URL
from pages import AppPage
from conftest import evidence
import data_api


def test_ct6_signup_puis_reservation(driver):
    ts = int(time.time())
    titre = f"CT6 Reservation {ts}"
    cours_id = data_api.creer_cours(titre, 15)

    email = f"ct6.nouveau.{ts}@test.com"
    nom = "Testeur"
    prenom = "Nouveau"
    telephone = "+33 6 00 00 00 00"
    password = "secret123"

    try:
        app = AppPage(driver, FRONT_URL).open()
        app.creer_compte(nom, prenom, email, telephone, password)

        # Verifie que l'auto-connexion a bien eu lieu : le header affiche le nom
        affiche = app.nom_utilisateur_affiche()
        assert prenom in affiche or nom in affiche, (
            f"Header ne contient ni '{prenom}' ni '{nom}' : {affiche!r}"
        )

        app.aller_catalogue()
        app.sinscrire(titre)

        msg = app.message_succes()
        assert "réussi" in msg.lower(), f"Message succes attendu, obtenu : {msg!r}"

        # Verifie que la reservation apparait dans "Mes inscriptions" avec le titre du cours
        app.aller_mes_inscriptions()
        libs = app.titres_mes_inscriptions()
        assert any(titre in lib for lib in libs), (
            f"Le cours '{titre}' devrait apparaitre dans Mes inscriptions ; vu : {libs}"
        )

        evidence(driver, "CT6_signup_reservation")
    finally:
        # Cleanup : supprime le cours (l'inscription orpheline sera auto-affichee
        # comme "Cours supprime" lors d'un prochain affichage).
        data_api.supprimer_cours(cours_id)
