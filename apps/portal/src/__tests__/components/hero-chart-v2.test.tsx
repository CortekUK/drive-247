/**
 * components/shared/hero-chart-v2.tsx: the headline, its change chip, the
 * legend, "All time" and what is no longer drawn. Numbers worked by hand.
 *
 * "Today" is Tue 15 Sep 2026, 14:00 local. Last 30 days is Aug 17 .. Sep 15;
 * the previous 30 days are Jul 18 .. Aug 16.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

// The drawn points never reach jsdom's zero-sized chart, so the LineChart is
// wrapped to record the data it is handed.
const drawn = vi.hoisted(() => ({ data: null as null | Record<string, unknown>[] }));
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const LineChart = (props: React.ComponentProps<typeof actual.LineChart>) => {
    drawn.data = (props.data as Record<string, unknown>[]) ?? null;
    return <actual.LineChart {...props} />;
  };
  return { ...actual, LineChart };
});

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
/** Each legend entry's text, in order; null when no legend is drawn. */
const legend = () => {
  const row = document.querySelector('div.ml-auto[aria-hidden]');
  return row ? Array.from(row.children).map((entry) => entry.textContent) : null;
};

/** Opens the period picker and returns the periods it offers. */
const openPeriods = () => {
  fireEvent.keyDown(screen.getByRole('button', { name: /^Period:/ }), { key: 'Enter' });
  return screen.getAllByRole('menuitemradio').map((item) => item.textContent);
};
const choosePeriod = (label: string) => {
  openPeriods();
  fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
};

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

  it('headlines the total with a down chip, and names the previous total in the legend', () => {
    const { container } = render(<HeroChart metrics={[metric]} today={TODAY} />);
    expect(summary()).toBe('New bookings, last 30 days: 3. Previous 30 days: 4. Picked up, last 30 days: 2.');
    expect(chip()?.getAttribute('data-change')).toBe('down');
    expect(chip()?.textContent).toBe('25%');
    // No "vs 4 previous 30 days" sentence beside the number any more.
    expect(container.textContent).not.toMatch(/\bvs\b/);
    expect(screen.getByText('Previous 30 days').closest('span')?.textContent).toBe('Previous 30 days4');
  });

  it('names every line in one legend: the metric, the second line and the previous period with their totals', () => {
    render(<HeroChart metrics={[metric]} today={TODAY} />);
    expect(screen.getByText('Picked up').closest('span')?.textContent).toBe('Picked up2');
    expect(legend()).toEqual(['New bookings', 'Picked up2', 'Previous 30 days4']);
    // One markup for every entry, and one for every value.
    const row = document.querySelector('div.ml-auto[aria-hidden]')!;
    expect(new Set(Array.from(row.children).map((e) => e.className))).toEqual(new Set(['inline-flex items-center gap-1.5']));
    expect(row.children[0].children).toHaveLength(1); // the swatch; the big number is the metric's value
    expect(row.children[1].children[1].className).toBe(row.children[2].children[1].className);
    // The previous period's swatch is dotted, as in the tooltip.
    expect(row.children[2].children[0].className).toContain('border-dotted');
  });

  it('draws no axis labels, and without a second line the legend is the metric and the previous period', () => {
    const { secondary: _drop, ...single } = metric as HeroMetric & { secondary?: unknown };
    render(<HeroChart metrics={[single as HeroMetric]} today={TODAY} />);
    expect(screen.queryByText('Aug 17')).toBeNull();
    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.queryByText('Picked up')).toBeNull();
    expect(legend()).toEqual(['New bookings', 'Previous 30 days4']);
    expect(summary()).toBe('New bookings, last 30 days: 3. Previous 30 days: 4.');
  });

  it('shows no chip when the previous period had nothing, and the legend says it was 0', () => {
    render(<HeroChart metrics={[{ ...metric, events: events(9, 10, 3) }]} today={TODAY} />);
    expect(chip()).toBeNull();
    expect(legend()).toEqual(['New bookings', 'Picked up2', 'Previous 30 days0']);
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
    render(<HeroChart metrics={[metric]} today={TODAY} />);
    expect(summary()).toBe('Cars on rent today: 6 of 8 cars. On Aug 16: 1. Fleet today: 8.');
    expect(chip()?.getAttribute('data-change')).toBe('up');
    expect(chip()?.textContent).toBe('5');
    expect(legend()).toEqual(['Cars on rent', 'Fleet8', 'On Aug 161']);
  });

  it('does not offer All time without a history start', () => {
    render(<HeroChart metrics={[metric]} today={TODAY} />);
    expect(openPeriods()).toEqual(['Last 7 days', 'Last 30 days', 'Last 3 months', 'Last 12 months']);
  });

  it('offers All time with a history start, and reads today with nothing to compare', () => {
    // History from Sep 5: 11 days, one point a day. Today 6 of 8, Fleet 8.
    render(<HeroChart metrics={[{ ...metric, historyStart: at(9, 5) }]} today={TODAY} />);
    expect(openPeriods()).toContain('All time');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All time' }));
    expect(summary()).toBe('Cars on rent today: 6 of 8 cars. Fleet today: 8.');
    expect(screen.getByText('Cars on rent today')).toBeInTheDocument();
    expect(chip()).toBeNull();
    expect(legend()).toEqual(['Cars on rent', 'Fleet8']);
    expect(drawn.data).toHaveLength(11);
  });
});

describe('HeroChart: all time', () => {
  // Main line: 1 on Jun 1, 4 on Aug 10, 3 on Sep 10 (8 in all). Second line: 5
  // on May 20, 2 on Sep 12 (7 in all). Last 30 days: 3 against 4 (Jun 1 is in
  // neither window), and 2 picked up (May 20 is in neither).
  //
  // All time starts from ONE day for both lines, May 20, the earlier of the
  // two: May 20 .. Sep 15 is 12 + 30 + 31 + 31 + 15 = 119 days, so 17 weeks
  // exactly, from May 20. Days after May 20: Jun 1 is 12 (week 1), Aug 10 is 82
  // (week 11), Sep 10 is 113 and Sep 12 is 115 (both week 16).
  const flow: HeroMetric = {
    key: 'bookings',
    label: 'New bookings',
    kind: 'flow',
    format: (v) => v.toLocaleString(),
    events: [...events(9, 10, 3), ...events(8, 10, 4), ...events(6, 1, 1)],
    secondary: { label: 'Picked up', events: [...events(9, 12, 2), ...events(5, 20, 5)] },
  };
  const stockWithoutHistory: HeroMetric = {
    key: 'on-rent',
    label: 'Cars on rent',
    kind: 'stock',
    format: (v) => v.toLocaleString(),
    suffix: 'of 8 cars',
    valueOn: (day) => (day.getMonth() === 8 && day.getDate() === 15 ? 6 : 1),
    secondary: { label: 'Fleet', valueOn: () => 8 },
  };

  it('is offered for flow metrics', () => {
    render(<HeroChart metrics={[flow]} today={TODAY} />);
    expect(openPeriods()).toEqual(['Last 7 days', 'Last 30 days', 'Last 3 months', 'Last 12 months', 'All time']);
  });

  it('shows the all-time totals with no change chip, no previous legend entry and no previous sentence', () => {
    render(<HeroChart metrics={[flow]} today={TODAY} />);
    expect(summary()).toBe('New bookings, last 30 days: 3. Previous 30 days: 4. Picked up, last 30 days: 2.');
    expect(chip()?.getAttribute('data-change')).toBe('down');

    choosePeriod('All time');
    expect(screen.getByRole('button', { name: 'Period: All time' })).toBeInTheDocument();
    expect(summary()).toBe('New bookings, all time: 8. Picked up, all time: 7.');
    expect(chip()).toBeNull();
    expect(legend()).toEqual(['New bookings', 'Picked up7']);
    expect(screen.queryByText(/Previous/)).toBeNull();
    expect(document.querySelector('section')?.getAttribute('aria-label')).toBe('New bookings, all time');
  });

  it('buckets both lines from the one shared start, so they pair index by index', () => {
    render(<HeroChart metrics={[flow]} today={TODAY} />);
    choosePeriod('All time');
    const data = drawn.data!;
    expect(data).toHaveLength(17);
    expect(data.map((p) => p.current)).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 8]);
    expect(data.map((p) => p.secondary)).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7]);
    expect(data.every((p) => p.previous === null)).toBe(true);
    expect(data[0].currentLabel).toBe('May 20 – May 26');
    expect(data[16].currentLabel).toBe('Sep 9 – Sep 15');
  });

  it('is not offered when any metric cannot draw it', () => {
    render(<HeroChart metrics={[flow, stockWithoutHistory]} today={TODAY} />);
    expect(openPeriods()).not.toContain('All time');
  });

  it('falls back to the default period when the metrics change to ones that cannot draw it', () => {
    const { rerender } = render(<HeroChart metrics={[flow]} today={TODAY} />);
    choosePeriod('All time');
    expect(summary()).toBe('New bookings, all time: 8. Picked up, all time: 7.');
    rerender(<HeroChart metrics={[stockWithoutHistory]} today={TODAY} />);
    expect(screen.getByRole('button', { name: 'Period: Last 30 days' })).toBeInTheDocument();
    expect(summary()).toBe('Cars on rent today: 6 of 8 cars. On Aug 16: 1. Fleet today: 8.');
  });
});
