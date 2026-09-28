import type { Cours, Inscription } from './types';

// Le front n'appelle QUE la gateway. Base d'URL lue depuis .env.
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * Petit utilitaire : fait un fetch et, si le backend renvoie une erreur
 * ({ code, message }), lève une Error avec ce message pour l'afficher.
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    // data = { code, message } renvoyé par le backend
    throw new Error(data.message ?? 'Erreur inconnue');
  }
  return data as T;
}

// ---- Catalogue (service Cours, via la gateway) ----
export function getCourses(): Promise<Cours[]> {
  return request<Cours[]>('/api/courses');
}

// ---- Inscriptions (ton service, via la gateway) ----
export function createEnrollment(etudiantId: string, coursId: string): Promise<Inscription> {
  return request<Inscription>('/api/enrollments', {
    method: 'POST',
    body: JSON.stringify({ etudiantId, coursId }),
  });
}

export function getMyEnrollments(etudiantId: string): Promise<Inscription[]> {
  return request<Inscription[]>(`/api/enrollments?etudiantId=${etudiantId}`);
}
