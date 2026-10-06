import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AuthenticatedUser {
    sub: string;
    email: string;
    nom: string;
    role: 'ELEVE' | 'ADMIN';
}

/**
 * Verifie la presence et la validite du JWT (Bearer).
 * Attache le payload decode a req.user pour les guards/handlers suivants.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(private readonly jwt: JwtService) {}

    canActivate(ctx: ExecutionContext): boolean {
        const req = ctx.switchToHttp().getRequest();
        const header: string | undefined = req.headers?.authorization;

        if (!header || !header.startsWith('Bearer ')) {
            throw new UnauthorizedException({
                code: 'NON_AUTHENTIFIE',
                message: 'Token manquant.',
            });
        }

        const token = header.slice('Bearer '.length).trim();
        try {
            const payload = this.jwt.verify<AuthenticatedUser>(token);
            req.user = payload;
            return true;
        } catch {
            throw new UnauthorizedException({
                code: 'TOKEN_INVALIDE',
                message: 'Token invalide ou expire.',
            });
        }
    }
}
