// @vitest-environment jsdom

/**
 * Replay a REAL stored TRAX conversation through the real message renderer.
 *
 * Reopening one from history was replacing the portal with global-error's
 * "The portal didn't load". Reasoning about which field might be malformed kept
 * coming up empty — the stored evidence, payment cards and chart groups all
 * turned out well-formed — so this renders the actual transcript, taken from
 * trax_support_conversations, exactly as the resume path hands it over.
 *
 * The fixture is that conversation as stored, with every record UUID remapped to
 * a placeholder — the shapes are untouched, including the one-element `sources`
 * array holding a single `null` on the last turn, which is the one that threw.
 *
 * If this passes, the throw is not in rendering a resumed message and the hunt
 * moves elsewhere. If it fails, the stack says where.
 */

import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import transcript from '../fixtures/trax-stored-transcript.json';
const { ChatMessage } = await import('@/components/trax/support/ChatMessage');

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* The shared setup stubs ResizeObserver with an arrow function, which
     recharts cannot . A real class, only for this file. */
  class RO { observe() {} unobserve() {} disconnect() {} }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: RO });
  // recharts measures; jsdom reports zero, which it tolerates.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 640 });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 320 });
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

/* Exactly what use-trax-support does with resumedMessages. */
const asMessage = (turn: Record<string, unknown>) => ({
  id: String(Math.random()),
  role: turn.role,
  content: turn.content,
  sources: turn.sources,
  provenance: turn.provenance,
  evidence: turn.evidence,
  navigation: turn.navigation,
  canRecheck: turn.canRecheck,
  timestamp: new Date(turn.at as string),
});

describe('the stored conversation that crashed the portal', () => {
  const turns = transcript as unknown as Record<string, unknown>[];

  it('has turns to replay', () => {
    expect(turns.length).toBeGreaterThan(0);
  });

  it.each(turns.map((t, i) => [i, t] as const))('renders turn %i without throwing', (_i, turn) => {
    expect(() =>
      act(() => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
            createElement(ChatMessage as never, { message: asMessage(turn) } as never),
          ),
        );
      }),
    ).not.toThrow();
  });
});
