/**
 * `isVisible` / `findAnchor` against the v2 overview flip.
 *
 * The flip keeps both faces laid out, so the face turned away still has a full
 * box. That face is marked `inert` at once and `visibility: hidden` once the
 * turn settles. A tour started with the filters open must treat the stat cards
 * on it as absent and fall back to the step's next anchor.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { findAnchor, isVisible } from '@/lib/first-rental-tour';

let root: HTMLElement | null = null;

/** Mount markup and give every element a real box; jsdom's are all zero. */
function mount(html: string): HTMLElement {
  root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    el.getBoundingClientRect = () => ({ width: 240, height: 80 }) as DOMRect;
  }
  return root;
}

const stats = () => root!.querySelector('[data-tour="customers-stats"]')!;

afterEach(() => {
  root?.remove();
  root = null;
});

describe('tour anchors on the v2 overview flip', () => {
  it('counts a laid-out, shown element as visible', () => {
    mount('<div data-tour="customers-stats">cards</div>');
    expect(isVisible(stats())).toBe(true);
  });

  it('does not count an element with no box', () => {
    mount('<div data-tour="customers-stats">cards</div>');
    (stats() as HTMLElement).getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    expect(isVisible(stats())).toBe(false);
  });

  it('does not count an element on the inert face', () => {
    mount('<div inert><div data-tour="customers-stats">cards</div></div>');
    expect(isVisible(stats())).toBe(false);
  });

  it('does not count an element on a face hidden with visibility', () => {
    mount('<div style="visibility: hidden"><div data-tour="customers-stats">cards</div></div>');
    expect(isVisible(stats())).toBe(false);
  });

  it("falls back to the step's next anchor while the filters are showing", () => {
    mount(`
      <h1>Customers</h1>
      <div inert aria-hidden="true"><div data-tour="customers-stats">cards</div></div>
      <div><div>filters</div></div>
    `);
    expect(findAnchor(['[data-tour="customers-stats"]', 'h1'], root!)?.tagName).toBe('H1');
  });
});
