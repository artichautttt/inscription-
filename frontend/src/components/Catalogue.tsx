import { useEffect, useState } from 'react';
import type { Cours } from '../types';
import { getCourses, createEnrollment } from '../api';
import { ETUDIANT_ID } from '../App';

/**
 * ============ EXEMPLE DE RÉFÉRENCE (déjà codé) ============
 * Affiche le catalogue des cours et permet de s'inscrire.
 * Montre les 3 états à gérer : chargement, erreur, données.
 */
export default function Catalogue() {
  const [cours, setCours] = useState<Cours[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  // Charge le catalogue au premier affichage du composant.
  useEffect(() => {
    getCourses()
      .then((data) => setCours(data))
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, []);

  // Action du bouton "S'inscrire".
  async function sInscrire(coursId: string) {
    setMessage('');
    setErreur('');
    try {
      await createEnrollment(ETUDIANT_ID, coursId);
      setMessage('Inscription réussie !');
      // Recharge le catalogue pour rafraîchir les places restantes.
      setCours(await getCourses());
    } catch (e) {
      // Affiche le message d'erreur métier (cours complet, déjà inscrit...).
      setErreur((e as Error).message);
    }
  }

  if (chargement) return <p>Chargement du catalogue…</p>;

  return (
    <div>
      <h2>Catalogue</h2>
      {message && <p className="ok">{message}</p>}
      {erreur && <p className="erreur">{erreur}</p>}

      <ul className="liste">
        {cours.map((c) => (
          <li key={c.id} className="carte">
            <div>
              <strong>{c.titre}</strong>
              <br />
              <span>{c.placesRestantes} / {c.capacite} places</span>
            </div>
            <button
              disabled={c.placesRestantes <= 0}
              onClick={() => sInscrire(c.id)}
            >
              {c.placesRestantes <= 0 ? 'Complet' : "S'inscrire"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
