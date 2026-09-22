/**
 * The Trax mark's sizes. `xs` was added for the top bar's Help button (team
 * lead, Sep 20 2026), with a lighter lift than the rest: the larger marks'
 * 14px bloom is tuned for 28px and up. This pins that the three sizes that
 * already existed — the panel header, the rail and the greeting — kept their
 * box, glyph and shadow exactly, so the new size changed nothing on screens
 * that were not asked about.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => null }));

import { TraxMark } from '@/components/trax/trax-greeting';

const BLOOM = 'shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.55)]';

function markOf(size: 'xs' | 'sm' | 'md' | 'lg') {
  const { container } = render(<TraxMark size={size} />);
  const mark = container.querySelector<HTMLElement>('[data-slot="trax-mark"]')!;
  return { mark, cls: mark.className.split(/\s+/), html: mark.innerHTML };
}

describe('TraxMark sizes', () => {
  it.each([
    ['sm', 'size-7', 'size-3.5'],
    ['md', 'size-10', 'size-5'],
    ['lg', 'size-14', 'size-7'],
  ] as const)('%s keeps its box, glyph and bloom', (size, box, icon) => {
    const { cls, mark, html } = markOf(size);
    expect(cls).toContain(box);
    expect(mark.querySelector('svg')!.getAttribute('class')).toContain(icon);
    expect(html).toContain(BLOOM);
  });

  it('xs is a 20px badge with a 12px glyph and the small lift, never the bloom', () => {
    const { cls, mark, html } = markOf('xs');
    expect(cls).toContain('size-5');
    expect(mark.querySelector('svg')!.getAttribute('class')).toContain('size-3');
    expect(html).toContain('shadow-[0_2px_6px_-2px_hsl(var(--primary)/0.5)]');
    expect(html).not.toContain(BLOOM);
  });

  it('is decorative at every size: the control around it carries the name', () => {
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      expect(markOf(size).mark.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
