import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

describe('AuthService', () => {
    let auth: AuthService;
    let students: { findByEmailWithPassword: jest.Mock; create: jest.Mock };
    let jwt: { signAsync: jest.Mock };

    beforeEach(() => {
        students = {
            findByEmailWithPassword: jest.fn(),
            create: jest.fn(),
        };
        jwt = { signAsync: jest.fn().mockResolvedValue('signed-jwt') };
        auth = new AuthService(students as any, jwt as unknown as JwtService);
    });

    describe('login()', () => {
        it('refuse un email inconnu', async () => {
            students.findByEmailWithPassword.mockResolvedValue(null);
            await expect(auth.login('x@y.z', 'whatever')).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('refuse un mot de passe invalide', async () => {
            const hash = await bcrypt.hash('bon-mdp', 10);
            students.findByEmailWithPassword.mockResolvedValue({
                id: 'u1', email: 'a@b.c', nom: 'A', password: hash, role: 'ELEVE',
            });
            await expect(auth.login('a@b.c', 'mauvais-mdp')).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('renvoie token + user quand les identifiants sont valides', async () => {
            const hash = await bcrypt.hash('secret', 10);
            students.findByEmailWithPassword.mockResolvedValue({
                id: 'u1', email: 'a@b.c', nom: 'Alice', prenom: 'Al', telephone: '0600',
                password: hash, role: 'ELEVE',
            });

            const res = await auth.login('a@b.c', 'secret');

            expect(res.token).toBe('signed-jwt');
            expect(res.user).toEqual({
                id: 'u1', email: 'a@b.c', nom: 'Alice', prenom: 'Al', telephone: '0600', role: 'ELEVE',
            });
            expect(jwt.signAsync).toHaveBeenCalledWith({
                sub: 'u1', email: 'a@b.c', nom: 'Alice', role: 'ELEVE',
            });
        });

        it('signe un token admin avec le role ADMIN', async () => {
            const hash = await bcrypt.hash('secret', 10);
            students.findByEmailWithPassword.mockResolvedValue({
                id: 'u2', email: 'admin@test.com', nom: 'Admin', password: hash, role: 'ADMIN',
            });

            const res = await auth.login('admin@test.com', 'secret');
            expect(res.user.role).toBe('ADMIN');
        });
    });

    describe('register()', () => {
        const dtoValide = {
            nom: 'Durand', prenom: 'Paul', email: 'paul@x.y',
            telephone: '+33 6 12 34 56 78', password: 'secret1',
        };

        it('cree un nouveau compte et renvoie { token, user: role=ELEVE }', async () => {
            students.create.mockResolvedValue({
                id: 'new-id', nom: 'Durand', prenom: 'Paul', email: 'paul@x.y',
                telephone: '+33 6 12 34 56 78', role: 'ELEVE',
            });

            const res = await auth.register(dtoValide);

            expect(students.create).toHaveBeenCalledWith(expect.objectContaining({
                nom: 'Durand', prenom: 'Paul', email: 'paul@x.y',
                telephone: '+33 6 12 34 56 78', password: 'secret1', role: 'ELEVE',
            }));
            expect(res.token).toBe('signed-jwt');
            expect(res.user.role).toBe('ELEVE');
        });

        it('SECURITE : role toujours force a ELEVE meme si body contient role=ADMIN', async () => {
            students.create.mockResolvedValue({
                id: 'new-id', nom: 'Attaquant', prenom: 'A', email: 'atk@x.y',
                telephone: '0600', role: 'ELEVE',
            });

            // On passe volontairement un role=ADMIN pour tenter l'escalade.
            await auth.register({ ...dtoValide, role: 'ADMIN' } as any);

            // Le call a students.create NE DOIT PAS contenir role=ADMIN
            expect(students.create).toHaveBeenCalledTimes(1);
            const createArg = students.create.mock.calls[0][0];
            expect(createArg.role).toBe('ELEVE');
            expect(createArg.role).not.toBe('ADMIN');
        });

        it('409 EMAIL_DEJA_UTILISE si email deja pris', async () => {
            students.create.mockRejectedValue(new ConflictException('Email already exists'));

            await expect(auth.register(dtoValide)).rejects.toMatchObject({
                response: { code: 'EMAIL_DEJA_UTILISE' },
            });

            try {
                await auth.register(dtoValide);
            } catch (err) {
                expect(err).toBeInstanceOf(HttpException);
                expect((err as HttpException).getStatus()).toBe(409);
            }
        });

        it("auto-connexion : le token est signe avec le sub du nouveau compte", async () => {
            students.create.mockResolvedValue({
                id: 'brand-new-uuid', nom: 'X', prenom: 'Y',
                email: 'z@a.b', telephone: '0600', role: 'ELEVE',
            });

            await auth.register(dtoValide);

            expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({
                sub: 'brand-new-uuid', role: 'ELEVE',
            }));
        });
    });
});
