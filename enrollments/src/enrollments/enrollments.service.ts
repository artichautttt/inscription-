import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsClient } from '../clients/students.client';
import { CoursesClient } from '../clients/courses.client';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import {
    AccesInterditException,
    RessourceIntrouvableException,
    PlusDePlaceException,
    InscriptionDupliqueeException,
} from '../common/errors';

export interface Requester {
    userId: string;
    role: 'ELEVE' | 'ADMIN';
}

@Injectable()
export class EnrollmentsService {
    private readonly logger = new Logger(EnrollmentsService.name);

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

    /**
     * Retourne les inscriptions d'un étudiant, enrichies du titre du cours.
     * Si le cours a été supprimé entre-temps, on affiche "Cours supprimé" plutôt que l'UUID.
     * N+1 assumé (un étudiant a peu d'inscriptions ; sans etudiantId → cas admin, idem).
     */
    async findForStudent(etudiantId: string | undefined) {
        const inscriptions = await this.prisma.inscription.findMany({
            where: etudiantId ? { etudiantId } : undefined,
            orderBy: { date: 'desc' },
        });

        return Promise.all(
            inscriptions.map(async (i) => {
                const cours = await this.courses.findById(i.coursId).catch(() => null);
                return {
                    ...i,
                    coursTitre: cours?.titre ?? 'Cours supprimé',
                };
            }),
        );
    }

    /**
     * Liste les inscriptions d'un cours donné, enrichies des infos étudiant
     * (nom + email). Destinée à l'écran ADMIN "Voir les inscrits d'un cours".
     * Si un étudiant a été supprimé, on affiche "Étudiant supprimé".
     */
    async findByCourse(coursId: string) {
        const inscriptions = await this.prisma.inscription.findMany({
            where: { coursId },
            orderBy: { date: 'desc' },
        });

        return Promise.all(
            inscriptions.map(async (i) => {
                const etudiant = await this.students.findById(i.etudiantId).catch(() => null);
                return {
                    ...i,
                    etudiantNom: etudiant?.nom ?? 'Étudiant supprimé',
                    etudiantPrenom: etudiant?.prenom ?? '',
                    etudiantEmail: etudiant?.email ?? '',
                    etudiantTelephone: etudiant?.telephone ?? '',
                };
            }),
        );
    }

    /**
     * Annule une inscription :
     *  - 404 si l'inscription n'existe pas,
     *  - 403 si l'appelant n'est ni propriétaire ni ADMIN,
     *  - supprime l'inscription,
     *  - restitue 1 place au cours (best-effort : on log en cas d'échec).
     */
    async remove(id: string, requester: Requester): Promise<void> {
        const inscription = await this.prisma.inscription.findUnique({ where: { id } });
        if (!inscription) {
            throw new RessourceIntrouvableException(`Inscription ${id} introuvable.`);
        }

        const estProprietaire = inscription.etudiantId === requester.userId;
        const estAdmin = requester.role === 'ADMIN';
        if (!estProprietaire && !estAdmin) {
            throw new AccesInterditException(
                "Vous ne pouvez pas annuler l'inscription d'un autre étudiant.",
            );
        }

        await this.prisma.inscription.delete({ where: { id } });

        // Restitution de place — best-effort. L'inscription est déjà supprimée ;
        // en cas d'échec on log, pas de rollback (cohérence distribuée stricte hors scope).
        try {
            await this.courses.incrementSeats(inscription.coursId);
        } catch (err) {
            this.logger.error(
                `Inscription ${id} supprimée, mais restitution de place sur le cours ` +
                `${inscription.coursId} a échoué : ${(err as Error).message}`,
            );
        }
    }
}
