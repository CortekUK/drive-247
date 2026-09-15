/**
 * components/shared/hero-chart-v2.tsx: the headline, its change chip, the
 * second line and what is no longer drawn. Numbers worked by hand.
 *
 * "Today" is Tue 15 Sep 2026, 14:00 local. Last 30 days is Aug 17 .. Sep 15;
 * the previous 30 days are Jul 18 .. Aug 16.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { HeroChart, type HeroMetric } from '@/components/shared/hero-chart-v2';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const TODAY = new Date(2026, 8, 15, 14, 0);
const at = (m: number, d: number) => new Date(2026, m - 1, d, 12);
const events = (m: number, d: number, n: number, amount = 1) => Array.from({ length: n }, () => ({ at: at(m, d), amount }));

const summary = () => document.querySelector('p.sr-only')?.textContent;
const chip = () => document.querySelector('[data-change]');

describe('HeroChart: flow', () => {
  // Current: 3 on Sep 10. Previous: 4 on Aug 10. (3 - 4) / 4 = -25%.
  // Second line: 2 on Sep 12 in the current window, 5 on Aug 12 in the previous one (not counted).
  const metric: HeroMetric = {
    key: 'bookings',
    label: 'New bookings',
    kind: 'flow',
    format: (v) => v.toLocaleString(),
    events: [...events(9, 10, 3), ...events(8, 10, 4)],
    secondary: { label: 'Picked up', events: [...events(9, 12, 2), ...events(8, 12, 5)] },
  };

  it('headlines the total with a down chip and the previous total in words', () => {
    const { container } = render(<HeroChart metrics={[metric]} today={TODAY} />);
    expect(summary()).toBe('New bookings, last 30 days: 3. Previous 30 days: 4. Picked up, last 30 days: 2.');
    expect(chip()?.getAttribute('data-change')).toBe('down');
    expect(chip()?.textContent).toBe('25%');
    expect(container.textContent).toContain('vs 4 previous 30 days');
  });

  it('names the second line in a legend with its own total', () => {
    render(<HeroChart metrics={[metric]} today={TODAY} />);
    const legendEntry = screen.getByText('Picked up').closest('span');
    expect(legendEntry?.textContent).toBe('Picked up2');
  });

  it('draws no axis labels and no legend without a second line', () => {
    const { secondary: _drop, ...single } = metric as HeroMetric & { secondary?: unknown };
    render(<HeroChart metrics={[single as HeroMetric]} today={TODAY} />);
    expect(screen.queryByText('Aug 17')).toBeNull();
    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.queryByText('Picked up')).toBeNull();
    expect(summary()).toBe('New bookings, last 30 days: 3. Previous 30 days: 4.');
  });

  it('shows no chip when the previous period had nothing', () => {
    render(<HeroChart metrics={[{ ...metric, events: events(9, 10, 3) }]} today={TODAY} />);
    expect(chip()).toBeNull();
  });

  it('shows a flat chip when the totals match', () => {
    render(<HeroChart metrics={[{ ...metric, events: [...events(9, 10, 4), ...events(8, 10, 4)] }]} today={TODAY} />);
    expect(chip()?.getAttribute('data-change')).toBe('flat');
    expect(chip()?.textContent).toBe('0%');
  });
});

describe('HeroChart: stock', () => {
  // 6 today, 1 on Aug 16 (today's date one period back): up 5 cars, not a percentage.
  const metric: HeroMetric = {
    key: 'on-rent',
    label: 'Cars on rent',
    kind: 'stock',
    format: (v) => v.toLocaleString(),
    suffix: 'of 8 cars',
    valueOn: (day) => (day.getMonth() === 8 && day.getDate() === 15 ? 6 : 1),
    secondary: { label: 'Fleet', valueOn: () => 8 },
  };

  it('moves by cars, and reads the comparison as a day', () => {
    const { container } = render(<HeroChart metrics={[metric]} today={TODAY} />);
    expect(summary()).toBe('Cars on rent today: 6 of 8 cars. On Aug 16: 1. Fleet today: 8.');
    expect(chip()?.getAttribute('data-change')).toBe('up');
    expect(chip()?.textContent).toBe('5');
    expect(container.textContent).toContain('vs 1 on Aug 16');
  });
});
