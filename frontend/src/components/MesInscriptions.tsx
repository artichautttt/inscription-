import { useEffect, useState } from 'react';
import type { Inscription } from '../types';
import { deleteEnrollment, getMyEnrollments } from '../api';

function statutBadge(statut: string): { cls: string; label: string } {
  const s = statut.toLowerCase();
  if (s === 'confirmée' || s === 'confirmee' || s === 'confirmed')
    return { cls: 'confirmed', label: statut };
  if (s === 'en attente' || s === 'pending')
    return { cls: 'pending', label: statut };
  return { cls: 'default', label: statut };
}

export default function MesInscriptions() {
  const [items, setItems] = useState<Inscription[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  function recharger() {
    setChargement(true);
    getMyEnrollments()
      .then((data) => setItems(data))
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => { recharger(); }, []);

  async function annuler(id: string) {
    setMessage('');
    setErreur('');
    try {
      await deleteEnrollment(id);
      setMessage('Inscription annulée.');
      recharger();
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  if (chargement) {
    return (
      <div>
        <h2 className="section-title">
          <span className="title-icon">📋</span>Mes inscriptions
        </h2>
        <div className="loading-container">
          {[1, 2].map((i) => (
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

  return (
    <div data-testid="mes-inscriptions">
      <h2 className="section-title">
        <span className="title-icon">📋</span>
        Mes inscriptions
        {items.length > 0 && <span className="badge">{items.length}</span>}
      </h2>

      {message && (
        <div className="alert ok" data-testid="mes-inscriptions-success">
          <span className="alert-icon">✅</span>{message}
        </div>
      )}
      {erreur && (
        <div className="alert erreur" data-testid="mes-inscriptions-error">
          <span className="alert-icon">⚠️</span>{erreur}
        </div>
      )}

      {items.length === 0 && !erreur ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <p>Aucune inscription pour le moment.</p>
        </div>
      ) : (
        <ul className="liste">
          {items.map((i) => {
            const { cls, label } = statutBadge(i.statut);
            return (
              <li
                key={i.id}
                className="carte"
                data-testid={`inscription-card-${i.id}`}
                data-cours-id={i.coursId}
              >
                <div className="carte-info">
                  <span
                    className="carte-titre"
                    data-testid={`inscription-cours-titre-${i.id}`}
                  >
                    📖 {i.coursTitre ?? i.coursId}
                  </span>
                  <span className="carte-meta">
                    <span className="meta-icon">📅</span>
                    Le {new Date(i.date).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <div className="carte-actions">
                  <span className={`status-badge ${cls}`}>{label}</span>
                  <button
                    className="btn btn-danger"
                    onClick={() => annuler(i.id)}
                    data-testid={`annuler-btn-${i.id}`}
                  >
                    Annuler
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
