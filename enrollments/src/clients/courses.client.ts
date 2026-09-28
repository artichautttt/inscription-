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
}

/**
 * Implémentation MOCKÉE (Jalon 1).
 * À remplacer au Jalon 2 par un vrai client HTTP vers COURSES_SERVICE_URL.
 */
export class MockCoursesClient extends CoursesClient {
  static readonly SEED: Cours[] = [
    { id: '22222222-2222-2222-2222-222222222222', titre: 'Introduction au test logiciel', capacite: 30, placesRestantes: 3 },
    { id: '33333333-3333-3333-3333-333333333333', titre: 'Bases de données', capacite: 20, placesRestantes: 0 },
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
}
