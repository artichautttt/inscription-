import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MesInscriptions, { statutBadge } from './MesInscriptions';
import * as api from '../api';
import { eleve, makeInscription, renderWithAuth } from '../test/utils';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getMyEnrollments: vi.fn(),
  deleteEnrollment: vi.fn(),
}));
const mockedApi = vi.mocked(api);

describe('statutBadge', () => {
  it.each(['confirmée', 'CONFIRMÉE', 'confirmee', 'Confirmed'])('"%s" -> confirmed', (statut) => {
    expect(statutBadge(statut).cls).toBe('confirmed');
  });

  it.each(['en attente', 'EN ATTENTE', 'pending'])('"%s" -> pending', (statut) => {
    expect(statutBadge(statut).cls).toBe('pending');
  });

  it('statut inconnu -> default', () => {
    expect(statutBadge('annulée').cls).toBe('default');
    expect(statutBadge('').cls).toBe('default');
  });

  it('conserve le libellé original (casse comprise)', () => {
    expect(statutBadge('CONFIRMÉE').label).toBe('CONFIRMÉE');
    expect(statutBadge('Bizarre').label).toBe('Bizarre');
  });
});

describe('<MesInscriptions />', () => {
  const items = [
    makeInscription({ id: 'i1', coursId: 'c1', coursTitre: 'Algèbre', statut: 'confirmée' }),
    makeInscription({ id: 'i2', coursId: 'c2', coursTitre: undefined, statut: 'pending' }),
  ];

  beforeEach(() => {
    mockedApi.getMyEnrollments.mockResolvedValue(items);
  });

  it('affiche le squelette de chargement puis la liste', async () => {
    const { container } = renderWithAuth(<MesInscriptions />, { user: eleve });
    expect(container.querySelectorAll('.skeleton-card')).toHaveLength(2);
    expect(await screen.findByTestId('mes-inscriptions')).toBeInTheDocument();
  });

  it('affiche le titre du cours (ou l’id à défaut) et le badge de statut', async () => {
    renderWithAuth(<MesInscriptions />, { user: eleve });
    await screen.findByTestId('mes-inscriptions');
    expect(screen.getByTestId('inscription-cours-titre-i1')).toHaveTextContent('Algèbre');
    expect(screen.getByTestId('inscription-cours-titre-i2')).toHaveTextContent('c2');
    expect(within(screen.getByTestId('inscription-card-i1')).getByText('confirmée')).toHaveClass('status-badge', 'confirmed');
    expect(within(screen.getByTestId('inscription-card-i2')).getByText('pending')).toHaveClass('pending');
  });

  it('formate la date en français', async () => {
    renderWithAuth(<MesInscriptions />, { user: eleve });
    await screen.findByTestId('mes-inscriptions');
    expect(within(screen.getByTestId('inscription-card-i1')).getByText(/15 janvier 2026/)).toBeInTheDocument();
  });

  it('affiche un bouton "Annuler" par inscription', async () => {
    renderWithAuth(<MesInscriptions />, { user: eleve });
    await screen.findByTestId('mes-inscriptions');
    expect(screen.getAllByRole('button', { name: 'Annuler' })).toHaveLength(2);
  });

  it('clic "Annuler" appelle deleteEnrollment, affiche le succès et recharge', async () => {
    mockedApi.deleteEnrollment.mockResolvedValue(undefined);
    renderWithAuth(<MesInscriptions />, { user: eleve });
    await screen.findByTestId('mes-inscriptions');

    mockedApi.getMyEnrollments.mockResolvedValue([items[1]]);
    await userEvent.click(screen.getByTestId('annuler-btn-i1'));

    expect(mockedApi.deleteEnrollment).toHaveBeenCalledWith('i1');
    expect(await screen.findByTestId('mes-inscriptions-success')).toHaveTextContent('Inscription annulée.');
    expect(mockedApi.getMyEnrollments).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('inscription-card-i1')).toBeNull();
  });

  it("affiche l'erreur si l'annulation échoue", async () => {
    mockedApi.deleteEnrollment.mockRejectedValue(new Error('Accès interdit.'));
    renderWithAuth(<MesInscriptions />, { user: eleve });
    await screen.findByTestId('mes-inscriptions');

    await userEvent.click(screen.getByTestId('annuler-btn-i2'));

    expect(await screen.findByTestId('mes-inscriptions-error')).toHaveTextContent('Accès interdit.');
    expect(screen.getByTestId('inscription-card-i2')).toBeInTheDocument();
  });

  it("affiche l'erreur si le chargement échoue", async () => {
    mockedApi.getMyEnrollments.mockRejectedValue(new Error('Token invalide'));
    renderWithAuth(<MesInscriptions />, { user: eleve });
    expect(await screen.findByTestId('mes-inscriptions-error')).toHaveTextContent('Token invalide');
  });

  it('affiche un état vide sans inscription', async () => {
    mockedApi.getMyEnrollments.mockResolvedValue([]);
    renderWithAuth(<MesInscriptions />, { user: eleve });
    expect(await screen.findByText('Aucune inscription pour le moment.')).toBeInTheDocument();
  });
});
