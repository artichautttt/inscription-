import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import ProtectedRoute from './ProtectedRoute';
import { admin, eleve, renderWithAuth } from '../test/utils';

const page = (
  <ProtectedRoute roles={['ADMIN']}>
    <p>Zone admin</p>
  </ProtectedRoute>
);

describe('<ProtectedRoute />', () => {
  it('redirige vers /login sans session', () => {
    renderWithAuth(page, { route: '/admin', path: '/admin' });
    expect(screen.queryByText('Zone admin')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('redirige vers /catalogue si le rôle est insuffisant', () => {
    renderWithAuth(page, { user: eleve, route: '/admin', path: '/admin' });
    expect(screen.queryByText('Zone admin')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/catalogue');
  });

  it('affiche le contenu si le rôle est autorisé', () => {
    renderWithAuth(page, { user: admin, route: '/admin', path: '/admin' });
    expect(screen.getByText('Zone admin')).toBeInTheDocument();
  });

  it('sans "roles", tout utilisateur connecté passe', () => {
    renderWithAuth(<ProtectedRoute><p>Ouvert</p></ProtectedRoute>, { user: eleve });
    expect(screen.getByText('Ouvert')).toBeInTheDocument();
  });
});
