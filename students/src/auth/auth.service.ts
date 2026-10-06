import {
    ConflictException,
    HttpException,
    HttpStatus,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { StudentsService } from '../students/students.service';
import { Role } from '../students/dto/create-student.dto';
import { RegisterDto } from './dto/register.dto';

export interface JwtPayload {
    sub: string;
    email: string;
    nom: string;
    role: 'ELEVE' | 'ADMIN';
}

@Injectable()
export class AuthService {
    constructor(
        private readonly students: StudentsService,
        private readonly jwt: JwtService,
    ) {}

    async login(email: string, password: string) {
        const user = await this.students.findByEmailWithPassword(email);
        if (!user) {
            throw new UnauthorizedException({
                code: 'IDENTIFIANTS_INVALIDES',
                message: 'Email ou mot de passe incorrect.',
            });
        }

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            throw new UnauthorizedException({
                code: 'IDENTIFIANTS_INVALIDES',
                message: 'Email ou mot de passe incorrect.',
            });
        }

        return this.signSession({
            id: user.id,
            email: user.email,
            nom: user.nom,
            prenom: user.prenom,
            telephone: user.telephone,
            role: user.role as 'ELEVE' | 'ADMIN',
        });
    }

    /**
     * Inscription publique d'un ELEVE.
     * SÉCURITÉ : on NE lit QUE les 5 champs attendus du DTO et on force role=ELEVE.
     * Même si le body contient `role: 'ADMIN'`, il est ignoré.
     */
    async register(dto: RegisterDto) {
        try {
            const created = await this.students.create({
                nom: dto.nom,
                prenom: dto.prenom,
                email: dto.email,
                telephone: dto.telephone,
                password: dto.password,
                role: Role.ELEVE, // ← forcé en dur
            });

            return this.signSession({
                id: created.id,
                email: created.email,
                nom: created.nom,
                prenom: (created as any).prenom ?? dto.prenom,
                telephone: (created as any).telephone ?? dto.telephone,
                role: 'ELEVE',
            });
        } catch (err) {
            // StudentsService convertit déjà P2002 en ConflictException("Email already exists")
            // On remappe au format métier standard { code, message }.
            if (err instanceof ConflictException) {
                throw new HttpException(
                    { code: 'EMAIL_DEJA_UTILISE', message: 'Un compte avec cet email existe déjà.' },
                    HttpStatus.CONFLICT,
                );
            }
            throw err;
        }
    }

    /** Signe le JWT et retourne la paire { token, user } attendue par le front. */
    private async signSession(user: {
        id: string;
        email: string;
        nom: string;
        prenom?: string | null;
        telephone?: string | null;
        role: 'ELEVE' | 'ADMIN';
    }) {
        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            nom: user.nom,
            role: user.role,
        };
        return {
            token: await this.jwt.signAsync(payload),
            user: {
                id: user.id,
                email: user.email,
                nom: user.nom,
                prenom: user.prenom ?? null,
                telephone: user.telephone ?? null,
                role: user.role,
            },
        };
    }
}
