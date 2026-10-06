import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import * as api from './api';
import type { User } from './types';
import { admin, eleve, makeCours, makeInscription, seedSession } from './test/utils';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getCourses: vi.fn(),
  getMyEnrollments: vi.fn(),
}));
const mockedApi = vi.mocked(api);

function renderApp(route: string, user: User | null = null) {
  seedSession(user);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('<App /> — routage et navigation', () => {
  beforeEach(() => {
    mockedApi.getCourses.mockResolvedValue([makeCours()]);
    mockedApi.getMyEnrollments.mockResolvedValue([makeInscription()]);
  });

  it('visiteur non connecté sur "/" -> formulaire de connexion', () => {
    renderApp('/');
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });

  it('ELEVE sur "/" -> catalogue', async () => {
    renderApp('/', eleve);
    expect(await screen.findByTestId('catalogue')).toBeInTheDocument();
  });

  it('ADMIN sur "/" -> gestion des cours', async () => {
    renderApp('/', admin);
    expect(await screen.findByTestId('admin-courses')).toBeInTheDocument();
  });

  it('utilisateur connecté sur /login est renvoyé vers sa home', async () => {
    renderApp('/login', eleve);
    expect(await screen.findByTestId('catalogue')).toBeInTheDocument();
    expect(screen.queryByTestId('login-form')).toBeNull();
  });

  it('visiteur non connecté peut ouvrir /register', () => {
    renderApp('/register');
    expect(screen.getByTestId('register-form')).toBeInTheDocument();
  });

  it('ELEVE : cliquer sur les onglets affiche le bon composant', async () => {
    renderApp('/catalogue', eleve);
    expect(await screen.findByTestId('catalogue')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('nav-mes-inscriptions'));
    expect(await screen.findByTestId('mes-inscriptions')).toBeInTheDocument();
    expect(screen.queryByTestId('catalogue')).toBeNull();

    await userEvent.click(screen.getByTestId('nav-catalogue'));
    expect(await screen.findByTestId('catalogue')).toBeInTheDocument();
  });

  it('ELEVE sur /admin est redirigé vers le catalogue', async () => {
    renderApp('/admin', eleve);
    expect(await screen.findByTestId('catalogue')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-courses')).toBeNull();
  });

  it('déconnexion depuis le header -> retour au formulaire de connexion', async () => {
    renderApp('/catalogue', eleve);
    await screen.findByTestId('catalogue');
    await userEvent.click(screen.getByTestId('logout-btn'));
    expect(await screen.findByTestId('login-form')).toBeInTheDocument();
  });

  it('route inconnue -> redirection vers la home', async () => {
    renderApp('/nimporte-quoi', admin);
    expect(await screen.findByTestId('admin-courses')).toBeInTheDocument();
  });
});
