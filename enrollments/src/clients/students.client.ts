/** Étudiant tel que renvoyé par le Service Étudiants (Dev A). */
export interface Etudiant {
  id: string;
  nom: string;
  email: string;
  prenom?: string | null;
  telephone?: string | null;
}

/**
 * Contrat de consommation du Service Étudiants (Dev A).
 * On code contre CETTE interface, pas contre l'implémentation réelle.
 * Contrat OpenAPI : GET /students/{id} -> 200 {id, nom, email} | 404
 */
export abstract class StudentsClient {
  /** Retourne l'étudiant, ou null si le service répondrait 404. */
  abstract findById(id: string): Promise<Etudiant | null>;
}

/**
 * Implémentation MOCKÉE (Jalon 1).
 * À remplacer au Jalon 2 par un vrai client HTTP vers STUDENTS_SERVICE_URL.
 */
export class MockStudentsClient extends StudentsClient {
  static readonly SEED: Etudiant[] = [
    { id: '11111111-1111-4111-8111-111111111111', nom: 'Dupont', email: 'jean.dupont@example.com' },
  ];

  private readonly etudiants = new Map<string, Etudiant>();

  constructor(seed: Etudiant[] = MockStudentsClient.SEED) {
    super();
    for (const e of seed) this.etudiants.set(e.id, e);
  }

  async findById(id: string): Promise<Etudiant | null> {
    return this.etudiants.get(id) ?? null;
  }
}

/**
 * Implémentation HTTP réelle (Jalon 2).
 * Appelle le Service Étudiants via HTTP REST.
 */
export class HttpStudentsClient extends StudentsClient {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.STUDENTS_SERVICE_URL ?? 'http://localhost:3001') {
    super();
    this.baseUrl = baseUrl;
  }

  async findById(id: string): Promise<Etudiant | null> {
    try {
      const res = await fetch(`${this.baseUrl}/students/${id}`);
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return (await res.json()) as Etudiant;
    } catch {
      return null;
    }
  }
}
