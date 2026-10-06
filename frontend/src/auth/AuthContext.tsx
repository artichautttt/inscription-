import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RegisterPayload, User } from '../types';
import {
  clearToken,
  getToken,
  login as apiLogin,
  register as apiRegister,
  setToken,
} from '../api';

interface AuthState {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

const USER_KEY = 'auth_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  // Hydratation : si on a un user+token en localStorage, on repart avec.
  const [user, setUser] = useState<User | null>(() => {
    const token = getToken();
    const raw = localStorage.getItem(USER_KEY);
    if (!token || !raw) return null;
    try { return JSON.parse(raw) as User; } catch { return null; }
  });

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setToken(res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const res = await apiRegister(payload);
    // Le backend renvoie deja {token, user} => on connecte directement l'eleve.
    setToken(res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Si le token disparait dans un autre onglet, on reflète le logout.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'auth_token' && !e.newValue) setUser(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
