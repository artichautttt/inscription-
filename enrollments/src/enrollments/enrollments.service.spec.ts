import { Test } from '@nestjs/testing';
import { EnrollmentsService, Requester } from './enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsClient } from '../clients/students.client';
import { CoursesClient } from '../clients/courses.client';
import {
  AccesInterditException,
  RessourceIntrouvableException,
} from '../common/errors';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;
  let prismaMock: any;
  let coursesMock: jest.Mocked<CoursesClient>;
  let studentsMock: jest.Mocked<StudentsClient>;

  const ETUDIANT_A = '11111111-1111-4111-8111-111111111111';
  const ETUDIANT_B = '22222222-2222-4222-8222-222222222222';
  const COURS_ID = '33333333-3333-4333-8333-333333333333';
  const INSCRIPTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(async () => {
    prismaMock = {
      inscription: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };

    coursesMock = {
      findById: jest.fn().mockResolvedValue(null),
      decrementSeats: jest.fn(),
      incrementSeats: jest.fn(),
    } as any;

    studentsMock = {
      findById: jest.fn().mockResolvedValue(null),
    } as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StudentsClient, useValue: studentsMock },
        { provide: CoursesClient, useValue: coursesMock },
      ],
    }).compile();

    service = moduleRef.get(EnrollmentsService);
  });

  it('est correctement instancié', () => {
    expect(service).toBeDefined();
  });

  it("retourne les inscriptions d'un étudiant", async () => {
    const result = await service.findForStudent(ETUDIANT_A);
    expect(Array.isArray(result)).toBe(true);
  });

  describe('findForStudent() — enrichissement coursTitre', () => {
    it('ajoute le titre du cours a chaque inscription', async () => {
      prismaMock.inscription.findMany.mockResolvedValue([
        { id: 'i1', etudiantId: ETUDIANT_A, coursId: COURS_ID, statut: 'CONFIRMEE', date: new Date() },
      ]);
      coursesMock.findById.mockResolvedValue({
        id: COURS_ID, titre: 'Big Data', capacite: 30, placesRestantes: 10,
      } as any);

      const [enriched] = await service.findForStudent(ETUDIANT_A);

      expect(enriched.coursId).toBe(COURS_ID);
      expect(enriched.coursTitre).toBe('Big Data');
      expect(coursesMock.findById).toHaveBeenCalledWith(COURS_ID);
    });

    it('affiche "Cours supprime" si le cours est introuvable', async () => {
      prismaMock.inscription.findMany.mockResolvedValue([
        { id: 'i1', etudiantId: ETUDIANT_A, coursId: COURS_ID, statut: 'CONFIRMEE', date: new Date() },
      ]);
      coursesMock.findById.mockResolvedValue(null);

      const [enriched] = await service.findForStudent(ETUDIANT_A);
      expect(enriched.coursTitre).toBe('Cours supprimé');
    });

    it("affiche aussi 'Cours supprime' si l'appel au service cours jette", async () => {
      prismaMock.inscription.findMany.mockResolvedValue([
        { id: 'i1', etudiantId: ETUDIANT_A, coursId: COURS_ID, statut: 'CONFIRMEE', date: new Date() },
      ]);
      coursesMock.findById.mockRejectedValue(new Error('courses service down'));

      const [enriched] = await service.findForStudent(ETUDIANT_A);
      expect(enriched.coursTitre).toBe('Cours supprimé');
    });
  });

  describe('findByCourse() — liste des eleves inscrits (vue admin)', () => {
    it("ajoute nom + prenom + email + telephone de chaque etudiant inscrit", async () => {
      prismaMock.inscription.findMany.mockResolvedValue([
        { id: 'i1', etudiantId: ETUDIANT_A, coursId: COURS_ID, statut: 'CONFIRMEE', date: new Date() },
        { id: 'i2', etudiantId: ETUDIANT_B, coursId: COURS_ID, statut: 'CONFIRMEE', date: new Date() },
      ]);
      studentsMock.findById
        .mockResolvedValueOnce({ id: ETUDIANT_A, nom: 'Dupont', prenom: 'Jean', email: 'jd@test.com', telephone: '+33 6 11' } as any)
        .mockResolvedValueOnce({ id: ETUDIANT_B, nom: 'Martin', prenom: 'Alice', email: 'am@test.com', telephone: '+33 6 22' } as any);

      const result = await service.findByCourse(COURS_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        etudiantId: ETUDIANT_A, etudiantNom: 'Dupont', etudiantPrenom: 'Jean',
        etudiantEmail: 'jd@test.com', etudiantTelephone: '+33 6 11',
      });
      expect(result[1]).toMatchObject({
        etudiantId: ETUDIANT_B, etudiantNom: 'Martin', etudiantPrenom: 'Alice',
        etudiantEmail: 'am@test.com', etudiantTelephone: '+33 6 22',
      });
      expect(prismaMock.inscription.findMany).toHaveBeenCalledWith({
        where: { coursId: COURS_ID },
        orderBy: { date: 'desc' },
      });
    });

    it("affiche 'Etudiant supprime' et chaines vides si l'etudiant n'existe plus", async () => {
      prismaMock.inscription.findMany.mockResolvedValue([
        { id: 'i1', etudiantId: ETUDIANT_A, coursId: COURS_ID, statut: 'CONFIRMEE', date: new Date() },
      ]);
      studentsMock.findById.mockResolvedValue(null);

      const [enriched] = await service.findByCourse(COURS_ID);
      expect(enriched.etudiantNom).toBe('Étudiant supprimé');
      expect(enriched.etudiantPrenom).toBe('');
      expect(enriched.etudiantEmail).toBe('');
      expect(enriched.etudiantTelephone).toBe('');
    });

    it('tolere prenom/telephone absents (NULL en DB)', async () => {
      prismaMock.inscription.findMany.mockResolvedValue([
        { id: 'i1', etudiantId: ETUDIANT_A, coursId: COURS_ID, statut: 'CONFIRMEE', date: new Date() },
      ]);
      studentsMock.findById.mockResolvedValue({
        id: ETUDIANT_A, nom: 'Legacy', email: 'legacy@x.y',
      } as any);

      const [enriched] = await service.findByCourse(COURS_ID);
      expect(enriched.etudiantNom).toBe('Legacy');
      expect(enriched.etudiantPrenom).toBe('');
      expect(enriched.etudiantTelephone).toBe('');
    });

    it('retourne [] si aucune inscription pour ce cours', async () => {
      prismaMock.inscription.findMany.mockResolvedValue([]);
      const result = await service.findByCourse(COURS_ID);
      expect(result).toEqual([]);
      expect(studentsMock.findById).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    const requesterProprietaire: Requester = { userId: ETUDIANT_A, role: 'ELEVE' };
    const requesterAutreEleve: Requester = { userId: ETUDIANT_B, role: 'ELEVE' };
    const requesterAdmin: Requester = { userId: 'admin-id', role: 'ADMIN' };

    const inscriptionExistante = {
      id: INSCRIPTION_ID,
      etudiantId: ETUDIANT_A,
      coursId: COURS_ID,
      statut: 'CONFIRMEE',
      date: new Date(),
    };

    it('refuse 404 si inscription introuvable', async () => {
      prismaMock.inscription.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(INSCRIPTION_ID, requesterProprietaire),
      ).rejects.toBeInstanceOf(RessourceIntrouvableException);

      expect(prismaMock.inscription.delete).not.toHaveBeenCalled();
      expect(coursesMock.incrementSeats).not.toHaveBeenCalled();
    });

    it("refuse 403 si l'appelant n'est pas le propriétaire et pas ADMIN", async () => {
      prismaMock.inscription.findUnique.mockResolvedValue(inscriptionExistante);

      await expect(
        service.remove(INSCRIPTION_ID, requesterAutreEleve),
      ).rejects.toBeInstanceOf(AccesInterditException);

      expect(prismaMock.inscription.delete).not.toHaveBeenCalled();
      expect(coursesMock.incrementSeats).not.toHaveBeenCalled();
    });

    it("supprime et restitue 1 place quand l'appelant est propriétaire", async () => {
      prismaMock.inscription.findUnique.mockResolvedValue(inscriptionExistante);
      prismaMock.inscription.delete.mockResolvedValue(inscriptionExistante);
      coursesMock.incrementSeats.mockResolvedValue(undefined);

      await service.remove(INSCRIPTION_ID, requesterProprietaire);

      expect(prismaMock.inscription.delete).toHaveBeenCalledWith({
        where: { id: INSCRIPTION_ID },
      });
      expect(coursesMock.incrementSeats).toHaveBeenCalledWith(COURS_ID);
    });

    it("supprime et restitue 1 place quand l'appelant est ADMIN (même si pas propriétaire)", async () => {
      prismaMock.inscription.findUnique.mockResolvedValue(inscriptionExistante);
      prismaMock.inscription.delete.mockResolvedValue(inscriptionExistante);

      await service.remove(INSCRIPTION_ID, requesterAdmin);

      expect(prismaMock.inscription.delete).toHaveBeenCalled();
      expect(coursesMock.incrementSeats).toHaveBeenCalledWith(COURS_ID);
    });

    it("reste best-effort : supprime même si la restitution de place échoue", async () => {
      prismaMock.inscription.findUnique.mockResolvedValue(inscriptionExistante);
      prismaMock.inscription.delete.mockResolvedValue(inscriptionExistante);
      coursesMock.incrementSeats.mockRejectedValue(new Error('cours service down'));

      // Ne doit PAS lever : le délai de cohérence est acceptable, un log suffit.
      await expect(
        service.remove(INSCRIPTION_ID, requesterProprietaire),
      ).resolves.toBeUndefined();

      expect(prismaMock.inscription.delete).toHaveBeenCalled();
      expect(coursesMock.incrementSeats).toHaveBeenCalledWith(COURS_ID);
    });
  });
});
