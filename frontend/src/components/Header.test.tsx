import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Header from './Header';
import { admin, eleve, renderWithAuth } from '../test/utils';

describe('<Header />', () => {
  it("n'affiche ni zone utilisateur ni onglets sans session", () => {
    renderWithAuth(<Header />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inscriptions aux cours');
    expect(screen.queryByTestId('user-area')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('affiche le nom et le rôle de l’utilisateur connecté', () => {
    renderWithAuth(<Header />, { user: eleve });
    expect(screen.getByTestId('user-name')).toHaveTextContent('Test (ELEVE)');
  });

  it('ELEVE : onglets Catalogue + Mes inscriptions, pas d’onglet admin', () => {
    renderWithAuth(<Header />, { user: eleve });
    expect(screen.getByTestId('nav-catalogue')).toHaveAttribute('href', '/catalogue');
    expect(screen.getByTestId('nav-mes-inscriptions')).toHaveAttribute('href', '/mes-inscriptions');
    expect(screen.queryByTestId('nav-admin')).toBeNull();
  });

  it('ADMIN : onglets Gestion des cours + Catalogue, pas de Mes inscriptions', () => {
    renderWithAuth(<Header />, { user: admin });
    expect(screen.getByTestId('user-name')).toHaveTextContent('Admin (ADMIN)');
    expect(screen.getByTestId('nav-admin')).toHaveAttribute('href', '/admin');
    expect(screen.getByTestId('nav-catalogue')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-mes-inscriptions')).toBeNull();
  });

  it("marque l'onglet de la route courante comme actif", () => {
    renderWithAuth(<Header />, { user: eleve, route: '/mes-inscriptions' });
    expect(screen.getByTestId('nav-mes-inscriptions')).toHaveClass('active');
    expect(screen.getByTestId('nav-catalogue')).not.toHaveClass('active');
  });

  it('déconnexion : purge la session (logout) et redirige vers /login', async () => {
    renderWithAuth(<Header />, { user: eleve, route: '/catalogue' });

    await userEvent.click(screen.getByTestId('logout-btn'));

    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('auth_user')).toBeNull();
    expect(screen.queryByTestId('user-area')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });
});
