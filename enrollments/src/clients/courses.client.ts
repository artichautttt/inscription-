import { PlusDePlaceException, RessourceIntrouvableException } from '../common/errors';

/** Cours tel que renvoyé par le Service Cours (Dev A). */
export interface Cours {
  id: string;
  titre: string;
  capacite: number;
  placesRestantes: number;
}

/**
 * Contrat de consommation du Service Cours (Dev A).
 * Contrat OpenAPI :
 *   GET   /courses/{id}       -> 200 {id, titre, capacite, placesRestantes} | 404
 *   PATCH /courses/{id}/seats -> 200 (décrémente placesRestantes) | 409 si 0
 */
export abstract class CoursesClient {
  abstract findById(id: string): Promise<Cours | null>;
  /** Décrémente placesRestantes ; lève PlusDePlaceException si déjà à 0. */
  abstract decrementSeats(id: string): Promise<void>;
  /** Restitue une place (ex: suite à une annulation d'inscription). */
  abstract incrementSeats(id: string): Promise<void>;
}

/**
 * Implémentation MOCKÉE (Jalon 1).
 * À remplacer au Jalon 2 par un vrai client HTTP vers COURSES_SERVICE_URL.
 */
export class MockCoursesClient extends CoursesClient {
  static readonly SEED: Cours[] = [
    { id: '22222222-2222-4222-8222-222222222222', titre: 'Introduction au test logiciel', capacite: 30, placesRestantes: 3 },
    { id: '33333333-3333-4333-8333-333333333333', titre: 'Bases de données', capacite: 20, placesRestantes: 0 },
  ];

  private readonly cours = new Map<string, Cours>();

  constructor(seed: Cours[] = MockCoursesClient.SEED) {
    super();
    for (const c of seed) this.cours.set(c.id, { ...c });
  }

  async findById(id: string): Promise<Cours | null> {
    const c = this.cours.get(id);
    return c ? { ...c } : null;
  }

  async decrementSeats(id: string): Promise<void> {
    const c = this.cours.get(id);
    if (!c) throw new RessourceIntrouvableException(`Cours ${id} introuvable.`);
    if (c.placesRestantes <= 0) throw new PlusDePlaceException();
    c.placesRestantes -= 1;
  }

  async incrementSeats(id: string): Promise<void> {
    const c = this.cours.get(id);
    if (!c) throw new RessourceIntrouvableException(`Cours ${id} introuvable.`);
    c.placesRestantes += 1;
  }
}

/**
 * Implémentation HTTP réelle (Jalon 2).
 * Appelle le Service Cours via HTTP REST.
 */
export class HttpCoursesClient extends CoursesClient {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.COURSES_SERVICE_URL ?? 'http://localhost:3002') {
    super();
    this.baseUrl = baseUrl;
  }

  async findById(id: string): Promise<Cours | null> {
    try {
      const res = await fetch(`${this.baseUrl}/courses/${id}`);
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return (await res.json()) as Cours;
    } catch {
      return null;
    }
  }

  async decrementSeats(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/courses/${id}/seats`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: -1 }),
    });

    if (res.status === 404) {
      throw new RessourceIntrouvableException(`Cours ${id} introuvable.`);
    }
    if (res.status === 409) {
      throw new PlusDePlaceException();
    }
    if (!res.ok) {
      throw new Error(`Erreur lors de la mise à jour des places: ${res.statusText}`);
    }
  }

  async incrementSeats(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/courses/${id}/seats`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: 1 }),
    });

    if (res.status === 404) {
      throw new RessourceIntrouvableException(`Cours ${id} introuvable.`);
    }
    if (!res.ok) {
      throw new Error(`Erreur lors de la restitution de place: ${res.statusText}`);
    }
  }
}
