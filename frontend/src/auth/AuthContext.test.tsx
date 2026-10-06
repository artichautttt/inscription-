import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import * as api from '../api';
import { eleve, seedSession } from '../test/utils';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  login: vi.fn(),
  register: vi.fn(),
}));
const mockedApi = vi.mocked(api);

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthContext', () => {
  it('useAuth hors <AuthProvider> lève une erreur explicite', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth doit être utilisé dans <AuthProvider>');
  });

  it("se réhydrate depuis localStorage (token + user)", () => {
    seedSession(eleve);
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toEqual(eleve);
  });

  it('ignore un auth_user sans token ou corrompu', () => {
    localStorage.setItem('auth_user', JSON.stringify(eleve));
    expect(renderHook(() => useAuth(), { wrapper }).result.current.user).toBeNull();

    localStorage.setItem('auth_token', 't');
    localStorage.setItem('auth_user', '{pas du json');
    expect(renderHook(() => useAuth(), { wrapper }).result.current.user).toBeNull();
  });

  it('login stocke token + user et met à jour le contexte', async () => {
    mockedApi.login.mockResolvedValue({ token: 'jwt', user: eleve });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.login('eleve@test.com', 'eleve123'));

    expect(result.current.user).toEqual(eleve);
    expect(localStorage.getItem('auth_token')).toBe('jwt');
  });

  it('register auto-connecte le nouvel élève', async () => {
    mockedApi.register.mockResolvedValue({ token: 'jwt2', user: eleve });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() =>
      result.current.register({ nom: 'Test', prenom: 'Elena', email: 'e@t.c', telephone: '1', password: '123456' }),
    );

    expect(result.current.user).toEqual(eleve);
    expect(localStorage.getItem('auth_token')).toBe('jwt2');
  });

  it('logout purge localStorage et le contexte', () => {
    seedSession(eleve);
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.logout());

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('auth_user')).toBeNull();
  });

  it("reflète un logout fait dans un autre onglet (événement storage)", () => {
    seedSession(eleve);
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', newValue: null }));
    });

    expect(result.current.user).toBeNull();
  });
});
