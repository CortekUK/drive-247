/**
 * `lib/scrollport.ts` — the one place that knows WHICH box scrolls.
 *
 * v1 scrolls the window. v2, since the fixed frame (Sep 23 2026), scrolls
 * `<main>` and nothing above it in the column moves at all. Three measurers
 * ("how much room is left below me on screen") went through this helper:
 * `list-table-v2.tsx`, `rentals-v2/rental-onboarding-shell.tsx` and
 * `rentals/calendar/calendar-view.tsx`.
 *
 * THE INVARIANT THAT MAKES THAT SAFE, and the reason it is asserted twice
 * below: with the port at rest the two paths must return the SAME room. In the
 * fixed frame the port's padding-box top plus its client height IS the viewport
 * bottom (64 + 836 = 900), so `height - top` comes out identical either way.
 * Only once the port has scrolled do they differ, and then only the port path
 * is right — `window.scrollY` is permanently 0 when the window is not the
 * scroller, so the old expression slid with the page and fed back on itself.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scrollPortOf, scrollportFill } from '@/lib/scrollport';

/** Viewport 900 tall; the frame's bar is 64, so the port is 836 of padding box. */
const VIEWPORT = 900;
const BAR = 64;
const PORT_HEIGHT = VIEWPORT - BAR; // 836

const saved = {
  innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
  scrollY: Object.getOwnPropertyDescriptor(window, 'scrollY'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop'),
};

function setWindow(innerHeight: number, scrollY: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => innerHeight });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
}

/** jsdom lays nothing out, so every rect and every scroll offset is stated. */
function rectOf(el: HTMLElement, top: number) {
  el.getBoundingClientRect = () =>
    ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
}

function makePort(scrollTop: number, portTop = BAR) {
  const port = document.createElement('main');
  port.setAttribute('data-scrollport', '');
  rectOf(port, portTop);
  Object.defineProperty(port, 'clientHeight', { configurable: true, get: () => PORT_HEIGHT });
  Object.defineProperty(port, 'scrollTop', { configurable: true, get: () => scrollTop });
  document.body.appendChild(port);
  return port;
}

afterEach(() => {
  document.body.innerHTML = '';
  for (const [key, desc] of Object.entries(saved)) {
    const target = key === 'innerHeight' || key === 'scrollY' ? window : HTMLElement.prototype;
    if (desc) Object.defineProperty(target, key, desc);
    else delete (target as unknown as Record<string, unknown>)[key];
  }
});

describe('scrollPortOf', () => {
  it('is null under v1, where the window scrolls the document', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(scrollPortOf(el)).toBeNull();
  });

  it('finds the nearest marked box, and never the v1 inset that only LOOKS scrollable', () => {
    // v1's SidebarInset carries `overflow-x-hidden`, which forces overflow-y to
    // compute to `auto` — so a computed-style walk would stop there, at a box
    // that grows with its content and never scrolls. The marker cannot.
    const inset = document.createElement('main');
    inset.className = 'overflow-x-hidden';
    const port = makePort(0);
    inset.appendChild(port);
    const el = document.createElement('div');
    port.appendChild(el);
    document.body.appendChild(inset);
    expect(scrollPortOf(el)).toBe(port);
  });

  it('answers for the port itself, not only its descendants', () => {
    const port = makePort(0);
    expect(scrollPortOf(port)).toBe(port);
  });
});

describe('scrollportFill', () => {
  it('v1: document coordinates and the window height, exactly as before', () => {
    setWindow(VIEWPORT, 120);
    const el = document.createElement('div');
    rectOf(el, 300);
    document.body.appendChild(el);
    // 300 in the viewport, 120 already scrolled away => 420 down the document.
    expect(scrollportFill(el)).toEqual({ top: 420, height: VIEWPORT });
  });

  it('v2: coordinates inside the scrollport, and the scrollport height', () => {
    setWindow(VIEWPORT, 0);
    const port = makePort(200);
    const el = document.createElement('div');
    // 200px scrolled: something 436 down the port's content sits at 64+436-200.
    rectOf(el, BAR + 436 - 200);
    port.appendChild(el);
    expect(scrollportFill(el)).toEqual({ top: 436, height: PORT_HEIGHT });
  });

  it('v2: the same answer however far the port has scrolled', () => {
    setWindow(VIEWPORT, 0);
    for (const scrolled of [0, 200, 1000]) {
      document.body.innerHTML = '';
      const port = makePort(scrolled);
      const el = document.createElement('div');
      rectOf(el, BAR + 400 - scrolled);
      port.appendChild(el);
      // 836 - 400 = 436 of room below it, at every scroll offset.
      const { top, height } = scrollportFill(el);
      expect({ scrolled, room: height - top }).toEqual({ scrolled, room: 436 });
    }
  });

  it('agrees with the window path at rest, which is what makes the migration safe', () => {
    // The same element, same place on screen (400px down the port, so 464px
    // down the viewport), measured both ways.
    setWindow(VIEWPORT, 0);
    const port = makePort(0);
    const inPort = document.createElement('div');
    rectOf(inPort, BAR + 400);
    port.appendChild(inPort);

    const loose = document.createElement('div');
    rectOf(loose, BAR + 400);
    document.body.appendChild(loose);

    const a = scrollportFill(inPort); // { top: 400, height: 836 }
    const b = scrollportFill(loose); // { top: 464, height: 900 }
    expect(a).toEqual({ top: 400, height: PORT_HEIGHT });
    expect(b).toEqual({ top: 464, height: VIEWPORT });
    expect(a.height - a.top).toBe(436);
    expect(b.height - b.top).toBe(436);
  });

  it('measures from the PADDING box: a bordered port does not shift the answer', () => {
    setWindow(VIEWPORT, 0);
    const port = makePort(0, 60);
    Object.defineProperty(port, 'clientTop', { configurable: true, get: () => 4 });
    const el = document.createElement('div');
    // Border box at 60, so the scrollport starts at 64 — the element 400 down
    // the content sits at 464 on screen.
    rectOf(el, 464);
    port.appendChild(el);
    expect(scrollportFill(el)).toEqual({ top: 400, height: PORT_HEIGHT });
  });
});
