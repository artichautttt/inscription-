import { Test } from '@nestjs/testing';
import { EnrollmentsService } from './enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsClient, MockStudentsClient } from '../clients/students.client';
import { CoursesClient, MockCoursesClient } from '../clients/courses.client';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        {
          provide: PrismaService,
          useValue: {
            inscription: {
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn(),
            },
          },
        },
        { provide: StudentsClient, useClass: MockStudentsClient },
        { provide: CoursesClient, useClass: MockCoursesClient },
      ],
    }).compile();

    service = moduleRef.get(EnrollmentsService);
  });

  it('est correctement instancié', () => {
    expect(service).toBeDefined();
  });

  it("retourne les inscriptions d'un étudiant", async () => {
    const result = await service.findForStudent(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(Array.isArray(result)).toBe(true);
  });

  // =============== À COMPLÉTER AU JALON 1 (règles métier) ===============
  it.todo('refuse un étudiant inconnu (404)');
  it.todo('refuse un cours inconnu (404)');
  it.todo('refuse si le cours est complet (422)');
  it.todo('refuse un doublon étudiant + cours (409)');
  it.todo('crée l’inscription puis décrémente les places (cas nominal)');
});
