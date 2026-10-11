import { Reflector } from '@nestjs/core';
import { WaitlistProxyController } from './waitlist.controller';
import { ProxyService } from './proxy.service';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('WaitlistProxyController', () => {
    let controller: WaitlistProxyController;
    let proxy: { forward: jest.Mock };
    const reflector = new Reflector();

    beforeEach(() => {
        proxy = { forward: jest.fn().mockResolvedValue({}) };
        controller = new WaitlistProxyController(proxy as unknown as ProxyService);
    });

    const eleveReq = (sub = 'eleve-123') => ({
        user: { sub, email: 'e@x.y', nom: 'Eleve', role: 'ELEVE' as const },
    });
    const adminReq = (sub = 'admin-999') => ({
        user: { sub, email: 'a@x.y', nom: 'Admin', role: 'ADMIN' as const },
    });

    const rolesDe = (handler: (...args: any[]) => unknown) =>
        reflector.get<string[]>(ROLES_KEY, handler);

    describe('POST (join)', () => {
        it("force etudiantId a l'id du token et ignore un etudiantId fourni dans le body", async () => {
            await controller.join(
                { etudiantId: 'ID-ATTAQUANT', coursId: 'course-1' } as any,
                eleveReq('victime-du-token') as any,
            );

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/waitlist',
                'POST',
                { etudiantId: 'victime-du-token', coursId: 'course-1' },
            );
        });

        it("un ADMIN voit aussi son propre id injecte (pas de mise en file d'un autre via le body)", async () => {
            await controller.join(
                { etudiantId: 'quelqu-un-d-autre', coursId: 'c-2' } as any,
                adminReq('admin-sub') as any,
            );

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/waitlist',
                'POST',
                { etudiantId: 'admin-sub', coursId: 'c-2' },
            );
        });

        it('sans body : coursId undefined, la validation est laissee au service aval', async () => {
            await controller.join(undefined as any, eleveReq('mon-id') as any);

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/waitlist',
                'POST',
                { etudiantId: 'mon-id', coursId: undefined },
            );
        });

        it("n'exige aucun role particulier (tout utilisateur authentifie)", () => {
            expect(rolesDe(WaitlistProxyController.prototype.join)).toBeUndefined();
        });
    });

    describe('GET /courses/:coursId — vue admin', () => {
        it('est marque @Roles(ADMIN)', () => {
            expect(rolesDe(WaitlistProxyController.prototype.findByCourse)).toEqual(['ADMIN']);
        });

        it('forward vers /waitlist/courses/:coursId', async () => {
            await controller.findByCourse('course-abc');

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/waitlist/courses/course-abc',
                'GET',
            );
        });
    });

    describe('POST /courses/:coursId/promote — action admin', () => {
        it('est marque @Roles(ADMIN)', () => {
            expect(rolesDe(WaitlistProxyController.prototype.promote)).toEqual(['ADMIN']);
        });

        it('forward vers /waitlist/courses/:coursId/promote', async () => {
            await controller.promote('course-abc');

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/waitlist/courses/course-abc/promote',
                'POST',
            );
        });
    });

    describe('DELETE (leave)', () => {
        it("propage l'identite via X-User-Id / X-User-Role", async () => {
            await controller.leave('entree-42', eleveReq('mon-id') as any);

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/waitlist/entree-42',
                'DELETE',
                undefined,
                { 'X-User-Id': 'mon-id', 'X-User-Role': 'ELEVE' },
            );
        });

        it("propage le role ADMIN (le service aval autorise l'admin a retirer n'importe qui)", async () => {
            await controller.leave('entree-42', adminReq('admin-sub') as any);

            expect(proxy.forward).toHaveBeenCalledWith(
                expect.any(String),
                '/waitlist/entree-42',
                'DELETE',
                undefined,
                { 'X-User-Id': 'admin-sub', 'X-User-Role': 'ADMIN' },
            );
        });
    });

    describe('URL du service aval', () => {
        it('cible http://localhost:3004 par defaut', async () => {
            await controller.findByCourse('c');

            expect(proxy.forward.mock.calls[0][0]).toBe(
                process.env.WAITLIST_SERVICE_URL ?? 'http://localhost:3004',
            );
        });
    });
});
