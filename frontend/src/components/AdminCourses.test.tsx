import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminCourses from './AdminCourses';
import * as api from '../api';
import type { InscriptionAvecEtudiant } from '../types';
import { admin, makeCours, makeInscription, renderWithAuth } from '../test/utils';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getCourses: vi.fn(),
  createCourse: vi.fn(),
  updateCourse: vi.fn(),
  deleteCourse: vi.fn(),
  deleteEnrollment: vi.fn(),
  getEnrollmentsByCourse: vi.fn(),
}));
const mockedApi = vi.mocked(api);

const cours = [
  makeCours({ id: 'c1', titre: 'Algèbre', capacite: 10, placesRestantes: 8 }),
  makeCours({ id: 'c2', titre: 'Chimie', capacite: 5, placesRestantes: 0 }),
];

const inscrit: InscriptionAvecEtudiant = {
  ...makeInscription({ id: 'i1', coursId: 'c1' }),
  etudiantNom: 'Dupont',
  etudiantPrenom: 'Jean',
  etudiantEmail: 'jean.dupont@example.com',
  etudiantTelephone: '+33 6 11 22 33 44',
};

async function renderAdmin() {
  renderWithAuth(<AdminCourses />, { user: admin });
  await screen.findByTestId('admin-course-c1');
}

describe('<AdminCourses />', () => {
  beforeEach(() => {
    mockedApi.getCourses.mockResolvedValue(cours);
  });

  it('rend le formulaire de création avec capacité par défaut à 10', async () => {
    await renderAdmin();
    expect(screen.getByTestId('create-course-form')).toBeInTheDocument();
    expect(screen.getByTestId('new-course-titre')).toHaveValue('');
    expect(screen.getByTestId('new-course-capacite')).toHaveValue(10);
  });

  it('liste les cours avec "Voir inscrits", "Modifier" et "Supprimer"', async () => {
    await renderAdmin();
    const carte = screen.getByTestId('admin-course-c2');
    expect(within(carte).getByText('Chimie')).toBeInTheDocument();
    expect(within(carte).getByText('0 / 5 places')).toBeInTheDocument();
    expect(screen.getByTestId('voir-inscrits-btn-c2')).toHaveTextContent('Voir inscrits');
    expect(screen.getByTestId('edit-btn-c2')).toBeInTheDocument();
    expect(screen.getByTestId('delete-btn-c2')).toHaveTextContent('Supprimer');
  });

  it('affiche un état vide sans cours', async () => {
    mockedApi.getCourses.mockResolvedValue([]);
    renderWithAuth(<AdminCourses />, { user: admin });
    expect(await screen.findByText(/Aucun cours/)).toBeInTheDocument();
  });

  it('création : appelle createCourse, affiche le succès, réinitialise et recharge', async () => {
    mockedApi.createCourse.mockResolvedValue(makeCours({ id: 'c3', titre: 'Physique' }));
    await renderAdmin();

    await userEvent.type(screen.getByTestId('new-course-titre'), 'Physique');
    await userEvent.clear(screen.getByTestId('new-course-capacite'));
    await userEvent.type(screen.getByTestId('new-course-capacite'), '25');
    await userEvent.click(screen.getByTestId('create-course-submit'));

    expect(mockedApi.createCourse).toHaveBeenCalledWith({ titre: 'Physique', capacite: 25 });
    expect(await screen.findByTestId('admin-success')).toHaveTextContent('Cours "Physique" créé.');
    expect(screen.getByTestId('new-course-titre')).toHaveValue('');
    expect(mockedApi.getCourses).toHaveBeenCalledTimes(2);
  });

  it("création : affiche l'erreur backend", async () => {
    mockedApi.createCourse.mockRejectedValue(new Error('Rôle insuffisant'));
    await renderAdmin();
    await userEvent.type(screen.getByTestId('new-course-titre'), 'X');
    await userEvent.click(screen.getByTestId('create-course-submit'));
    expect(await screen.findByTestId('admin-error')).toHaveTextContent('Rôle insuffisant');
  });

  it('édition : pré-remplit, appelle updateCourse et referme le formulaire', async () => {
    mockedApi.updateCourse.mockResolvedValue(cours[0]);
    await renderAdmin();

    await userEvent.click(screen.getByTestId('edit-btn-c1'));
    expect(screen.getByTestId('edit-titre-c1')).toHaveValue('Algèbre');
    expect(screen.getByTestId('edit-capacite-c1')).toHaveValue(10);

    await userEvent.clear(screen.getByTestId('edit-titre-c1'));
    await userEvent.type(screen.getByTestId('edit-titre-c1'), 'Algèbre 2');
    await userEvent.click(screen.getByTestId('save-edit-c1'));

    expect(mockedApi.updateCourse).toHaveBeenCalledWith('c1', { titre: 'Algèbre 2', capacite: 10 });
    expect(await screen.findByTestId('admin-success')).toHaveTextContent('Cours mis à jour.');
    expect(screen.queryByTestId('edit-titre-c1')).toBeNull();
  });

  it('édition : "Annuler" referme sans appeler updateCourse', async () => {
    await renderAdmin();
    await userEvent.click(screen.getByTestId('edit-btn-c1'));
    await userEvent.click(screen.getByTestId('cancel-edit-c1'));
    expect(screen.queryByTestId('edit-titre-c1')).toBeNull();
    expect(mockedApi.updateCourse).not.toHaveBeenCalled();
  });

  it('suppression confirmée : appelle deleteCourse et affiche le succès', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockedApi.deleteCourse.mockResolvedValue(undefined);
    await renderAdmin();

    await userEvent.click(screen.getByTestId('delete-btn-c2'));

    expect(window.confirm).toHaveBeenCalledWith('Supprimer le cours "Chimie" ?');
    expect(mockedApi.deleteCourse).toHaveBeenCalledWith('c2');
    expect(await screen.findByTestId('admin-success')).toHaveTextContent('Cours "Chimie" supprimé.');
  });

  it("suppression refusée dans la confirmation : n'appelle pas deleteCourse", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderAdmin();
    await userEvent.click(screen.getByTestId('delete-btn-c1'));
    expect(mockedApi.deleteCourse).not.toHaveBeenCalled();
  });

  it('"Voir inscrits" : affiche prénom+nom, email, téléphone, puis "Masquer" referme', async () => {
    mockedApi.getEnrollmentsByCourse.mockResolvedValue([inscrit]);
    await renderAdmin();

    await userEvent.click(screen.getByTestId('voir-inscrits-btn-c1'));

    expect(mockedApi.getEnrollmentsByCourse).toHaveBeenCalledWith('c1');
    expect(await screen.findByTestId('inscrit-nom-i1')).toHaveTextContent('Jean Dupont');
    expect(screen.getByTestId('inscrit-email-i1')).toHaveTextContent('jean.dupont@example.com');
    expect(screen.getByTestId('inscrit-telephone-i1')).toHaveTextContent('+33 6 11 22 33 44');

    await userEvent.click(screen.getByTestId('voir-inscrits-btn-c1'));
    expect(screen.getByTestId('voir-inscrits-btn-c1')).toHaveTextContent('Voir inscrits');
    expect(screen.queryByTestId('inscrit-i1')).toBeNull();
  });

  it('"Voir inscrits" : message vide si aucun inscrit', async () => {
    mockedApi.getEnrollmentsByCourse.mockResolvedValue([]);
    await renderAdmin();
    await userEvent.click(screen.getByTestId('voir-inscrits-btn-c2'));
    expect(await screen.findByTestId('inscrits-vide-c2')).toHaveTextContent('Aucun élève inscrit');
  });

  it('"Voir inscrits" : erreur affichée dans le panneau', async () => {
    mockedApi.getEnrollmentsByCourse.mockRejectedValue(new Error('Service enrollments KO'));
    await renderAdmin();
    await userEvent.click(screen.getByTestId('voir-inscrits-btn-c1'));
    expect(await within(screen.getByTestId('inscrits-panel-c1')).findByText('Service enrollments KO')).toBeInTheDocument();
  });

  it('"Retirer" un inscrit : appelle deleteEnrollment et rafraîchit le panneau', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockedApi.getEnrollmentsByCourse.mockResolvedValueOnce([inscrit]).mockResolvedValueOnce([]);
    mockedApi.deleteEnrollment.mockResolvedValue(undefined);
    await renderAdmin();

    await userEvent.click(screen.getByTestId('voir-inscrits-btn-c1'));
    await userEvent.click(await screen.findByTestId('retirer-inscrit-btn-i1'));

    expect(mockedApi.deleteEnrollment).toHaveBeenCalledWith('i1');
    expect(await screen.findByTestId('admin-success')).toHaveTextContent('Jean Dupont a été retiré du cours.');
    expect(await screen.findByTestId('inscrits-vide-c1')).toBeInTheDocument();
  });
});
