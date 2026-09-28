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
        // Création
        const inscription = await this.prisma.inscription.create({
            data: { etudiantId: dto.etudiantId, coursId: dto.coursId },
        });

        await this.courses.decrementSeats(dto.coursId);

        return inscription;
    }

    /** Retourne les inscriptions d'un étudiant, les plus récentes d'abord. */
    async findForStudent(etudiantId: string) {
        return this.prisma.inscription.findMany({
            where: { etudiantId },
            orderBy: { date: 'desc' },
        });
    }
}
