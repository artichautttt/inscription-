import { useEffect, useState } from 'react';
import type { Cours } from '../types';
import { getCourses, createEnrollment } from '../api';
import { useAuth } from '../auth/AuthContext';

function placesLevel(restantes: number, capacite: number): 'high' | 'medium' | 'low' {
  const ratio = restantes / capacite;
  if (ratio > 0.5) return 'high';
  if (ratio > 0.2) return 'medium';
  return 'low';
}

export default function Catalogue() {
  const { user } = useAuth();
  const [cours, setCours] = useState<Cours[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    getCourses()
      .then((data) => setCours(data))
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, []);

  async function sInscrire(coursId: string) {
    setMessage('');
    setErreur('');
    try {
      await createEnrollment(coursId);
      setMessage('Inscription réussie !');
      setCours(await getCourses());
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  if (chargement) {
    return (
      <div>
        <h2 className="section-title">
          <span className="title-icon">📚</span>Catalogue des cours
        </h2>
        <div className="loading-container">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-card">
              <div>
                <div className="skeleton-text wide" />
                <div className="skeleton-text medium" />
              </div>
              <div className="skeleton-text narrow" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const peutSInscrire = user?.role === 'ELEVE';

  return (
    <div data-testid="catalogue">
      <h2 className="section-title">
        <span className="title-icon">📚</span>
        Catalogue des cours
        {cours.length > 0 && <span className="badge">{cours.length}</span>}
      </h2>

      {message && (
        <div className="alert ok" data-testid="catalogue-success">
          <span className="alert-icon">✅</span>{message}
        </div>
      )}
      {erreur && (
        <div className="alert erreur" data-testid="catalogue-error">
          <span className="alert-icon">⚠️</span>{erreur}
        </div>
      )}

      {cours.length === 0 && !erreur ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <p>Aucun cours disponible pour le moment.</p>
        </div>
      ) : (
        <ul className="liste">
          {cours.map((c) => {
            const level = placesLevel(c.placesRestantes, c.capacite);
            const pct = (c.placesRestantes / c.capacite) * 100;

            return (
              <li
                key={c.id}
                className="carte"
                data-testid={`course-card-${c.id}`}
                data-course-titre={c.titre}
              >
                <div className="carte-info">
                  <span className="carte-titre">{c.titre}</span>
                  <div className="places-indicator">
                    <div className="places-bar">
                      <div
                        className={`places-bar-fill ${level}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="places-text">
                      {c.placesRestantes} / {c.capacite} places
                    </span>
                  </div>
                </div>
                {peutSInscrire && (
                  <button
                    className="btn btn-primary"
                    disabled={c.placesRestantes <= 0}
                    onClick={() => sInscrire(c.id)}
                    data-testid={`inscrire-btn-${c.id}`}
                  >
                    {c.placesRestantes <= 0 ? '🚫 Complet' : "✨ S'inscrire"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
