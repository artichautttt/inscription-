// Entrée "/vitest" de jest-dom : enregistre les matchers ET leurs types sur l'expect de Vitest.
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
