"""Page Object Model : centralise les selecteurs de l'IHM.

Prioritaire : selecteurs par data-testid (plus stables que CSS/XPath sur du contenu).
Pour les parties de catalogue (lecture via JS), on garde les selecteurs CSS existants
car ces elements sont rendus dynamiquement et portent deja une structure propre.

Slow-mo : une pause configurable (`config.SLOWMO_SECONDES`) est appliquee APRES
chaque action UI significative (clic, saisie, navigation) via _slow(), pour pouvoir
observer visuellement chaque etape pendant une demo. 0 = desactive.
"""
import time
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from config import SLOWMO_SECONDES


def _slow():
    """Pause APRES une action UI significative (demo pas-a-pas). Configurable
    via `config.SLOWMO_SECONDES` ou la variable d'env `E2E_SLOWMO`."""
    if SLOWMO_SECONDES > 0:
        time.sleep(SLOWMO_SECONDES)


class AppPage:
    def __init__(self, driver, base_url):
        self.driver = driver
        self.base_url = base_url

    # ---- Navigation ----
    def open(self):
        self.driver.get(self.base_url)
        _slow()
        return self

    def goto(self, path):
        self.driver.get(f"{self.base_url}{path}")
        _slow()
        return self

    # ---- Authentification ----
    def login(self, email, password, timeout=10):
        """Si pas deja sur /login, y va. Remplit, soumet, attend d'etre connecte."""
        if "/login" not in self.driver.current_url:
            self.goto("/login")
        self._attendre_tid("login-form", timeout)
        self._remplir_tid("email-input", email)
        self._remplir_tid("password-input", password)
        self._cliquer_tid("login-submit")
        self._attendre_tid("user-area", timeout)
        return self

    def logout(self, timeout=10):
        self._cliquer_tid("logout-btn")
        WebDriverWait(self.driver, timeout).until(EC.url_contains("/login"))
        return self

    def creer_compte(self, nom, prenom, email, telephone, password, timeout=10):
        """Depuis /login : clique le lien 'S'inscrire', remplit, submit, attend connexion."""
        if "/register" not in self.driver.current_url:
            if "/login" not in self.driver.current_url:
                self.goto("/login")
            self._attendre_tid("to-register-link", timeout).click()
        self._attendre_tid("register-form", timeout)
        self._remplir_tid("register-nom", nom)
        self._remplir_tid("register-prenom", prenom)
        self._remplir_tid("register-email", email)
        self._remplir_tid("register-telephone", telephone)
        self._remplir_tid("register-password", password)
        self._cliquer_tid("register-submit")
        self._attendre_tid("user-area", timeout)
        return self

    def nom_utilisateur_affiche(self):
        return (self._attendre_tid("user-name").text or "").strip()

    # ---- Catalogue (vue ELEVE/ADMIN) ----
    def aller_catalogue(self, timeout=10):
        self._cliquer_tid("nav-catalogue")
        self.attendre_catalogue(timeout)
        return self

    def aller_mes_inscriptions(self, timeout=10):
        self._cliquer_tid("nav-mes-inscriptions")
        self._attendre_tid("mes-inscriptions", timeout)
        return self

    def aller_admin(self, timeout=10):
        self._cliquer_tid("nav-admin")
        self._attendre_tid("admin-courses", timeout)
        return self

    def attendre_catalogue(self, timeout=10):
        """Attend que les cartes soient chargees ET leurs titres remplis
        (ou l'etat vide, ou une alerte d'erreur)."""
        WebDriverWait(self.driver, timeout).until(lambda d: d.execute_script("""
            if (document.querySelector('.empty-state') || document.querySelector('.alert.erreur')) return true;
            const titres = Array.from(document.querySelectorAll('ul.liste li.carte .carte-titre'));
            return titres.length > 0 && titres.every(e => (e.textContent || '').trim() !== '');
        """))

    def titres_cours(self):
        return self.driver.execute_script("""
            return Array.from(document.querySelectorAll('ul.liste li.carte .carte-titre'))
                        .map(e => (e.textContent || '').trim());
        """)

    def places_text(self, titre):
        return self.driver.execute_script("""
            const t = arguments[0];
            const card = Array.from(document.querySelectorAll('ul.liste li.carte')).find(li => {
                const el = li.querySelector('.carte-titre');
                return el && (el.textContent || '').trim() === t;
            });
            return card ? (card.querySelector('.places-text').textContent || '').trim() : '';
        """, titre)

    def carte(self, titre):
        return self.driver.find_element(
            By.XPATH,
            f"//li[contains(@class,'carte')]"
            f"[.//span[@class='carte-titre' and normalize-space(text())={_xpath_literal(titre)}]]",
        )

    def bouton_inscrire(self, titre):
        """Bouton 'S'inscrire' pour un cours donne (visible seulement en role ELEVE)."""
        return self.carte(titre).find_element(By.TAG_NAME, "button")

    def sinscrire(self, titre):
        self.bouton_inscrire(titre).click()
        _slow()

    def message_succes(self, timeout=10):
        WebDriverWait(self.driver, timeout).until(
            lambda d: d.find_elements(By.CSS_SELECTOR, ".alert.ok")
        )
        return self.driver.execute_script(
            "const e=document.querySelector('.alert.ok'); return e ? (e.textContent||'').trim() : '';"
        )

    def message_erreur(self, timeout=10):
        WebDriverWait(self.driver, timeout).until(
            lambda d: d.find_elements(By.CSS_SELECTOR, ".alert.erreur")
        )
        return self.driver.execute_script(
            "const e=document.querySelector('.alert.erreur'); return e ? (e.textContent||'').trim() : '';"
        )

    # ---- Mes inscriptions ----
    def titres_mes_inscriptions(self):
        """Retourne la liste des libelles de cours (coursTitre) affiches dans Mes inscriptions."""
        return self.driver.execute_script("""
            return Array.from(document.querySelectorAll('[data-testid^="inscription-cours-titre-"]'))
                        .map(e => (e.textContent || '').trim());
        """)

    # ---- Admin : creation / lecture / retrait ----
    def admin_creer_cours(self, titre, capacite):
        self._attendre_tid("admin-courses")
        self._remplir_tid("new-course-titre", titre)
        self._remplir_tid("new-course-capacite", str(capacite))
        self._cliquer_tid("create-course-submit")

    def admin_card_par_titre(self, titre, timeout=10):
        """Attend puis retourne le <li> admin dont le titre correspond."""
        xpath = (
            "//li[contains(@class,'carte') and @data-testid[starts-with(., 'admin-course-')]]"
            f"[.//span[@class='carte-titre' and normalize-space(text())={_xpath_literal(titre)}]]"
        )
        WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((By.XPATH, xpath))
        )
        return self.driver.find_element(By.XPATH, xpath)

    def admin_cours_id_par_titre(self, titre, timeout=10):
        card = self.admin_card_par_titre(titre, timeout)
        tid = card.get_attribute("data-testid") or ""
        # format: admin-course-<uuid>
        return tid[len("admin-course-"):]

    def admin_ouvrir_inscrits(self, titre, timeout=10):
        cours_id = self.admin_cours_id_par_titre(titre, timeout)
        self._cliquer_tid(f"voir-inscrits-btn-{cours_id}")
        # Attendre que le panel soit present
        WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, f'[data-testid="inscrits-panel-{cours_id}"]'))
        )
        return cours_id

    def admin_lire_inscrits(self, cours_id, timeout=10):
        """Retourne [{nom, email}, ...] pour le panel ouvert d'un cours."""
        # Attendre soit la liste, soit l'etat vide
        WebDriverWait(self.driver, timeout).until(lambda d: d.execute_script(f"""
            const p = document.querySelector('[data-testid="inscrits-panel-{cours_id}"]');
            if (!p) return false;
            return p.querySelector('li[data-testid^="inscrit-"]')
                 || p.querySelector('[data-testid="inscrits-vide-{cours_id}"]');
        """))
        return self.driver.execute_script(f"""
            const p = document.querySelector('[data-testid="inscrits-panel-{cours_id}"]');
            if (!p) return [];
            return Array.from(p.querySelectorAll('li[data-testid^="inscrit-"]')).map(li => {{
                const nom = li.querySelector('.inscrit-nom');
                const email = li.querySelector('.inscrit-email');
                return {{
                    nom: nom ? (nom.textContent || '').trim() : '',
                    email: email ? (email.textContent || '').trim() : '',
                }};
            }});
        """)

    def admin_retirer_inscrit(self, inscription_id):
        """Clique 'Retirer' pour une inscription donnee (bypass du window.confirm)."""
        # Court-circuite la confirmation navigateur
        self.driver.execute_script("window.confirm = () => true;")
        self._cliquer_tid(f"retirer-inscrit-btn-{inscription_id}")

    def admin_supprimer_cours(self, titre, timeout=10):
        cours_id = self.admin_cours_id_par_titre(titre, timeout)
        self.driver.execute_script("window.confirm = () => true;")
        self._cliquer_tid(f"delete-btn-{cours_id}")

    # ---- Primitives data-testid ----
    def _tid(self, tid):
        return self.driver.find_element(By.CSS_SELECTOR, f'[data-testid="{tid}"]')

    def _attendre_tid(self, tid, timeout=10):
        return WebDriverWait(self.driver, timeout).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, f'[data-testid="{tid}"]'))
        )

    def _cliquer_tid(self, tid, timeout=10):
        el = WebDriverWait(self.driver, timeout).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, f'[data-testid="{tid}"]'))
        )
        el.click()
        _slow()

    def _remplir_tid(self, tid, valeur):
        el = self._attendre_tid(tid)
        el.clear()
        el.send_keys(valeur)
        _slow()


def _xpath_literal(s):
    if "'" not in s:
        return f"'{s}'"
    if '"' not in s:
        return f'"{s}"'
    parts = s.split("'")
    return "concat('" + "', \"'\", '".join(parts) + "')"
