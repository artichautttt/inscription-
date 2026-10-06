import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../types';

interface Props {
  children: ReactNode;
  /** Si précisé, seuls les rôles listés sont autorisés. */
  roles?: Role[];
}

/**
 * - Pas connecté → /login.
 * - Connecté mais mauvais rôle → /catalogue (par défaut sa page).
 * - Sinon → affiche l'enfant.
 */
export default function ProtectedRoute({ children, roles }: Props) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/catalogue" replace />;
  }
  return <>{children}</>;
}
