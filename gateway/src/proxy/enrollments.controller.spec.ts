import { Reflector } from '@nestjs/core';
import { EnrollmentsProxyController } from './enrollments.controller';
import { ProxyService } from './proxy.service';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('EnrollmentsProxyController', () => {
    let controller: EnrollmentsProxyController;
    let proxy: { forward: jest.Mock };

    beforeEach(() => {
        proxy = { forward: jest.fn().mockResolvedValue({}) };
        controller = new EnrollmentsProxyController(proxy as unknown as ProxyService);
    });

    const eleveReq = (sub = 'eleve-123') => ({
        user: { sub, email: 'e@x.y', nom: 'Eleve', role: 'ELEVE' as const },
    });
    const adminReq = (sub = 'admin-999') => ({
        user: { sub, email: 'a@x.y', nom: 'Admin', role: 'ADMIN' as const },
    });

    describe('POST (create)', () => {
        it("force etudiantId a l'id du token et ignore un etudiantId fourni dans le body", async () => {
            await controller.create(
                { etudiantId: 'ID-ATTAQUANT', coursId: 'course-1' } as any,
                eleveReq('victime-du-token') as any,
            );

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/enrollments',
                'POST',
                { etudiantId: 'victime-du-token', coursId: 'course-1' },
            );
        });

        it("un ADMIN voit aussi son propre id injecte (pas d'auto-inscription d'un autre via le body)", async () => {
            await controller.create(
                { etudiantId: 'quelqu-un-d-autre', coursId: 'c-2' } as any,
                adminReq('admin-sub') as any,
            );
            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/enrollments',
                'POST',
                { etudiantId: 'admin-sub', coursId: 'c-2' },
            );
        });
    });

    describe('GET (findForStudent)', () => {
        it('ELEVE : filtre force a req.user.sub meme si query param tente de surcharger', async () => {
            await controller.findForStudent('AUTRE-ELEVE', eleveReq('mon-id') as any);

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/enrollments?etudiantId=mon-id',
                'GET',
            );
        });

        it('ADMIN : peut filtrer par un etudiant arbitraire', async () => {
            await controller.findForStudent('target-student', adminReq() as any);

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/enrollments?etudiantId=target-student',
                'GET',
            );
        });

        it('ADMIN sans query param : liste toutes les inscriptions (pas de filter)', async () => {
            await controller.findForStudent(undefined, adminReq() as any);

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/enrollments',
                'GET',
            );
        });
    });

    describe('GET /by-course/:coursId — vue admin', () => {
        const reflector = new Reflector();

        it('est marque @Roles(ADMIN)', () => {
            const roles = reflector.get<string[]>(
                ROLES_KEY,
                EnrollmentsProxyController.prototype.findByCourse,
            );
            expect(roles).toEqual(['ADMIN']);
        });

        it('forward vers /enrollments/by-course/:coursId', async () => {
            await controller.findByCourse('course-abc');
            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/enrollments/by-course/course-abc',
                'GET',
            );
        });
    });

    describe('DELETE (remove)', () => {
        it("propage l'identite via X-User-Id / X-User-Role", async () => {
            await controller.remove('insc-42', eleveReq('mon-id') as any);
            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/enrollments/insc-42',
                'DELETE',
                undefined,
                { 'X-User-Id': 'mon-id', 'X-User-Role': 'ELEVE' },
            );
        });
    });
});
