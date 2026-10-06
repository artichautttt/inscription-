import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function seDeconnecter() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="app-header">
      <div className="header-content">
        <div>
          <h1>🎓 Inscriptions aux cours</h1>
          <p className="subtitle">Consultez le catalogue et gérez vos inscriptions</p>
        </div>
        {user && (
          <div className="user-area" data-testid="user-area">
            <span className="user-name" data-testid="user-name">
              {user.nom} <span className="user-role">({user.role})</span>
            </span>
            <button
              className="btn btn-ghost"
              onClick={seDeconnecter}
              data-testid="logout-btn"
            >
              Se déconnecter
            </button>
          </div>
        )}
      </div>

      {user && (
        <nav className="tabs">
          {user.role === 'ELEVE' && (
            <>
              <NavLink to="/catalogue" data-testid="nav-catalogue">
                <span className="tab-icon">📚</span>Catalogue
              </NavLink>
              <NavLink to="/mes-inscriptions" data-testid="nav-mes-inscriptions">
                <span className="tab-icon">📋</span>Mes inscriptions
              </NavLink>
            </>
          )}
          {user.role === 'ADMIN' && (
            <>
              <NavLink to="/admin" data-testid="nav-admin">
                <span className="tab-icon">🛠️</span>Gestion des cours
              </NavLink>
              <NavLink to="/catalogue" data-testid="nav-catalogue">
                <span className="tab-icon">📚</span>Catalogue
              </NavLink>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
