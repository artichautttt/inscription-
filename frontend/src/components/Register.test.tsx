import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Register from './Register';
import * as api from '../api';
import { eleve, renderWithAuth } from '../test/utils';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  register: vi.fn(),
}));
const mockedApi = vi.mocked(api);

const payload = {
  nom: 'Durand',
  prenom: 'Paul',
  email: 'paul@x.y',
  telephone: '+33 6 12 34 56 78',
  password: 'secret1',
};

function renderRegister() {
  return renderWithAuth(<Register />, { route: '/register', path: '/register' });
}

async function remplir(valeurs: Partial<typeof payload>) {
  for (const [champ, valeur] of Object.entries(valeurs)) {
    if (valeur) await userEvent.type(screen.getByTestId(`register-${champ}`), valeur);
  }
}

/** Soumet via l'événement submit : contourne la validation HTML5 (required/minLength) de jsdom
 *  pour tester la validation JS du composant. */
function soumettreFormulaire() {
  fireEvent.submit(screen.getByTestId('register-form'));
}

describe('<Register />', () => {
  it('rend les 5 champs, le bouton et le lien vers /login', () => {
    renderRegister();
    for (const champ of ['nom', 'prenom', 'email', 'telephone', 'password']) {
      expect(screen.getByTestId(`register-${champ}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('register-submit')).toHaveTextContent('Créer mon compte');
    expect(screen.getByTestId('to-login-link')).toHaveAttribute('href', '/login');
  });

  it('soumission : appelle register avec le payload, connecte et redirige vers /catalogue', async () => {
    mockedApi.register.mockResolvedValue({ token: 'jwt', user: eleve });
    renderRegister();

    await remplir(payload);
    await userEvent.click(screen.getByTestId('register-submit'));

    expect(mockedApi.register).toHaveBeenCalledWith(payload);
    expect(await screen.findByTestId('location')).toHaveTextContent('/catalogue');
    expect(localStorage.getItem('auth_token')).toBe('jwt');
  });

  it("affiche l'erreur si l'email est déjà pris", async () => {
    mockedApi.register.mockRejectedValue(new Error('Un compte avec cet email existe déjà.'));
    renderRegister();

    await remplir(payload);
    await userEvent.click(screen.getByTestId('register-submit'));

    expect(await screen.findByTestId('register-error')).toHaveTextContent('Un compte avec cet email existe déjà.');
    expect(screen.getByTestId('location')).toHaveTextContent('/register');
  });

  it('validation client : champ manquant -> "Tous les champs sont requis." sans appel API', async () => {
    renderRegister();
    await remplir({ ...payload, telephone: '' });
    soumettreFormulaire();

    expect(await screen.findByTestId('register-error')).toHaveTextContent('Tous les champs sont requis.');
    expect(mockedApi.register).not.toHaveBeenCalled();
  });

  it('validation client : mot de passe < 6 caractères refusé sans appel API', async () => {
    renderRegister();
    await remplir({ ...payload, password: '123' });
    soumettreFormulaire();

    expect(await screen.findByTestId('register-error')).toHaveTextContent('au moins 6 caractères');
    expect(mockedApi.register).not.toHaveBeenCalled();
  });
});
