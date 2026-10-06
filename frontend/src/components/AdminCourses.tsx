import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Cours, InscriptionAvecEtudiant } from '../types';
import {
  createCourse,
  deleteCourse,
  deleteEnrollment,
  getCourses,
  getEnrollmentsByCourse,
  updateCourse,
} from '../api';

export default function AdminCourses() {
  const [cours, setCours] = useState<Cours[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  // Formulaire création
  const [newTitre, setNewTitre] = useState('');
  const [newCapacite, setNewCapacite] = useState<number>(10);

  // Formulaire édition
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitre, setEditTitre] = useState('');
  const [editCapacite, setEditCapacite] = useState<number>(0);

  // "Voir inscrits" : état par cours (chargement + données + erreur)
  const [inscritsByCourse, setInscritsByCourse] =
    useState<Record<string, { loading: boolean; data?: InscriptionAvecEtudiant[]; erreur?: string }>>({});

  function recharger() {
    setChargement(true);
    getCourses()
      .then(setCours)
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }
  useEffect(() => { recharger(); }, []);

  async function creer(e: FormEvent) {
    e.preventDefault();
    setErreur(''); setMessage('');
    try {
      await createCourse({ titre: newTitre, capacite: Number(newCapacite) });
      setMessage(`Cours "${newTitre}" créé.`);
      setNewTitre(''); setNewCapacite(10);
      recharger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  function ouvrirEdition(c: Cours) {
    setEditId(c.id);
    setEditTitre(c.titre);
    setEditCapacite(c.capacite);
  }

  async function enregistrerEdition(e: FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setErreur(''); setMessage('');
    try {
      await updateCourse(editId, { titre: editTitre, capacite: Number(editCapacite) });
      setMessage('Cours mis à jour.');
      setEditId(null);
      recharger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function supprimer(id: string, titre: string) {
    if (!window.confirm(`Supprimer le cours "${titre}" ?`)) return;
    setErreur(''); setMessage('');
    try {
      await deleteCourse(id);
      setMessage(`Cours "${titre}" supprimé.`);
      recharger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function retirerInscrit(coursId: string, inscriptionId: string, nomAffiche: string) {
    if (!window.confirm(`Retirer ${nomAffiche} de ce cours ?`)) return;
    setErreur(''); setMessage('');
    try {
      await deleteEnrollment(inscriptionId);
      setMessage(`${nomAffiche} a été retiré du cours.`);
      // Rafraîchir le panel + la liste de cours (places restituées)
      const inscrits = await getEnrollmentsByCourse(coursId);
      setInscritsByCourse((s) => ({ ...s, [coursId]: { loading: false, data: inscrits } }));
      recharger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function toggleInscrits(coursId: string) {
    const current = inscritsByCourse[coursId];
    // Si deja affiche -> on masque
    if (current?.data) {
      setInscritsByCourse((s) => ({ ...s, [coursId]: { ...current, data: undefined } }));
      return;
    }
    setInscritsByCourse((s) => ({ ...s, [coursId]: { loading: true } }));
    try {
      const inscrits = await getEnrollmentsByCourse(coursId);
      setInscritsByCourse((s) => ({ ...s, [coursId]: { loading: false, data: inscrits } }));
    } catch (err) {
      setInscritsByCourse((s) => ({
        ...s,
        [coursId]: { loading: false, erreur: (err as Error).message },
      }));
    }
  }

  return (
    <div data-testid="admin-courses">
      <h2 className="section-title">
        <span className="title-icon">🛠️</span>
        Gestion des cours
        {cours.length > 0 && <span className="badge">{cours.length}</span>}
      </h2>

      {message && (
        <div className="alert ok" data-testid="admin-success">
          <span className="alert-icon">✅</span>{message}
        </div>
      )}
      {erreur && (
        <div className="alert erreur" data-testid="admin-error">
          <span className="alert-icon">⚠️</span>{erreur}
        </div>
      )}

      {/* Création */}
      <form className="admin-form" onSubmit={creer} data-testid="create-course-form">
        <h3>➕ Nouveau cours</h3>
        <div className="admin-form-row">
          <input
            type="text"
            placeholder="Titre du cours"
            value={newTitre}
            onChange={(e) => setNewTitre(e.target.value)}
            required
            data-testid="new-course-titre"
          />
          <input
            type="number"
            min={1}
            placeholder="Capacité"
            value={newCapacite}
            onChange={(e) => setNewCapacite(Number(e.target.value))}
            required
            data-testid="new-course-capacite"
          />
          <button type="submit" className="btn btn-primary" data-testid="create-course-submit">
            Créer
          </button>
        </div>
      </form>

      {/* Liste */}
      {chargement ? (
        <p>Chargement…</p>
      ) : cours.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <p>Aucun cours — crée-en un ci-dessus.</p>
        </div>
      ) : (
        <ul className="liste">
          {cours.map((c) => (
            <li key={c.id} className="carte" data-testid={`admin-course-${c.id}`}>
              {editId === c.id ? (
                <form className="admin-form-row" onSubmit={enregistrerEdition} style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={editTitre}
                    onChange={(e) => setEditTitre(e.target.value)}
                    required
                    data-testid={`edit-titre-${c.id}`}
                  />
                  <input
                    type="number"
                    min={0}
                    value={editCapacite}
                    onChange={(e) => setEditCapacite(Number(e.target.value))}
                    required
                    data-testid={`edit-capacite-${c.id}`}
                  />
                  <button type="submit" className="btn btn-primary" data-testid={`save-edit-${c.id}`}>
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setEditId(null)}
                    data-testid={`cancel-edit-${c.id}`}
                  >
                    Annuler
                  </button>
                </form>
              ) : (
                <>
                  <div className="admin-course-row">
                    <div className="carte-info">
                      <span className="carte-titre">{c.titre}</span>
                      <span className="carte-meta">
                        {c.placesRestantes} / {c.capacite} places
                      </span>
                    </div>
                    <div className="carte-actions">
                      <button
                        className="btn btn-ghost"
                        onClick={() => toggleInscrits(c.id)}
                        data-testid={`voir-inscrits-btn-${c.id}`}
                      >
                        {inscritsByCourse[c.id]?.data ? 'Masquer' : 'Voir inscrits'}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => ouvrirEdition(c)}
                        data-testid={`edit-btn-${c.id}`}
                      >
                        Modifier
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => supprimer(c.id, c.titre)}
                        data-testid={`delete-btn-${c.id}`}
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>

                  {inscritsByCourse[c.id] && (
                    <div className="inscrits-panel" data-testid={`inscrits-panel-${c.id}`}>
                      {inscritsByCourse[c.id].loading && <p>Chargement des inscrits…</p>}
                      {inscritsByCourse[c.id].erreur && (
                        <div className="alert erreur">{inscritsByCourse[c.id].erreur}</div>
                      )}
                      {inscritsByCourse[c.id].data && (
                        inscritsByCourse[c.id].data!.length === 0 ? (
                          <p className="inscrits-empty" data-testid={`inscrits-vide-${c.id}`}>
                            Aucun élève inscrit à ce cours.
                          </p>
                        ) : (
                          <ul className="inscrits-liste">
                            {inscritsByCourse[c.id].data!.map((ins) => {
                              const nomComplet = [ins.etudiantPrenom, ins.etudiantNom]
                                .filter(Boolean)
                                .join(' ') || ins.etudiantNom;
                              return (
                                <li
                                  key={ins.id}
                                  className="inscrit-row"
                                  data-testid={`inscrit-${ins.id}`}
                                >
                                  <span
                                    className="inscrit-nom"
                                    data-testid={`inscrit-nom-${ins.id}`}
                                  >
                                    {nomComplet}
                                  </span>
                                  <span
                                    className="inscrit-email"
                                    data-testid={`inscrit-email-${ins.id}`}
                                  >
                                    {ins.etudiantEmail}
                                  </span>
                                  {ins.etudiantTelephone && (
                                    <span
                                      className="inscrit-tel"
                                      data-testid={`inscrit-telephone-${ins.id}`}
                                    >
                                      📞 {ins.etudiantTelephone}
                                    </span>
                                  )}
                                  <button
                                    className="btn btn-danger btn-xs"
                                    onClick={() => retirerInscrit(c.id, ins.id, nomComplet)}
                                    data-testid={`retirer-inscrit-btn-${ins.id}`}
                                  >
                                    Retirer
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
