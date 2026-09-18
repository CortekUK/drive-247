/**
 * The dashboard's "Sit down with these once" card
 * (components/dashboard-v2/checklist-card.tsx), on screen.
 *
 * Pins what the operator sees and what each click does:
 *   - the canary gets the sample clip on every row, its length "1:30" beside
 *     the play button, and a dialog that repeats the length and says "Sample";
 *   - a real video prints its own length and is never called a sample;
 *   - every other tenant gets no play target at all, and the row opens what
 *     there is to read;
 *   - THE SECOND BUTTON IS A READ BUTTON, NEVER SETTINGS: a reading icon named
 *     "Read the <Title> guide" that opens the page-turning reader for that
 *     row's compiled guide; with no compiled guide it falls back to an
 *     external written guide in a new tab; an in-portal link is never shown,
 *     and nothing on the card routes anywhere;
 *   - the video dialog's way on is "Read the guide", which swaps the video for
 *     the reader;
 *   - a row with nothing to play and nothing to read is not rendered;
 *   - a `javascript:` video or guide URL never reaches the DOM or window.open;
 *   - no interactive element is nested inside another.
 *
 * Expected lengths are worked out by hand beside each assertion. Icon classes
 * follow lucide-react's own rule — `lucide-` + the component name with a dash
 * inserted between a lowercase letter or digit and a following capital, then
 * lowercased — so BookOpen -> lucide-book-open, BookOpenText ->
 * lucide-book-open-text, and Settings2 -> lucide-settings2 (no capital follows
 * the 2). Because "lucide-book-open" is a prefix of "lucide-book-open-text",
 * icons are checked with `classList.contains`, never a substring match.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
// The card no longer uses the router at all. The mock stays so that, if a
// later edit brings navigation back, these tests see it in `env.push`.
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
  vi.unstubAllGlobals();
});

/**
 * Radix positions a tooltip with floating-ui, which calls
 * `new ResizeObserver(...)`. The shared setup file mocks ResizeObserver with an
 * arrow function, which cannot be called with `new`, so any test that lets a
 * read button take focus — and so opens its tooltip — swaps in a class.
 */
function stubResizeObserverClass() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

function noNestedInteractives() {
  expect(document.querySelectorAll('button button, button a, a button, a a')).toHaveLength(0);
}

/** Nothing on the card — or in any dialog it opened — leads to settings. */
function noSettingsAnywhere() {
  expect(document.querySelector('.lucide-settings2, .lucide-settings')).toBeNull();
  expect(screen.queryAllByRole('button', { name: /settings/i })).toHaveLength(0);
  expect(screen.queryAllByRole('link', { name: /settings/i })).toHaveLength(0);
  expect(document.querySelector('a[href*="/settings"]')).toBeNull();
  expect(env.push).toEqual([]);
}

/** The reader dialog, once it is the one open. */
function reader() {
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('data-guide-reader');
  return dialog;
}

function iconOf(button: HTMLElement) {
  return button.querySelector('svg')!.classList;
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

  it('gives every row a read button, not a settings one', () => {
    render(<ChecklistCard />);
    // Four compiled rows, each with a compiled guide -> four read buttons.
    const names = screen
      .getAllByRole('button', { name: /^Read the .* guide$/ })
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Read the Auto-extension guide',
      'Read the Installments guide',
      'Read the Pay as you go guide',
      'Read the Bonzah insurance guide',
    ]);
    noSettingsAnywhere();
    expect(document.body.textContent).not.toMatch(/settings/i);
    // textContent skips attributes. Rows used to carry their description as a
    // native `title`, which the browser drew as a long black box over the rows
    // below (Sep 16 2026 screenshot). The card now has no native hover text at
    // all: the read button's own tooltip names the guide, and the guide itself
    // is where the feature is explained.
    const titled = Array.from(document.querySelectorAll('[title]')).map((el) =>
      el.getAttribute('title'),
    );
    expect(titled).toEqual([]);
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

  it('offers the guide from the video dialog — "Read the guide" swaps the video for the reader', () => {
    render(<ChecklistCard />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Watch a sample walkthrough for Installments (1:30)' }),
    );
    const video = screen.getByRole('dialog');
    expect(within(video).queryByRole('button', { name: /settings/i })).toBeNull();
    expect(within(video).queryByText(/open settings/i)).toBeNull();
    const link = within(video).getByRole('button', { name: 'Read the Installments guide' });
    expect(link).toHaveTextContent('Read the guide');
    expect(iconOf(link).contains('lucide-book-open-text')).toBe(true);

    fireEvent.click(link);
    // One dialog now, and it is the Installments reader: the video is gone.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const book = reader();
    expect(book.querySelector('video')).toBeNull();
    expect(within(book).getByRole('heading', { level: 2 })).toHaveTextContent('Installments');
    // Installments has four pages in the brief.
    expect(within(book).getByText('Page 1 of 4')).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    noSettingsAnywhere();
  });

  it('returns focus to the row’s play button when the video dialog closes — by Escape or by Close', async () => {
    // The dialog is opened without a Radix DialogTrigger, and a modal Radix
    // dialog focuses its (here null) trigger on close, so without the card's
    // own handling focus fell to <body> either way.
    render(<ChecklistCard />);
    const play = screen.getByRole('button', {
      name: 'Watch a sample walkthrough for Pay as you go (1:30)',
    });

    play.focus();
    fireEvent.click(play);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(play));

    fireEvent.click(play);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(play));
  });

  it('returns focus to the row’s read button when the reader it handed over to closes', async () => {
    // Focus landing on the read button opens its tooltip.
    stubResizeObserverClass();
    render(<ChecklistCard />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Watch a sample walkthrough for Bonzah insurance (1:30)' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Read the Bonzah insurance guide' }),
    );
    expect(reader().contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Read the Bonzah insurance guide' }),
      ),
    );
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

  it('opens the reader when the row’s title is clicked', () => {
    render(<ChecklistCard />);
    fireEvent.click(screen.getByText('Installments'));
    const book = reader();
    expect(within(book).getByRole('heading', { level: 2 })).toHaveTextContent('Installments');
    expect(within(book).getByRole('heading', { level: 3 })).toHaveTextContent(
      'What it is and when to use it',
    );
    noSettingsAnywhere();
  });

  it('gives each row one keyboard target: the read button, named for the feature', () => {
    render(<ChecklistCard />);
    // Four compiled rows, each with a compiled guide -> four read buttons, and
    // the duplicate title targets are out of the accessibility tree.
    expect(screen.getAllByRole('button')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Read the Bonzah insurance guide' }));
    const book = reader();
    expect(within(book).getByRole('heading', { level: 2 })).toHaveTextContent('Bonzah insurance');
    // Bonzah has four pages; its first is "What it is".
    expect(within(book).getByText('Page 1 of 4')).toBeInTheDocument();
    expect(within(book).getByRole('heading', { level: 3 })).toHaveTextContent('What it is');
    noSettingsAnywhere();
  });
});

describe('the read button', () => {
  it('a compiled guide: BookOpenText, "Read the … guide", opens the reader for that row', () => {
    // A row still carrying its seeded /settings link: the link is ignored.
    env.items = [item({ key: 'payg', guideUrl: '/settings?tab=payg' })];
    render(<ChecklistCard />);
    const button = screen.getByRole('button', { name: 'Read the Pay as you go guide' });
    expect(button.getAttribute('data-read-kind')).toBe('reader');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(iconOf(button).contains('lucide-book-open-text')).toBe(true);
    expect(iconOf(button).contains('lucide-settings2')).toBe(false);

    fireEvent.click(button);
    const book = reader();
    expect(book).toHaveAttribute('data-guide-reader', 'payg');
    expect(within(book).getByRole('heading', { level: 2 })).toHaveTextContent('Pay as you go');
    expect(within(book).getByText('Page 1 of 4')).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    noSettingsAnywhere();
  });

  it('opens the right guide for each row', () => {
    env.slug = 'some-other-tenant';
    render(<ChecklistCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Read the Auto-extension guide' }));
    // Auto-extension is the one guide with three pages.
    expect(within(reader()).getByText('Page 1 of 3')).toBeInTheDocument();
    expect(reader()).toHaveAttribute('data-guide-reader', 'auto_extension');
  });

  it('a compiled guide wins over an external guide link on the same row', () => {
    env.items = [item({ key: 'payg', guideUrl: 'https://docs.example.com/payg' })];
    render(<ChecklistCard />);
    const button = screen.getByRole('button', { name: 'Read the Pay as you go guide' });
    expect(button.getAttribute('data-read-kind')).toBe('reader');
    fireEvent.click(button);
    expect(reader()).toHaveAttribute('data-guide-reader', 'payg');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('no compiled guide: falls back to the external written guide — BookOpen, a new tab with noopener', () => {
    env.items = [
      item({ key: 'damage_claims', title: 'Damage claims', guideUrl: 'https://docs.example.com/claims' }),
    ];
    render(<ChecklistCard />);
    const button = screen.getByRole('button', { name: 'Read the Damage claims guide' });
    expect(button.getAttribute('data-read-kind')).toBe('external');
    expect(iconOf(button).contains('lucide-book-open')).toBe(true);
    expect(iconOf(button).contains('lucide-book-open-text')).toBe(false);
    fireEvent.click(button);
    expect(openSpy).toHaveBeenCalledWith(
      'https://docs.example.com/claims',
      '_blank',
      'noopener,noreferrer',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(env.push).toEqual([]);
  });

  it('no compiled guide and only an in-portal link: no read button — settings or not', () => {
    // The canary still gets the sample clip, so the row stays, with play only.
    env.items = [
      item({ key: 'damage_claims', title: 'Damage claims', guideUrl: '/settings?tab=claims' }),
      item({ key: 'fleet_tags', title: 'Fleet tags', guideUrl: '/vehicles?view=tags' }),
    ];
    render(<ChecklistCard />);
    expect(screen.getByRole('button', { name: 'Watch a sample walkthrough for Damage claims (1:30)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Watch a sample walkthrough for Fleet tags (1:30)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /guide|settings|portal/i })).toBeNull();
    // And the video dialog offers no way on either.
    fireEvent.click(screen.getByRole('button', { name: 'Watch a sample walkthrough for Damage claims (1:30)' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /guide|settings|portal/i })).toBeNull();
    noSettingsAnywhere();
  });

  it('a row with no video and nothing to read is not rendered', () => {
    env.slug = 'some-other-tenant';
    env.items = [
      item({ key: 'damage_claims', title: 'Damage claims', guideUrl: '/settings?tab=claims' }),
      item({ key: 'installments', title: 'Installments', guideUrl: '/settings?tab=installments' }),
    ];
    render(<ChecklistCard />);
    expect(screen.queryByText('Damage claims')).toBeNull();
    expect(screen.getByText('Installments')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('shows its name as a tooltip when focused', async () => {
    stubResizeObserverClass();
    env.items = [item({ key: 'payg' })];
    render(<ChecklistCard />);
    fireEvent.focus(screen.getByRole('button', { name: 'Read the Pay as you go guide' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Read the Pay as you go guide');
  });

  it('returns focus to itself when the reader closes', async () => {
    // Focus landing back on the read button opens its tooltip.
    stubResizeObserverClass();
    env.slug = 'some-other-tenant';
    render(<ChecklistCard />);
    const button = screen.getByRole('button', { name: 'Read the Installments guide' });
    button.focus();
    fireEvent.click(button);
    const book = reader();
    expect(book.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(book).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});

describe('links typed by a super admin are untrusted', () => {
  const everything = () => document.body.innerHTML;

  it('never uses a javascript: guide — no button, no dialog link, no navigation', () => {
    env.items = [
      item({
        key: 'damage_claims',
        title: 'Damage claims',
        videoUrl: '/explainers/claims.mp4',
        videoDurationSeconds: 60,
        guideUrl: 'javascript:alert(1)',
      }),
    ];
    render(<ChecklistCard />);
    expect(screen.queryByRole('button', { name: /settings|guide|portal/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Watch the Damage claims video (1:00)' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Read the Pay as you go guide' }));
    expect(reader()).toHaveAttribute('data-guide-reader', 'payg');
    expect(everything()).not.toContain('javascript:');
    expect(env.push).toEqual([]);
  });

  it('drops a row with nothing safe behind it rather than render a dead line', () => {
    env.slug = 'some-other-tenant';
    env.items = [
      item({ key: 'dead', title: 'Dead row', videoUrl: 'javascript:alert(2)', guideUrl: '//evil.example' }),
      item({ key: 'live', title: 'Live row', guideUrl: 'https://docs.example.com/live' }),
    ];
    render(<ChecklistCard />);
    expect(screen.queryByText('Dead row')).toBeNull();
    expect(screen.getByText('Live row')).toBeInTheDocument();
    expect(everything()).not.toContain('javascript:');
    expect(everything()).not.toContain('evil.example');
  });

  it('never opens a hostile guide on a row with no compiled guide', () => {
    env.slug = 'some-other-tenant';
    env.items = [
      item({ key: 'a', title: 'Row A', guideUrl: '/.//evil.example' }),
      item({ key: 'b', title: 'Row B', guideUrl: 'data:text/html,<script>alert(1)</script>' }),
      item({ key: 'c', title: 'Row C', guideUrl: 'https://docs.example.com/c' }),
    ];
    render(<ChecklistCard />);
    expect(screen.queryByText('Row A')).toBeNull();
    expect(screen.queryByText('Row B')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read the Row C guide' }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('https://docs.example.com/c', '_blank', 'noopener,noreferrer');
    expect(everything()).not.toContain('evil.example');
  });
});

describe('the card’s source', () => {
  // Comments are stripped first: they explain the old settings button and the
  // broken class by name.
  const source = readFileSync(
    join(__dirname, '..', '..', 'components', 'dashboard-v2', 'checklist-card.tsx'),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never puts an opacity modifier on a var() colour, which Tailwind 3.4 turns into no CSS', () => {
    // `bg-[var(--pv-accent)]/10` generated nothing at all, so the play button
    // rendered as a bare triangle with no circle and no hover.
    expect(code).toContain('bg-[var(--pv-accent-bg)]');
    expect(code).not.toMatch(/\[var\(--[\w-]+\)\]\/\d+/);
  });

  it('has no path to settings: no Settings2, no router, no /settings link', () => {
    expect(code).not.toMatch(/\bSettings2\b/);
    expect(code).not.toMatch(/useRouter|router\.push|next\/navigation/);
    expect(code).not.toMatch(/['"`]\/settings/);
    expect(code).not.toMatch(/Open settings/i);
  });
});
