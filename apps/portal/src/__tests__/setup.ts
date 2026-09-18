import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

/**
 * Web Storage, when the environment hands us a hollow one.
 *
 * Under Node 25 `window.localStorage` in this jsdom environment resolves to a
 * bare `{}`: no getItem, no clear, nothing. Every suite that stores anything
 * then dies in its own `beforeEach` on "localStorage.clear is not a function"
 * — dev-page-gate, use-first-rental-tour, banner-stack, empty-state-preview,
 * first-time-sequence and the integration-pin suites, ~100 tests that never
 * reach an assertion, plus an unhandled rejection from the Supabase auth
 * client, which reads storage while it loads a session.
 *
 * So: install a real in-memory Storage, but ONLY when the one we were given
 * cannot store. On an environment whose storage works, this leaves it alone.
 */
function installStorage(name: 'localStorage' | 'sessionStorage') {
  const existing = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (existing && typeof existing.clear === 'function') return;

  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    getItem: (key: string) => (entries.has(String(key)) ? entries.get(String(key))! : null),
    setItem: (key: string, value: string) => void entries.set(String(key), String(value)),
    removeItem: (key: string) => void entries.delete(String(key)),
    clear: () => entries.clear(),
  };

  for (const target of [window, globalThis]) {
    Object.defineProperty(target, name, { value: storage, configurable: true, writable: true });
  }
}

installStorage('localStorage');
installStorage('sessionStorage');

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
