import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    setEnCours(true);
    try {
      const u = await login(email, password);
      // ADMIN atterrit sur /admin, ELEVE sur /catalogue
      navigate(u.role === 'ADMIN' ? '/admin' : '/catalogue', { replace: true });
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="login-wrapper">
      <form className="login-card" onSubmit={soumettre} data-testid="login-form">
        <h2 className="login-title">🔐 Connexion</h2>
        <p className="login-hint">Comptes de test : <code>admin@test.com / admin123</code> ou <code>eleve@test.com / eleve123</code></p>
        <p className="login-hint">
          Pas de compte ?{' '}
          <Link to="/register" data-testid="to-register-link">S'inscrire</Link>
        </p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            data-testid="email-input"
          />
        </label>

        <label>
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            data-testid="password-input"
          />
        </label>

        {erreur && (
          <div className="alert erreur" data-testid="login-error">
            <span className="alert-icon">⚠️</span>
            {erreur}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={enCours}
          data-testid="login-submit"
        >
          {enCours ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
