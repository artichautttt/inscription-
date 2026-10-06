// Formes de données renvoyées par les services (via la gateway).

export type Role = 'ELEVE' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  nom: string;
  prenom?: string | null;
  telephone?: string | null;
  role: Role;
}

export interface Cours {
  id: string;
  titre: string;
  capacite: number;
  placesRestantes: number;
}

export interface Inscription {
  id: string;
  etudiantId: string;
  coursId: string;
  /** Titre du cours (enrichi par le service enrollments). "Cours supprimé" si cours disparu. */
  coursTitre?: string;
  statut: string;
  date: string;
}

/** Inscription enrichie côté admin : nom, prénom, email, téléphone de l'élève. */
export interface InscriptionAvecEtudiant extends Inscription {
  etudiantNom: string;
  etudiantPrenom: string;
  etudiantEmail: string;
  etudiantTelephone: string;
}

/** Payload d'inscription (sign-up) d'un nouvel élève. */
export interface RegisterPayload {
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// Erreur métier standard renvoyée par le backend : { code, message }.
export interface ApiError {
  code: string;
  message: string;
}
