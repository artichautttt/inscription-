import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function ctxWithUser(user: any): ExecutionContext {
    return {
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => ({}),
        getClass: () => ({}),
    } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
    let reflector: Reflector;
    let guard: RolesGuard;

    beforeEach(() => {
        reflector = new Reflector();
        guard = new RolesGuard(reflector);
    });

    it('autorise si aucun role requis', () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
        expect(guard.canActivate(ctxWithUser({ role: 'ELEVE' }))).toBe(true);
    });

    it('autorise si le role correspond', () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
        expect(guard.canActivate(ctxWithUser({ role: 'ADMIN' }))).toBe(true);
    });

    it("rejette (403) si le role n'est pas suffisant", () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
        expect(() => guard.canActivate(ctxWithUser({ role: 'ELEVE' }))).toThrow(ForbiddenException);
    });

    it("rejette si l'utilisateur est absent", () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
        expect(() => guard.canActivate(ctxWithUser(undefined))).toThrow(ForbiddenException);
    });
});
