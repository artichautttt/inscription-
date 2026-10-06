import type {
  Cours,
  Inscription,
  InscriptionAvecEtudiant,
  LoginResponse,
  RegisterPayload,
} from './types';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'auth_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Petit utilitaire : fait un fetch avec Bearer token si disponible, puis parse
 * la réponse. Si le backend renvoie une erreur ({ code, message }), lève une
 * Error avec le message pour l'affichage.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });

  // 204 No Content : rien à parser
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(data?.message ?? `Erreur HTTP ${res.status}`);
  }
  return data as T;
}

// ---- Auth ----
export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/** Inscription publique : crée un compte ELEVE et renvoie {token, user} (auto-login). */
export function register(payload: RegisterPayload): Promise<LoginResponse> {
  return request<LoginResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---- Catalogue ----
export function getCourses(): Promise<Cours[]> {
  return request<Cours[]>('/api/courses');
}

export function createCourse(data: { titre: string; capacite: number }): Promise<Cours> {
  return request<Cours>('/api/courses', { method: 'POST', body: JSON.stringify(data) });
}

export function updateCourse(id: string, data: Partial<{ titre: string; capacite: number }>): Promise<Cours> {
  return request<Cours>(`/api/courses/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteCourse(id: string): Promise<void> {
  return request<void>(`/api/courses/${id}`, { method: 'DELETE' });
}

// ---- Inscriptions ----
/** etudiantId est tiré du token côté gateway, pas besoin de le passer. */
export function createEnrollment(coursId: string): Promise<Inscription> {
  return request<Inscription>('/api/enrollments', {
    method: 'POST',
    body: JSON.stringify({ coursId }),
  });
}

export function getMyEnrollments(): Promise<Inscription[]> {
  return request<Inscription[]>('/api/enrollments');
}

export function deleteEnrollment(id: string): Promise<void> {
  return request<void>(`/api/enrollments/${id}`, { method: 'DELETE' });
}

/** ADMIN : liste des élèves inscrits à un cours (nom + email). */
export function getEnrollmentsByCourse(coursId: string): Promise<InscriptionAvecEtudiant[]> {
  return request<InscriptionAvecEtudiant[]>(`/api/enrollments/by-course/${coursId}`);
}
