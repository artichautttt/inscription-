import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Role } from './roles.decorator';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * A utiliser APRES JwtAuthGuard. Lit @Roles(...) et verifie le role de req.user.
 * Sans @Roles, la route est accessible a tout utilisateur authentifie.
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(ctx: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<Role[] | undefined>(
            ROLES_KEY,
            [ctx.getHandler(), ctx.getClass()],
        );
        if (!required || required.length === 0) return true;

        const req = ctx.switchToHttp().getRequest();
        const user: AuthenticatedUser | undefined = req.user;

        if (!user || !required.includes(user.role)) {
            throw new ForbiddenException({
                code: 'ROLE_INSUFFISANT',
                message: `Role requis : ${required.join(' ou ')}.`,
            });
        }
        return true;
    }
}
