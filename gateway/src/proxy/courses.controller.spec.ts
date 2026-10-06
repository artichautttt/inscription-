import { Reflector } from '@nestjs/core';
import { CoursesProxyController } from './courses.controller';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('CoursesProxyController — metadata rôles ADMIN', () => {
    const reflector = new Reflector();

    it('POST /api/courses exige le role ADMIN', () => {
        const roles = reflector.get<string[]>(ROLES_KEY, CoursesProxyController.prototype.create);
        expect(roles).toEqual(['ADMIN']);
    });

    it('PATCH /api/courses/:id exige le role ADMIN', () => {
        const roles = reflector.get<string[]>(ROLES_KEY, CoursesProxyController.prototype.update);
        expect(roles).toEqual(['ADMIN']);
    });

    it('DELETE /api/courses/:id exige le role ADMIN', () => {
        const roles = reflector.get<string[]>(ROLES_KEY, CoursesProxyController.prototype.remove);
        expect(roles).toEqual(['ADMIN']);
    });

    it('GET /api/courses est public (pas de contrainte de role)', () => {
        const roles = reflector.get<string[]>(ROLES_KEY, CoursesProxyController.prototype.findAll);
        expect(roles).toBeUndefined();
    });
});
