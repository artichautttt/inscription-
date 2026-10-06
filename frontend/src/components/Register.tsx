import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');
  const [password, setPassword] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur('');

    // Validation cote client minimale (le backend valide aussi)
    if (!nom.trim() || !prenom.trim() || !email.trim() || !telephone.trim()) {
      setErreur('Tous les champs sont requis.');
      return;
    }
    if (password.length < 6) {
      setErreur('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }

    setEnCours(true);
    try {
      await register({ nom, prenom, email, telephone, password });
      // Les nouveaux comptes sont ELEVE : on les emmene sur le catalogue.
      navigate('/catalogue', { replace: true });
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="login-wrapper">
      <form className="login-card" onSubmit={soumettre} data-testid="register-form">
        <h2 className="login-title">✨ Créer un compte</h2>
        <p className="login-hint">
          Déjà inscrit ?{' '}
          <Link to="/login" data-testid="to-login-link">Se connecter</Link>
        </p>

        <label>
          Nom
          <input
            type="text"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            required
            data-testid="register-nom"
          />
        </label>

        <label>
          Prénom
          <input
            type="text"
            value={prenom}
            onChange={(e) => setPrenom(e.target.value)}
            required
            data-testid="register-prenom"
          />
        </label>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            data-testid="register-email"
          />
        </label>

        <label>
          Téléphone
          <input
            type="tel"
            value={telephone}
            onChange={(e) => setTelephone(e.target.value)}
            placeholder="+33 6 12 34 56 78"
            required
            data-testid="register-telephone"
          />
        </label>

        <label>
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            data-testid="register-password"
          />
        </label>

        {erreur && (
          <div className="alert erreur" data-testid="register-error">
            <span className="alert-icon">⚠️</span>
            {erreur}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={enCours}
          data-testid="register-submit"
        >
          {enCours ? 'Création…' : 'Créer mon compte'}
        </button>
      </form>
    </div>
  );
}
