/**
 * The dashboard's "Sit down with these once" card
 * (components/dashboard-v2/checklist-card.tsx), on screen.
 *
 * Pins what the operator sees and what each click does:
 *   - the canary gets the sample clip on every row, its length "1:30" beside
 *     the play button, and a dialog that repeats the length and says "Sample";
 *   - a real video prints its own length and is never called a sample;
 *   - every other tenant gets no play target at all, and the row opens the
 *     guide;
 *   - the guide button's icon and name follow where it goes;
 *   - a `javascript:` video or guide URL never reaches the DOM, the router or
 *     window.open;
 *   - no interactive element is nested inside another.
 *
 * Expected lengths are worked out by hand beside each assertion. Icon classes
 * follow lucide-react's own rule — `lucide-` + the component name with a dash
 * inserted between a lowercase letter or digit and a following capital, then
 * lowercased — so BookOpen -> lucide-book-open, ArrowUpRight ->
 * lucide-arrow-up-right, and Settings2 -> lucide-settings2 (no capital follows
 * the 2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SetupChecklistItem } from '@/lib/setup-checklist';

const env = vi.hoisted(() => ({
  slug: 'northwind' as string | null,
  items: [] as SetupChecklistItem[],
  push: [] as string[],
}));

vi.mock('@/hooks/use-setup-checklist', () => ({
  useSetupChecklist: () => ({ items: env.items, isLoading: false, isFallback: false }),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: env.slug ? { id: 'tenant-1', slug: env.slug } : null,
    tenantSlug: env.slug,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (url: string) => env.push.push(url) }),
}));

import { ChecklistCard } from '@/components/dashboard-v2/checklist-card';
import { SETUP_CHECKLIST_ITEMS } from '@/lib/setup-checklist';

const item = (fields: Partial<SetupChecklistItem>): SetupChecklistItem => ({
  key: 'payg',
  title: 'Pay as you go',
  description: 'The fiddliest settings in the product.',
  videoUrl: null,
  videoDurationSeconds: null,
  guideUrl: '/settings?tab=payg',
  ...fields,
});

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  env.slug = 'northwind';
  env.items = [...SETUP_CHECKLIST_ITEMS];
  env.push = [];
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  openSpy.mockRestore();
});

function noNestedInteractives() {
  expect(document.querySelectorAll('button button, button a, a button, a a')).toHaveLength(0);
}

describe('the canary, before any walkthrough is recorded', () => {
  it('prints 1:30 beside a play button on every row', () => {
    render(<ChecklistCard />);
    // SAMPLE_EXPLAINER_DURATION_SECONDS = 90 = 1 x 60 + 30 -> "1:30", once per
    // compiled row, and there are four compiled rows.
    expect(screen.getAllByText('1:30')).toHaveLength(4);
    expect(
      screen.getByRole('button', { name: 'Watch a sample walkthrough for Auto-extension (1:30)' }),
    ).toBeInTheDocument();
    noNestedInteractives();
  });

  it('opens a dialog that repeats the length, says Sample, and plays the self-hosted clip', () => {
    render(<ChecklistCard />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Watch a sample walkthrough for Auto-extension (1:30)' }),
    );

    const dialog = screen.getByRole('dialog');
    const heading = within(dialog).getByRole('heading');
    expect(heading).toHaveTextContent('Auto-extension');
    expect(within(heading).getByText('1:30')).toBeInTheDocument();
    expect(within(heading).getByText('Sample')).toBeInTheDocument();
    expect(dialog.querySelector('video')?.getAttribute('src')).toBe(
      '/explainers/sample-walkthrough.mp4',
    );
    // Never autoplay: the operator presses play.
    expect(dialog.querySelector('video')?.hasAttribute('autoplay')).toBe(false);
  });

  it('links from the dialog to the feature’s settings, and routes there', () => {
    render(<ChecklistCard />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Watch a sample walkthrough for Installments (1:30)' }),
    );
    const dialog = screen.getByRole('dialog');
    const link = within(dialog).getByRole('button', { name: 'Open Installments settings' });
    expect(link).toHaveTextContent('Open settings');
    fireEvent.click(link);
    expect(env.push).toEqual(['/settings?tab=installments']);
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('a real video', () => {
  it('prints its own length and is never called a sample', () => {
    env.items = [item({ videoUrl: '/explainers/payg.mp4', videoDurationSeconds: 125 })];
    render(<ChecklistCard />);
    // 125 s = 2 x 60 + 5 -> "2:05"; the sample's "1:30" must not appear.
    expect(screen.getByText('2:05')).toBeInTheDocument();
    expect(screen.queryByText('1:30')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Watch the Pay as you go video (2:05)' }));
    const heading = within(screen.getByRole('dialog')).getByRole('heading');
    expect(within(heading).getByText('2:05')).toBeInTheDocument();
    expect(within(heading).queryByText('Sample')).toBeNull();
    expect(screen.getByRole('dialog').querySelector('video')?.getAttribute('src')).toBe(
      '/explainers/payg.mp4',
    );
  });

  it('prints no time at all when its length is unknown — never 0:00', () => {
    env.items = [item({ videoUrl: '/explainers/payg.mp4', videoDurationSeconds: null })];
    render(<ChecklistCard />);
    expect(screen.getByRole('button', { name: 'Watch the Pay as you go video' })).toBeInTheDocument();
    expect(screen.queryByText(/\d:\d\d/)).toBeNull();
  });

  it('prints an hour or more as h:mm:ss, the way the admin form shows it', () => {
    env.items = [item({ videoUrl: '/explainers/payg.mp4', videoDurationSeconds: 3725 })];
    render(<ChecklistCard />);
    // 3725 s = 1 x 3600 + 2 x 60 + 5 -> "1:02:05". Counting total minutes
    // instead would print "62:05", which is not what the super admin typed.
    expect(screen.getByText('1:02:05')).toBeInTheDocument();
    expect(screen.queryByText('62:05')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Watch the Pay as you go video (1:02:05)' }));
    const heading = within(screen.getByRole('dialog')).getByRole('heading');
    expect(within(heading).getByText('1:02:05')).toBeInTheDocument();
  });
});

describe('every other tenant', () => {
  beforeEach(() => {
    env.slug = 'some-other-tenant';
  });

  it('has no play target, no time, and no sample', () => {
    render(<ChecklistCard />);
    expect(screen.queryByRole('button', { name: /watch/i })).toBeNull();
    expect(screen.queryByText('1:30')).toBeNull();
    expect(document.querySelector('.lucide-play')).toBeNull();
    noNestedInteractives();
  });

  it('opens the guide when the row is clicked', () => {
    render(<ChecklistCard />);
    fireEvent.click(screen.getByText('Installments'));
    expect(env.push).toEqual(['/settings?tab=installments']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives each row one keyboard target: the guide button, named for the feature', () => {
    render(<ChecklistCard />);
    // Four compiled rows, each a settings link -> four guide buttons, and the
    // duplicate title targets are out of the accessibility tree.
    expect(screen.getAllByRole('button')).toHaveLength(4);
    const button = screen.getByRole('button', { name: 'Open Bonzah insurance settings' });
    fireEvent.click(button);
    expect(env.push).toEqual(['/settings?tab=insurance']);
  });
});

describe('the guide button follows its destination', () => {
  it('a /settings path: Settings2, "Open … settings", routed', () => {
    env.items = [item({ guideUrl: '/settings?tab=payg' })];
    render(<ChecklistCard />);
    const button = screen.getByRole('button', { name: 'Open Pay as you go settings' });
    expect(button.getAttribute('data-guide-kind')).toBe('settings');
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('lucide-settings2');
    fireEvent.click(button);
    expect(env.push).toEqual(['/settings?tab=payg']);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('another in-portal path: ArrowUpRight, "Open … in the portal", routed', () => {
    env.items = [item({ guideUrl: '/rentals?mode=payg' })];
    render(<ChecklistCard />);
    const button = screen.getByRole('button', { name: 'Open Pay as you go in the portal' });
    expect(button.getAttribute('data-guide-kind')).toBe('portal');
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('lucide-arrow-up-right');
    fireEvent.click(button);
    expect(env.push).toEqual(['/rentals?mode=payg']);
  });

  it('an external guide: BookOpen, "Read the … guide", a new tab with noopener', () => {
    env.items = [item({ guideUrl: 'https://docs.example.com/payg' })];
    render(<ChecklistCard />);
    const button = screen.getByRole('button', { name: 'Read the Pay as you go guide' });
    expect(button.getAttribute('data-guide-kind')).toBe('guide');
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('lucide-book-open');
    fireEvent.click(button);
    expect(openSpy).toHaveBeenCalledWith('https://docs.example.com/payg', '_blank', 'noopener,noreferrer');
    expect(env.push).toEqual([]);
  });

  it('shows its name as a tooltip when focused', async () => {
    // Radix positions a tooltip with floating-ui, which calls
    // `new ResizeObserver(...)`. The shared setup file mocks ResizeObserver
    // with an arrow function, which cannot be called with `new`, so this one
    // test swaps in a class for its duration.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      env.items = [item({ guideUrl: '/settings?tab=payg' })];
      render(<ChecklistCard />);
      fireEvent.focus(screen.getByRole('button', { name: 'Open Pay as you go settings' }));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Open Pay as you go settings');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('links typed by a super admin are untrusted', () => {
  const everything = () => document.body.innerHTML;

  it('never uses a javascript: guide — no button, no dialog link, no navigation', () => {
    env.items = [
      item({ videoUrl: '/explainers/payg.mp4', videoDurationSeconds: 60, guideUrl: 'javascript:alert(1)' }),
    ];
    render(<ChecklistCard />);
    expect(screen.queryByRole('button', { name: /settings|guide|portal/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Watch the Pay as you go video (1:00)' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /settings|guide|portal/i })).toBeNull();
    expect(everything()).not.toContain('javascript:');
    expect(env.push).toEqual([]);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('never plays a javascript: video — the canary gets the sample instead', () => {
    env.items = [item({ videoUrl: 'javascript:alert(2)', videoDurationSeconds: 60 })];
    render(<ChecklistCard />);
    // The hostile row's 60 s (1:00) must not ride along; the sample's 90 s does.
    expect(screen.queryByText('1:00')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Watch a sample walkthrough for Pay as you go (1:30)' }),
    );
    expect(screen.getByRole('dialog').querySelector('video')?.getAttribute('src')).toBe(
      '/explainers/sample-walkthrough.mp4',
    );
    expect(everything()).not.toContain('javascript:');
  });

  it('never plays a javascript: video for anyone else either — the guide remains', () => {
    env.slug = 'some-other-tenant';
    env.items = [item({ videoUrl: 'javascript:alert(2)', videoDurationSeconds: 60 })];
    render(<ChecklistCard />);
    expect(screen.queryByRole('button', { name: /watch/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Pay as you go settings' }));
    expect(env.push).toEqual(['/settings?tab=payg']);
    expect(everything()).not.toContain('javascript:');
  });

  it('drops a row with nothing safe behind it rather than render a dead line', () => {
    env.slug = 'some-other-tenant';
    env.items = [
      item({ key: 'dead', title: 'Dead row', videoUrl: 'javascript:alert(2)', guideUrl: '//evil.example' }),
      item({ key: 'live', title: 'Live row', guideUrl: '/settings?tab=payg' }),
    ];
    render(<ChecklistCard />);
    expect(screen.queryByText('Dead row')).toBeNull();
    expect(screen.getByText('Live row')).toBeInTheDocument();
    expect(everything()).not.toContain('javascript:');
    expect(everything()).not.toContain('evil.example');
  });
});

describe('the card’s classes compile', () => {
  it('never puts an opacity modifier on a var() colour, which Tailwind 3.4 turns into no CSS', () => {
    // `bg-[var(--pv-accent)]/10` generated nothing at all, so the play button
    // rendered as a bare triangle with no circle and no hover. Comments are
    // stripped first, because the fix's own comment names the broken class.
    const source = readFileSync(
      join(__dirname, '..', '..', 'components', 'dashboard-v2', 'checklist-card.tsx'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('bg-[var(--pv-accent-bg)]');
    expect(code).not.toMatch(/\[var\(--[\w-]+\)\]\/\d+/);
  });
});
