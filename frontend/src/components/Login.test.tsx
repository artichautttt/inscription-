import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';
import * as api from '../api';
import { admin, eleve, renderWithAuth } from '../test/utils';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  login: vi.fn(),
}));
const mockedApi = vi.mocked(api);

function renderLogin() {
  return renderWithAuth(<Login />, { route: '/login', path: '/login' });
}

async function remplirEtSoumettre(email: string, password: string) {
  await userEvent.type(screen.getByTestId('email-input'), email);
  await userEvent.type(screen.getByTestId('password-input'), password);
  await userEvent.click(screen.getByTestId('login-submit'));
}

describe('<Login />', () => {
  it('rend les champs email, mot de passe, le bouton et le lien vers /register', () => {
    renderLogin();
    expect(screen.getByTestId('email-input')).toHaveAttribute('type', 'email');
    expect(screen.getByTestId('password-input')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('login-submit')).toHaveTextContent('Se connecter');
    expect(screen.getByTestId('to-register-link')).toHaveAttribute('href', '/register');
  });

  it('soumission : appelle login, stocke la session et redirige un ELEVE vers /catalogue', async () => {
    mockedApi.login.mockResolvedValue({ token: 'jwt', user: eleve });
    renderLogin();

    await remplirEtSoumettre('eleve@test.com', 'eleve123');

    expect(mockedApi.login).toHaveBeenCalledWith('eleve@test.com', 'eleve123');
    expect(await screen.findByTestId('location')).toHaveTextContent('/catalogue');
    expect(localStorage.getItem('auth_token')).toBe('jwt');
    expect(JSON.parse(localStorage.getItem('auth_user')!)).toEqual(eleve);
  });

  it('redirige un ADMIN vers /admin', async () => {
    mockedApi.login.mockResolvedValue({ token: 'jwt', user: admin });
    renderLogin();
    await remplirEtSoumettre('admin@test.com', 'admin123');
    expect(await screen.findByTestId('location')).toHaveTextContent('/admin');
  });

  it('affiche le message si les identifiants sont invalides', async () => {
    mockedApi.login.mockRejectedValue(new Error('Email ou mot de passe incorrect.'));
    renderLogin();

    await remplirEtSoumettre('eleve@test.com', 'mauvais');

    expect(await screen.findByTestId('login-error')).toHaveTextContent('Email ou mot de passe incorrect.');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.getByTestId('login-submit')).toBeEnabled();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('désactive le bouton pendant la requête', async () => {
    let resoudre!: (v: Awaited<ReturnType<typeof api.login>>) => void;
    mockedApi.login.mockReturnValue(new Promise((r) => { resoudre = r; }));
    renderLogin();

    await remplirEtSoumettre('eleve@test.com', 'eleve123');

    expect(screen.getByTestId('login-submit')).toBeDisabled();
    expect(screen.getByTestId('login-submit')).toHaveTextContent('Connexion…');
    resoudre({ token: 'jwt', user: eleve });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/catalogue'));
  });
});
