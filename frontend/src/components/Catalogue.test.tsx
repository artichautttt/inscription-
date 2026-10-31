import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Catalogue, { placesLevel } from './Catalogue';
import * as api from '../api';
import { admin, eleve, makeCours, renderWithAuth } from '../test/utils';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getCourses: vi.fn(),
  createEnrollment: vi.fn(),
}));
const mockedApi = vi.mocked(api);

describe('placesLevel', () => {
  it('renvoie "high" au-dessus de 50 %', () => {
    expect(placesLevel(8, 10)).toBe('high');
    expect(placesLevel(10, 10)).toBe('high');
  });

  it('renvoie "medium" à exactement 50 % (limite exclusive)', () => {
    expect(placesLevel(5, 10)).toBe('medium');
  });

  it('renvoie "medium" entre 20 % et 50 %', () => {
    expect(placesLevel(3, 10)).toBe('medium');
  });

  it('renvoie "low" à exactement 20 % (limite exclusive)', () => {
    expect(placesLevel(2, 10)).toBe('low');
  });

  it('renvoie "low" sous 20 % et à 0 place', () => {
    expect(placesLevel(1, 10)).toBe('low');
    expect(placesLevel(0, 10)).toBe('low');
  });
});

describe('<Catalogue />', () => {
  const cours = [
    makeCours({ id: 'c1', titre: 'Algèbre', capacite: 10, placesRestantes: 8 }),
    makeCours({ id: 'c2', titre: 'Chimie', capacite: 10, placesRestantes: 3 }),
    makeCours({ id: 'c3', titre: 'Histoire', capacite: 10, placesRestantes: 0 }),
  ];

  beforeEach(() => {
    mockedApi.getCourses.mockResolvedValue(cours);
  });

  it('affiche un squelette de chargement puis la liste', async () => {
    const { container } = renderWithAuth(<Catalogue />, { user: eleve });
    expect(container.querySelectorAll('.skeleton-card')).toHaveLength(3);
    expect(await screen.findByTestId('catalogue')).toBeInTheDocument();
    expect(container.querySelector('.skeleton-card')).toBeNull();
  });

  it('affiche une carte par cours, avec titre et places', async () => {
    renderWithAuth(<Catalogue />, { user: eleve });
    await screen.findByTestId('catalogue');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    const carte = screen.getByTestId('course-card-c2');
    expect(within(carte).getByText('Chimie')).toBeInTheDocument();
    expect(within(carte).getByText('3 / 10 places')).toBeInTheDocument();
  });

  it('applique la classe de jauge high / medium / low', async () => {
    renderWithAuth(<Catalogue />, { user: eleve });
    await screen.findByTestId('catalogue');
    const fill = (id: string) => screen.getByTestId(`course-card-${id}`).querySelector('.places-bar-fill');
    expect(fill('c1')).toHaveClass('high');
    expect(fill('c1')).toHaveStyle({ width: '80%' });
    expect(fill('c2')).toHaveClass('medium');
    expect(fill('c3')).toHaveClass('low');
  });

  it('bouton "Complet" désactivé si 0 place, "S\'inscrire" actif sinon', async () => {
    renderWithAuth(<Catalogue />, { user: eleve });
    await screen.findByTestId('catalogue');
    const complet = screen.getByTestId('inscrire-btn-c3');
    expect(complet).toBeDisabled();
    expect(complet).toHaveTextContent('Complet');
    const actif = screen.getByTestId('inscrire-btn-c1');
    expect(actif).toBeEnabled();
    expect(actif).toHaveTextContent("S'inscrire");
  });

  it("n'affiche aucun bouton d'inscription pour un ADMIN (lecture seule)", async () => {
    renderWithAuth(<Catalogue />, { user: admin });
    await screen.findByTestId('catalogue');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clic sur "S\'inscrire" appelle createEnrollment, affiche le succès et recharge', async () => {
    mockedApi.createEnrollment.mockResolvedValue({} as never);
    renderWithAuth(<Catalogue />, { user: eleve });
    await screen.findByTestId('catalogue');

    await userEvent.click(screen.getByTestId('inscrire-btn-c1'));

    expect(mockedApi.createEnrollment).toHaveBeenCalledWith('c1');
    expect(await screen.findByTestId('catalogue-success')).toHaveTextContent('Inscription réussie !');
    expect(mockedApi.getCourses).toHaveBeenCalledTimes(2);
  });

  it("affiche le message d'erreur si l'inscription est rejetée", async () => {
    mockedApi.createEnrollment.mockRejectedValue(new Error('Déjà inscrit à ce cours.'));
    renderWithAuth(<Catalogue />, { user: eleve });
    await screen.findByTestId('catalogue');

    await userEvent.click(screen.getByTestId('inscrire-btn-c2'));

    expect(await screen.findByTestId('catalogue-error')).toHaveTextContent('Déjà inscrit à ce cours.');
    expect(screen.queryByTestId('catalogue-success')).toBeNull();
  });

  it("affiche l'erreur si le chargement du catalogue échoue", async () => {
    mockedApi.getCourses.mockRejectedValue(new Error('Gateway down'));
    renderWithAuth(<Catalogue />, { user: eleve });
    expect(await screen.findByTestId('catalogue-error')).toHaveTextContent('Gateway down');
    expect(screen.queryByText(/Aucun cours disponible/)).toBeNull();
  });

  it('affiche un état vide sans cours', async () => {
    mockedApi.getCourses.mockResolvedValue([]);
    renderWithAuth(<Catalogue />, { user: eleve });
    expect(await screen.findByText('Aucun cours disponible pour le moment.')).toBeInTheDocument();
  });
});
