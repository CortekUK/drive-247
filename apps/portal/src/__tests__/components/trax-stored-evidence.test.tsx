// @vitest-environment jsdom

/**
 * Reopening a stored TRAX conversation must not be able to take down the portal.
 *
 * Reported 2 Oct 2026: opening Conversation history and reopening one thread
 * replaced the whole app with "The portal didn't load". That screen is
 * global-error.tsx — the last-resort boundary — which is where a throw inside
 * the TRAX panel lands, because the panel is mounted in the providers and so
 * sits above every segment error.tsx.
 *
 * The throw was `result.checks.length` on an evidence entry that had no
 * `checks`. Live replies cannot do this: `call()` rejects any response whose
 * evidence entries are missing their arrays. Resumed messages skip that check
 * entirely — they are rendered straight out of storage, where an older shape
 * can still be sitting.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { ChatMessage } = await import('@/components/trax/support/ChatMessage');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { createElement } = await import('react');

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* ChatMessage reaches for a query client; the crash under test is in its own
   render, so the provider is scaffolding, not the subject. */
const render = (message: unknown) =>
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(ChatMessage as never, { message } as never),
      ),
    );
  });

const base = { id: 'm1', role: 'assistant' as const, content: 'Here is what I found.', timestamp: new Date('2026-10-02T21:51:00Z') };

describe('a stored message with half-written evidence', () => {
  it('renders instead of throwing when an entry has no checks', () => {
    expect(() =>
      render({ ...base, evidence: [{ status: 'verified', observedAt: '2026-10-02T21:00:00Z', findings: [], limitations: [] }] }),
    ).not.toThrow();
    expect(container.textContent).toContain('Here is what I found.');
  });

  it('survives an entry that is missing every array', () => {
    expect(() => render({ ...base, evidence: [{ status: 'error', observedAt: '2026-10-02T21:00:00Z' }] })).not.toThrow();
  });

  it('survives navigation that is not an array', () => {
    expect(() => render({ ...base, navigation: 'open-the-thing' })).not.toThrow();
  });

  it('still shows a well-formed entry', () => {
    render({
      ...base,
      evidence: [{ status: 'verified', observedAt: '2026-10-02T21:00:00Z', checks: ['rental_occupancy'], findings: [{ summary: 'Two vehicles are out.' }], limitations: [] }],
    });
    expect(container.textContent).toContain('Two vehicles are out.');
  });
});
