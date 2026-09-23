/**
 * The v2 menu surfaces must actually animate open and closed.
 *
 * Every one of these primitives shipped with the full shadcn enter/exit pair —
 * fade, 95% zoom, a slide from whichever side Radix picked — AND a blanket
 * `!animate-none` at the end of the same class string. `animation: none
 * !important` beats a `data-[state=open]:` rule whatever the order, so the
 * animations were dead from the first commit of the design system. The
 * complaint that reached us was "the dropdowns don't look professional", which
 * is what a panel that snaps into existence looks like.
 *
 * These assertions are on the RENDERED element, not on the source text, so a
 * refactor that moves or reformats the class string keeps passing — while
 * re-adding an unconditional `animate-none`, or dropping the exit half (which
 * `menubar`'s main content had lost), fails.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui-v2/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui-v2/dropdown-menu';

const ENTER = [
  'data-[state=open]:animate-in',
  'data-[state=open]:fade-in-0',
  'data-[state=open]:zoom-in-95',
] as const;

const EXIT = [
  'data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
] as const;

/**
 * Two jsdom gaps these primitives walk straight into. Patched here rather than
 * in the shared `setup.ts` so this suite carries its own requirements:
 *
 *  - Radix positions the panel with floating-ui, which calls
 *    `new ResizeObserver(...)`. The global mock in setup.ts is an ARROW
 *    function returning an object, so `new` on it throws "is not a
 *    constructor" — a class is needed, not a factory.
 *  - `Select` scrolls the selected item into view on open, and jsdom
 *    implements no `scrollIntoView` at all.
 */
beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    TestResizeObserver as unknown as typeof ResizeObserver;

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
});

let root: Root | null = null;
let host: HTMLElement | null = null;

const mount = async (ui: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
};

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
  document.body.innerHTML = '';
});

/** Radix portals its content, so look across the document, not inside `host`. */
const surfaceClasses = (selector: string): string[] => {
  const el = document.querySelector<HTMLElement>(selector);
  expect(el, `no element matched ${selector} — did the menu open?`).not.toBeNull();
  return el!.className.split(/\s+/);
};

describe('the v2 Select panel animates', () => {
  it('carries the full enter and exit pair, and no blanket animate-none', async () => {
    await mount(
      <Select open value="km">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent tone="surface" align="end">
          <SelectItem value="km">Kilometres</SelectItem>
          <SelectItem value="miles">Miles</SelectItem>
        </SelectContent>
      </Select>,
    );

    const classes = surfaceClasses('[data-slot="select-content"], [role="listbox"]');

    for (const token of [...ENTER, ...EXIT]) {
      expect(classes, token).toContain(token);
    }

    // THE REGRESSION. An unconditional `animate-none` (with or without `!`)
    // silently disables everything above it.
    expect(classes).not.toContain('animate-none');
    expect(classes).not.toContain('!animate-none');
  });

  it('keeps the one deliberate exception: item-aligned panels stay still', async () => {
    // `position="item-aligned"` lays the panel OVER the trigger with the
    // selected row on top of it; zooming that reads as the page jumping.
    await mount(
      <Select open value="km">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="item-aligned">
          <SelectItem value="km">Kilometres</SelectItem>
        </SelectContent>
      </Select>,
    );

    const classes = surfaceClasses('[data-slot="select-content"], [role="listbox"]');
    // Conditional, so it only suppresses the animation for that position — the
    // enter classes are still present for every other one.
    expect(classes).toContain('data-[align-trigger=true]:animate-none');
    expect(classes).toContain('data-[state=open]:animate-in');
  });
});

describe('the v2 dropdown menu panel animates', () => {
  it('has the same pair — it is the reference the others were measured against', async () => {
    await mount(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Profile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const classes = surfaceClasses('[data-slot="dropdown-menu-content"], [role="menu"]');
    for (const token of [...ENTER, ...EXIT]) {
      expect(classes, token).toContain(token);
    }
    expect(classes).not.toContain('animate-none');
    expect(classes).not.toContain('!animate-none');
  });
});
