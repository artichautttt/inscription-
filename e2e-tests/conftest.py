"""Fixtures pytest partagees : navigateur Selenium, pause entre tests, capture d'ecran.

Navigateur par defaut : Microsoft Edge (toujours present sur Windows).
Pour Chrome, voir le commentaire dans la fixture `driver`.
"""
import os
import datetime
import time
import pytest
from selenium import webdriver
from selenium.webdriver.edge.options import Options as EdgeOptions

# ====== Pause entre les tests (pour pouvoir suivre a l'oeil) ======
# Passe a 0 pour les runs CI, 2-3 secondes pour une demo visuelle.
PAUSE_ENTRE_TESTS = 2

SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Attache le resultat de chaque phase au noeud de test (pour la capture)."""
    outcome = yield
    rep = outcome.get_result()
    setattr(item, "rep_" + rep.when, rep)


@pytest.fixture
def driver(request):
    """Ouvre un navigateur avant le test, le ferme apres.
    Capture l'ecran automatiquement si le test echoue (evidence de test)."""
    options = EdgeOptions()
    options.add_argument("--window-size=1280,900")
    # Headless activable via la variable d'env E2E_HEADLESS=1
    import os as _os
    if _os.environ.get("E2E_HEADLESS") == "1":
        options.add_argument("--headless=new")

    drv = webdriver.Edge(options=options)
    # --- Pour Chrome a la place d'Edge, remplace les 2 lignes ci-dessus par :
    # from selenium.webdriver.chrome.options import Options as ChromeOptions
    # options = ChromeOptions(); options.add_argument("--window-size=1280,900")
    # drv = webdriver.Chrome(options=options)

    drv.implicitly_wait(5)
    yield drv

    rep = getattr(request.node, "rep_call", None)
    if rep is not None and rep.failed:
        os.makedirs(SCREENSHOT_DIR, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        drv.save_screenshot(os.path.join(SCREENSHOT_DIR, f"ECHEC_{request.node.name}_{ts}.png"))

    drv.quit()


@pytest.fixture(autouse=True)
def pause_apres_test():
    """Pause configurable APRES chaque test, pour pouvoir observer visuellement."""
    yield
    if PAUSE_ENTRE_TESTS > 0:
        time.sleep(PAUSE_ENTRE_TESTS)


def evidence(driver, nom):
    """Enregistre une capture d'ecran de preuve (a appeler dans un test qui passe)."""
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    driver.save_screenshot(os.path.join(SCREENSHOT_DIR, f"{nom}_{ts}.png"))
