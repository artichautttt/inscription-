import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearToken,
  createCourse,
  createEnrollment,
  deleteCourse,
  deleteEnrollment,
  getCourses,
  getEnrollmentsByCourse,
  getMyEnrollments,
  getToken,
  login,
  register,
  setToken,
  updateCourse,
} from './api';

/** Fabrique une Response minimale comme celle que lit request(). */
function reponse(status: number, body?: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

/** URL et options du n-ième appel à fetch. */
function appel(n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init };
}

describe('gestion du token', () => {
  it('setToken / getToken / clearToken passent par localStorage', () => {
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(localStorage.getItem('auth_token')).toBe('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe('en-têtes', () => {
  it('ajoute Authorization: Bearer quand un token est présent', async () => {
    setToken('jwt-123');
    fetchMock.mockResolvedValue(reponse(200, []));
    await getCourses();
    expect(appel().init.headers.Authorization).toBe('Bearer jwt-123');
    expect(appel().init.headers['Content-Type']).toBe('application/json');
  });

  it("n'ajoute pas Authorization sans token", async () => {
    fetchMock.mockResolvedValue(reponse(200, []));
    await getCourses();
    expect(appel().init.headers).not.toHaveProperty('Authorization');
  });
});

describe('getCourses', () => {
  it('appelle GET /api/courses et renvoie la liste', async () => {
    const cours = [{ id: 'c1', titre: 'Algèbre', capacite: 10, placesRestantes: 3 }];
    fetchMock.mockResolvedValue(reponse(200, cours));
    await expect(getCourses()).resolves.toEqual(cours);
    expect(appel().url).toMatch(/\/api\/courses$/);
    expect(appel().init.method).toBeUndefined(); // GET par défaut
  });

  it('lève une erreur avec le message du backend si !ok', async () => {
    fetchMock.mockResolvedValue(reponse(500, { code: 'X', message: 'Service indisponible' }));
    await expect(getCourses()).rejects.toThrow('Service indisponible');
  });

  it('lève "Erreur HTTP <status>" si le corps est vide', async () => {
    fetchMock.mockResolvedValue(reponse(502));
    await expect(getCourses()).rejects.toThrow('Erreur HTTP 502');
  });
});

describe('createEnrollment', () => {
  it('POST /api/enrollments avec { coursId } et renvoie l’inscription', async () => {
    const insc = { id: 'i1', etudiantId: 'u1', coursId: 'c1', statut: 'confirmée', date: '2026-01-01' };
    fetchMock.mockResolvedValue(reponse(201, insc));
    await expect(createEnrollment('c1')).resolves.toEqual(insc);
    expect(appel().url).toMatch(/\/api\/enrollments$/);
    expect(appel().init.method).toBe('POST');
    expect(JSON.parse(appel().init.body as string)).toEqual({ coursId: 'c1' });
  });

  it('propage le message 409 (déjà inscrit)', async () => {
    fetchMock.mockResolvedValue(reponse(409, { code: 'DEJA_INSCRIT', message: 'Déjà inscrit à ce cours.' }));
    await expect(createEnrollment('c1')).rejects.toThrow('Déjà inscrit à ce cours.');
  });

  it('propage le message 422 (cours complet)', async () => {
    fetchMock.mockResolvedValue(reponse(422, { code: 'COURS_COMPLET', message: 'Plus de place.' }));
    await expect(createEnrollment('c1')).rejects.toThrow('Plus de place.');
  });
});

describe('getMyEnrollments', () => {
  it('GET /api/enrollments (etudiantId tiré du token côté gateway) et renvoie la liste', async () => {
    setToken('jwt-eleve');
    const liste = [{ id: 'i1' }, { id: 'i2' }];
    fetchMock.mockResolvedValue(reponse(200, liste));
    await expect(getMyEnrollments()).resolves.toEqual(liste);
    expect(appel().url).toMatch(/\/api\/enrollments$/);
    expect(appel().init.headers.Authorization).toBe('Bearer jwt-eleve');
  });
});

describe('deleteEnrollment', () => {
  it('DELETE /api/enrollments/:id et gère le 204 sans corps', async () => {
    fetchMock.mockResolvedValue(reponse(204));
    await expect(deleteEnrollment('i42')).resolves.toBeUndefined();
    expect(appel().url).toMatch(/\/api\/enrollments\/i42$/);
    expect(appel().init.method).toBe('DELETE');
  });

  it('propage le message 403 (inscription non possédée)', async () => {
    fetchMock.mockResolvedValue(reponse(403, { code: 'ACCES_INTERDIT', message: 'Accès interdit.' }));
    await expect(deleteEnrollment('i42')).rejects.toThrow('Accès interdit.');
  });
});

describe('login / register', () => {
  const user = { id: 'u1', email: 'eleve@test.com', nom: 'Test', role: 'ELEVE' };

  it('login : POST /api/auth/login avec email+password, renvoie {token, user}', async () => {
    fetchMock.mockResolvedValue(reponse(200, { token: 't', user }));
    await expect(login('eleve@test.com', 'eleve123')).resolves.toEqual({ token: 't', user });
    expect(appel().url).toMatch(/\/api\/auth\/login$/);
    expect(appel().init.method).toBe('POST');
    expect(JSON.parse(appel().init.body as string)).toEqual({ email: 'eleve@test.com', password: 'eleve123' });
  });

  it('login : propage le 401 identifiants invalides', async () => {
    fetchMock.mockResolvedValue(
      reponse(401, { code: 'IDENTIFIANTS_INVALIDES', message: 'Email ou mot de passe incorrect.' }),
    );
    await expect(login('x@y.z', 'bad')).rejects.toThrow('Email ou mot de passe incorrect.');
  });

  it('register : POST /api/auth/register avec le payload complet', async () => {
    const payload = { nom: 'Durand', prenom: 'Paul', email: 'paul@x.y', telephone: '+33 6 12 34 56 78', password: 'secret1' };
    fetchMock.mockResolvedValue(reponse(201, { token: 't', user }));
    await expect(register(payload)).resolves.toEqual({ token: 't', user });
    expect(appel().url).toMatch(/\/api\/auth\/register$/);
    expect(appel().init.method).toBe('POST');
    expect(JSON.parse(appel().init.body as string)).toEqual(payload);
  });

  it('register : propage le 409 email déjà utilisé', async () => {
    fetchMock.mockResolvedValue(
      reponse(409, { code: 'EMAIL_DEJA_UTILISE', message: 'Un compte avec cet email existe déjà.' }),
    );
    await expect(
      register({ nom: 'a', prenom: 'b', email: 'c@d.e', telephone: '1', password: '123456' }),
    ).rejects.toThrow('Un compte avec cet email existe déjà.');
  });
});

describe('endpoints admin', () => {
  it('createCourse : POST /api/courses avec { titre, capacite }', async () => {
    fetchMock.mockResolvedValue(reponse(201, { id: 'c9' }));
    await createCourse({ titre: 'Physique', capacite: 20 });
    expect(appel().url).toMatch(/\/api\/courses$/);
    expect(appel().init.method).toBe('POST');
    expect(JSON.parse(appel().init.body as string)).toEqual({ titre: 'Physique', capacite: 20 });
  });

  it('updateCourse : PATCH /api/courses/:id avec le corps partiel', async () => {
    fetchMock.mockResolvedValue(reponse(200, { id: 'c9' }));
    await updateCourse('c9', { capacite: 30 });
    expect(appel().url).toMatch(/\/api\/courses\/c9$/);
    expect(appel().init.method).toBe('PATCH');
    expect(JSON.parse(appel().init.body as string)).toEqual({ capacite: 30 });
  });

  it('deleteCourse : DELETE /api/courses/:id', async () => {
    fetchMock.mockResolvedValue(reponse(204));
    await deleteCourse('c9');
    expect(appel().url).toMatch(/\/api\/courses\/c9$/);
    expect(appel().init.method).toBe('DELETE');
  });

  it('getEnrollmentsByCourse : GET /api/enrollments/by-course/:coursId', async () => {
    fetchMock.mockResolvedValue(reponse(200, []));
    await expect(getEnrollmentsByCourse('c9')).resolves.toEqual([]);
    expect(appel().url).toMatch(/\/api\/enrollments\/by-course\/c9$/);
  });
});
