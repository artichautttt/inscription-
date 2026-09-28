// Formes de données renvoyées par les services (via la gateway).

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
  statut: string;
  date: string;
}

// Erreur métier standard renvoyée par le backend : { code, message }.
export interface ApiError {
  code: string;
  message: string;
}
