import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import type { Cours, Inscription, User } from '../types';

export const eleve: User = { id: 'u-eleve', email: 'eleve@test.com', nom: 'Test', prenom: 'Elena', role: 'ELEVE' };
export const admin: User = { id: 'u-admin', email: 'admin@test.com', nom: 'Admin', prenom: 'Super', role: 'ADMIN' };

export function makeCours(overrides: Partial<Cours> = {}): Cours {
  return { id: 'c1', titre: 'Algèbre', capacite: 10, placesRestantes: 8, ...overrides };
}

export function makeInscription(overrides: Partial<Inscription> = {}): Inscription {
  return {
    id: 'i1',
    etudiantId: eleve.id,
    coursId: 'c1',
    coursTitre: 'Algèbre',
    statut: 'confirmée',
    date: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/** Simule une session : l'AuthProvider se réhydrate depuis localStorage. */
export function seedSession(user: User | null) {
  if (!user) return;
  localStorage.setItem('auth_token', 'fake-token');
  localStorage.setItem('auth_user', JSON.stringify(user));
}

/** Affiche le pathname courant, pour vérifier les redirections. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

/**
 * Rend `ui` dans un MemoryRouter + vrai AuthProvider (session pré-remplie).
 * `ui` est monté sur `path` ; les autres routes affichent juste la sonde de location.
 */
export function renderWithAuth(
  ui: ReactElement,
  { user = null, route = '/', path = '*' }: { user?: User | null; route?: string; path?: string } = {},
) {
  seedSession(user);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <Routes>
          <Route path={path} element={<>{ui}<LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}
