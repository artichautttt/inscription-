"""
CT5 — Mes inscriptions
Affichage des inscriptions de l'etudiant.
Pre-requis services : enrollments(3003), gateway(3000), front(5173).
"""
import time
from selenium.webdriver.common.by import By
from config import FRONT_URL, JEAN_EMAIL, JEAN_PASSWORD
from pages import AppPage
from conftest import evidence


def test_ct5_mes_inscriptions(driver):
    app = AppPage(driver, FRONT_URL).open()
    app.login(JEAN_EMAIL, JEAN_PASSWORD)
    app.aller_mes_inscriptions()
    time.sleep(1)  # laisse le temps a l'ecran de charger

    cartes = driver.find_elements(By.CSS_SELECTOR, "ul.liste li.carte")
    vide = driver.find_elements(By.CLASS_NAME, "empty-state")
    erreur = driver.find_elements(By.CSS_SELECTOR, ".alert.erreur")

    assert (cartes or vide) and not erreur, "L'ecran Mes inscriptions doit s'afficher sans erreur"

    evidence(driver, "CT5_mes_inscriptions")
