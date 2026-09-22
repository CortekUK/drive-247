/**
 * Vitest setup for apps/admin, mirroring apps/portal/src/__tests__/setup.ts.
 *
 * One deliberate difference: the portal imports "@testing-library/jest-dom",
 * this imports "@testing-library/jest-dom/vitest". Both register the same
 * matchers at runtime; the /vitest entry point also augments vitest's
 * `Assertion` type, which this app needs because its tsconfig has
 * `strict: true` and NO ignoreBuildErrors, and `npx tsc --noEmit` type-checks
 * every .ts file in the app — these test files included.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
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
 * bare `{}`: no getItem, no clear, nothing. Any suite that stores anything then
 * dies in its own `beforeEach` on "localStorage.clear is not a function" before
 * reaching an assertion. (apps/portal hit exactly this; the same Node and jsdom
 * versions serve both apps, so the same shim is here from the start.)
 *
 * So: install a real in-memory Storage, but ONLY when the one we were given
 * cannot store. On an environment whose storage works, this leaves it alone.
 */
function installStorage(name: 'localStorage' | 'sessionStorage'): void {
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

  for (const target of [window, globalThis] as unknown as Record<string, unknown>[]) {
    Object.defineProperty(target, name, { value: storage, configurable: true, writable: true });
  }
}

installStorage('localStorage');
installStorage('sessionStorage');

/**
 * ResizeObserver and IntersectionObserver, which jsdom does not implement.
 *
 * The portal writes these as `vi.fn().mockImplementation(() => ({ observe… }))`.
 * That does NOT survive `new`: under Vitest 4 an arrow-function implementation
 * makes the mock non-constructible, so `new ResizeObserver(cb)` throws
 * "… is not a constructor" (Vitest even warns, "The vi.fn() mock did not use
 * 'function' or 'class' in its implementation"). It goes unnoticed in the
 * portal only because nothing there constructs one directly — but any Radix
 * or recharts component that does would take the whole suite down. So this
 * copy uses a `function` implementation: still a vi.fn (calls are tracked,
 * `.mock.instances` works), and actually constructible.
 */
function observerMock(extra: Record<string, unknown> = {}) {
  return vi.fn(function (this: Record<string, unknown>) {
    this.observe = vi.fn();
    this.unobserve = vi.fn();
    this.disconnect = vi.fn();
    this.takeRecords = vi.fn(() => []);
    Object.assign(this, extra);
  });
}

global.ResizeObserver = observerMock() as unknown as typeof ResizeObserver;
global.IntersectionObserver = observerMock({
  root: null,
  rootMargin: "0px",
  thresholds: [] as readonly number[],
}) as unknown as typeof IntersectionObserver;
