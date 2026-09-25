/**
 * Finance Sync had no QueryClient, and took the page down.
 *
 * Opening it threw `No QueryClient set, use QueryClientProvider to set one`,
 * which is an uncaught error during render, so Next replaced the whole screen
 * with "Application error: a client-side exception has occurred".
 *
 * The cause was not subtle once the console message arrived: `useQuery` has
 * exactly one consumer in this app, and the app had no `QueryClientProvider`
 * anywhere in its tree. It has been that way since finance-sync was built
 * (792bf44c) — the section was a tab nobody pressed, and it only became
 * obvious when it moved into the rail.
 *
 * Two tests, because there are two ways to get this wrong again: the shell can
 * stop providing a client, or a second component can start using react-query
 * somewhere the provider does not reach.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const ROOT = resolve(__dirname, '../..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain;
      chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
      return chain;
    },
  },
}));

import { FinanceEventsTab } from '@/components/admin/finance-events-tab';

describe('the finance tab has a QueryClient to talk to', () => {
  it('mounts inside a provider without throwing', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(() =>
      render(
        <QueryClientProvider client={client}>
          <FinanceEventsTab tenantId="tenant-1" />
        </QueryClientProvider>,
      ),
    ).not.toThrow();
  });

  it('throws without one, which is what production was doing', () => {
    // Pins the failure mode this guards. If a future react-query stops
    // throwing here, the first test alone would no longer prove anything.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<FinanceEventsTab tenantId="tenant-1" />)).toThrow(/QueryClient/i);
    spy.mockRestore();
  });

  it('is given one by the shell every page renders inside', () => {
    const layout = src('app/admin/(protected)/layout.tsx');
    expect(layout).toContain('<QueryClientProvider client={queryClient}>');
    // Per mount, not at module scope: a module-level client is shared by every
    // render on a server, which is how one account reads another's cache.
    expect(layout).toContain('useState(() => new QueryClient())');
  });

  it('has no react-query consumer outside that shell', () => {
    // The login screen and the design preview render outside `(protected)`.
    // A `useQuery` there would fail exactly as Finance Sync did.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') walk(full);
        } else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(resolve(ROOT, 'app'));
    walk(resolve(ROOT, 'components'));

    const outside = files.filter((f) => {
      const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (rel.includes('(protected)') || rel.startsWith('components/')) return false;
      return /\buseQuery\(|\buseMutation\(/.test(readFileSync(f, 'utf8'));
    });
    expect(outside).toEqual([]);
  });
});
