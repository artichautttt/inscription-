import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsClient } from '../clients/students.client';
import { CoursesClient } from '../clients/courses.client';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import {
    RessourceIntrouvableException,
    PlusDePlaceException,
    InscriptionDupliqueeException,
} from '../common/errors';

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsClient,
    private readonly courses: CoursesClient,
  ) {}

  /**
   * Inscrit un étudiant à un cours.
   *
   * =============== LOGIQUE MÉTIER À IMPLÉMENTER AU JALON 1 ===============
   * Enchaîner les 4 règles, persister, puis décrémenter les places :
   *
   *   1. L'étudiant doit exister
   *        this.students.findById(dto.etudiantId)
   *        -> sinon RessourceIntrouvableException (404)
   *
   *   2. Le cours doit exister
   *        this.courses.findById(dto.coursId)
   *        -> sinon RessourceIntrouvableException (404)
   *
   *   3. Il doit rester des places (placesRestantes > 0)
   *        -> sinon PlusDePlaceException (422)
   *
   *   4. Pas de doublon (même étudiant + même cours)
   *        garanti par la contrainte @@unique en base ;
   *        intercepter l'erreur Prisma P2002 -> InscriptionDupliqueeException (409)
   *
   *   Puis : créer l'inscription (statut CONFIRMEE)
   *          et appeler this.courses.decrementSeats(dto.coursId).
   * ======================================================================
   */
  async create(dto: CreateEnrollmentDto) {
      // Règle 1 — l'étudiant doit exister
      const etudiant = await this.students.findById(dto.etudiantId);
      if (!etudiant) {
          throw new RessourceIntrouvableException(`Étudiant ${dto.etudiantId} introuvable.`);
      }

      // Règle 2 — le cours doit exister
      const cours = await this.courses.findById(dto.coursId);
      if (!cours) {
          throw new RessourceIntrouvableException(`Cours ${dto.coursId} introuvable.`);
      }

      // Règle 3 — il doit rester des places
      if (cours.placesRestantes <= 0) {
          throw new PlusDePlaceException();
      }

      // Règle 4 - Pas de doublon
      const doublon = await this.prisma.inscription.findFirst({
          where: { etudiantId: dto.etudiantId, coursId: cours.id },
      });
      if (doublon) {
          throw new InscriptionDupliqueeException();
      }
  }

  /** Retourne les inscriptions d'un étudiant, les plus récentes d'abord. */
  async findForStudent(etudiantId: string) {
    return this.prisma.inscription.findMany({
      where: { etudiantId },
      orderBy: { date: 'desc' },
    });
  }
}
