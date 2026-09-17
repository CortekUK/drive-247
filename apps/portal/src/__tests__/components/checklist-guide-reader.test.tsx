/**
 * The setup checklist's page-turning reader
 * (components/dashboard-v2/checklist-guide-reader.tsx), on screen.
 *
 * Pins:
 *   - the header names the feature and says "Page n of N";
 *   - Previous / Next, and the left / right arrow keys, turn one page at a
 *     time and never past either end; Next becomes Done on the last page;
 *   - focus starts inside the dialog and stays there, even on the first page
 *     where Previous has nowhere to go;
 *   - a page on its way out is hidden and inert for the length of the turn;
 *   - the turn is a rotateY flip about the spine by default, and a plain
 *     crossfade — no rotation at all — under prefers-reduced-motion;
 *   - nothing plays or turns on its own;
 *   - what is shown is exactly the compiled guide, page by page.
 *
 * Page counts and quoted text are written out by hand from the fact-checked
 * content brief, not copied from running the code.
 *
 * Role queries skip `aria-hidden` subtrees, which is what makes them see only
 * the page actually showing: the invisible sizer copies of every page and the
 * page leaving mid-turn are both `aria-hidden`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const motionEnv = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => motionEnv.reduce };
});

import {
  ChecklistGuideReader,
  PAGE_TURN_SECONDS,
} from '@/components/dashboard-v2/checklist-guide-reader';
import {
  SETUP_CHECKLIST_GUIDES,
  checklistGuideFor,
  type ChecklistGuide,
} from '@/lib/setup-checklist-guides';

beforeEach(() => {
  motionEnv.reduce = false;
});

function guide(key: string): ChecklistGuide {
  const found = checklistGuideFor(key);
  if (!found) throw new Error(`no compiled guide for ${key}`);
  return found;
}

function openReader(key = 'auto_extension') {
  const onClose = vi.fn();
  const utils = render(<ChecklistGuideReader guide={guide(key)} onClose={onClose} />);
  return { ...utils, onClose, dialog: screen.getByRole('dialog') };
}

/** The page showing — never a sizer, never the page leaving. */
const pageHeading = () => screen.getByRole('heading', { level: 3 });
/** Each point as it is read out: the drawn number beside it is aria-hidden. */
const pagePoints = () =>
  within(screen.getByRole('region', { name: pageHeading().textContent ?? '' }))
    .getAllByRole('listitem')
    .map((li) => {
      const copy = li.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
      return copy.textContent;
    });

const pressKey = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

/** Every `style` an element in `root` is given, including pages as they arrive. */
function recordStyles(root: HTMLElement) {
  const seen: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        seen.push((record.target as Element).getAttribute('style') ?? '');
      }
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) seen.push(node.getAttribute('style') ?? '');
      });
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
  return { seen, stop: () => observer.disconnect() };
}

const turnFinished = (dialog: HTMLElement) =>
  waitFor(() => expect(dialog.querySelectorAll('[data-guide-page]')).toHaveLength(1), {
    timeout: 3000,
  });

describe('opening the reader', () => {
  it('names the feature, starts on page one and counts the pages', () => {
    const { dialog } = openReader('auto_extension');
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Auto-extension');
    // Auto-extension has three pages in the brief.
    expect(within(dialog).getByText('Page 1 of 3')).toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent('What it is and when to use it');
    expect(pagePoints()).toHaveLength(4);
    expect(pagePoints()[0]).toBe(
      'A rental that renews every week or month, with the customer paying before each new period begins.',
    );
  });

  it.each([
    // Installments, pay as you go and Bonzah have four pages each in the brief.
    ['installments', 'Installments', 'Page 1 of 4'],
    ['payg', 'Pay as you go', 'Page 1 of 4'],
    ['bonzah', 'Bonzah insurance', 'Page 1 of 4'],
  ])('counts the %s guide’s pages', (key, title, count) => {
    const { dialog } = openReader(key);
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(title);
    expect(within(dialog).getByText(count)).toBeInTheDocument();
  });

  it('puts focus on Next, inside the dialog', () => {
    const { dialog } = openReader();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Next' }));
  });

  it('plays nothing and turns nothing on its own', async () => {
    const { dialog } = openReader();
    expect(dialog.querySelector('video, audio, iframe')).toBeNull();
    // Longer than one full turn: had anything advanced by itself, it would
    // have landed by now.
    await new Promise((resolve) => setTimeout(resolve, PAGE_TURN_SECONDS * 1000 + 250));
    expect(within(dialog).getByText('Page 1 of 3')).toBeInTheDocument();
    expect(dialog.querySelectorAll('[data-guide-page]')).toHaveLength(1);
  });
});

describe('turning pages', () => {
  it('Next and Previous move one page at a time', () => {
    const { dialog } = openReader('auto_extension');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('Page 2 of 3')).toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent('How each renewal is paid');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous' }));
    expect(within(dialog).getByText('Page 1 of 3')).toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent('What it is and when to use it');
  });

  it('Previous on page one goes nowhere and keeps focus', () => {
    const { dialog } = openReader();
    const previous = within(dialog).getByRole('button', { name: 'Previous' });
    // aria-disabled, not disabled: a disabled button would throw focus out to
    // <body>, and the arrow keys with it.
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(previous).not.toBeDisabled();
    previous.focus();
    fireEvent.click(previous);
    expect(within(dialog).getByText('Page 1 of 3')).toBeInTheDocument();
    expect(document.activeElement).toBe(previous);
  });

  it('keeps focus inside the dialog all the way through and back', () => {
    const { dialog } = openReader('auto_extension');
    const next = within(dialog).getByRole('button', { name: 'Next' });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(dialog.contains(document.activeElement)).toBe(true);
    const previous = within(dialog).getByRole('button', { name: 'Previous' });
    previous.focus();
    fireEvent.click(previous);
    fireEvent.click(previous);
    expect(within(dialog).getByText('Page 1 of 3')).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('turns Next into Done on the last page, which closes the book', () => {
    const { dialog, onClose } = openReader('auto_extension');
    const next = within(dialog).getByRole('button', { name: 'Next' });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(within(dialog).getByText('Page 3 of 3')).toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent('Pauses, reminders and deposits');
    // The same element, relabelled, so focus does not jump.
    expect(next).toHaveTextContent('Done');
    expect(within(dialog).queryByRole('button', { name: 'Next' })).toBeNull();
    fireEvent.click(next);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('turns with the right and left arrow keys, and never past either end', () => {
    const { dialog, onClose } = openReader('auto_extension');
    pressKey('ArrowLeft');
    expect(within(dialog).getByText('Page 1 of 3')).toBeInTheDocument();
    pressKey('ArrowRight');
    expect(within(dialog).getByText('Page 2 of 3')).toBeInTheDocument();
    pressKey('ArrowRight');
    pressKey('ArrowRight');
    // Three pages: the third press has nowhere to go, and closes nothing.
    expect(within(dialog).getByText('Page 3 of 3')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    pressKey('ArrowLeft');
    expect(within(dialog).getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('leaves modified arrows alone — Alt+← is the browser’s Back', () => {
    const { dialog } = openReader('auto_extension');
    pressKey('ArrowRight', { altKey: true });
    pressKey('ArrowRight', { metaKey: true });
    pressKey('ArrowRight', { ctrlKey: true });
    pressKey('ArrowRight', { shiftKey: true });
    expect(within(dialog).getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('hides the page that is leaving and makes it inert until the turn ends', async () => {
    const { dialog } = openReader('auto_extension');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    const pages = Array.from(dialog.querySelectorAll('[data-guide-page]'));
    expect(pages.map((p) => p.getAttribute('data-guide-page')).sort()).toEqual(['1', '2']);
    const leaving = pages.find((p) => p.getAttribute('data-guide-page') === '1')!;
    const arriving = pages.find((p) => p.getAttribute('data-guide-page') === '2')!;
    expect(leaving).toHaveAttribute('aria-hidden', 'true');
    expect(leaving.hasAttribute('inert')).toBe(true);
    expect(arriving).not.toHaveAttribute('aria-hidden');
    expect(arriving.hasAttribute('inert')).toBe(false);
    await turnFinished(dialog);
    expect(dialog.querySelector('[data-guide-page]')).toHaveAttribute('data-guide-page', '2');
  });

  it('starts again from page one when reopened', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ChecklistGuideReader guide={guide('auto_extension')} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    rerender(<ChecklistGuideReader guide={null} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<ChecklistGuideReader guide={guide('auto_extension')} onClose={onClose} />);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('announces each turn with the page’s heading', () => {
    const { dialog } = openReader('payg');
    pressKey('ArrowRight');
    const status = within(dialog).getByText('Page 2 of 4').parentElement!;
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Page 2 of 4: How daily charges build up');
  });
});

describe('the page turn', () => {
  it('flips the page about its spine with rotateY, in about 450ms', async () => {
    expect(PAGE_TURN_SECONDS).toBe(0.45);
    const { dialog } = openReader('auto_extension');
    expect(dialog.querySelector('[data-page-turn]')).toHaveAttribute('data-page-turn', 'flip');
    const page = dialog.querySelector<HTMLElement>('[data-guide-page]')!;
    // The spine is the left edge, and a page past edge-on is never drawn.
    expect(page.style.transformOrigin).toBe('left center');
    expect(page.style.backfaceVisibility).toBe('hidden');

    const styles = recordStyles(dialog);
    pressKey('ArrowRight');
    await turnFinished(dialog);
    styles.stop();
    expect(styles.seen.some((s) => /rotateY\(-?\d/.test(s))).toBe(true);
  });

  it('crossfades with no rotation at all under prefers-reduced-motion', async () => {
    motionEnv.reduce = true;
    const { dialog } = openReader('auto_extension');
    expect(dialog.querySelector('[data-page-turn]')).toHaveAttribute('data-page-turn', 'crossfade');
    const page = dialog.querySelector<HTMLElement>('[data-guide-page]')!;
    expect(page.style.transformOrigin).toBe('');

    const styles = recordStyles(dialog);
    pressKey('ArrowRight');
    await turnFinished(dialog);
    styles.stop();
    expect(styles.seen.some((s) => s.includes('opacity'))).toBe(true);
    expect(styles.seen.filter((s) => /rotate/i.test(s))).toEqual([]);
    expect(within(dialog).getByText('Page 2 of 3')).toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent('How each renewal is paid');
  });
});

describe('what the reader shows is the compiled guide', () => {
  it.each(SETUP_CHECKLIST_GUIDES.map((g) => [g.key, g] as const))(
    '%s, page by page',
    (key, compiled) => {
      const { dialog } = openReader(key);
      compiled.pages.forEach((page, i) => {
        if (i > 0) pressKey('ArrowRight');
        expect(within(dialog).getByText(`Page ${i + 1} of ${compiled.pages.length}`)).toBeInTheDocument();
        expect(pageHeading()).toHaveTextContent(page.heading);
        expect(pagePoints()).toEqual([...page.points]);
      });
    },
  );

  it('quotes the brief exactly — spot checks written out by hand', () => {
    const { dialog } = openReader('bonzah');
    pressKey('ArrowRight');
    pressKey('ArrowRight');
    expect(within(dialog).getByText('Page 3 of 4')).toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent('Cover gaps that catch people out');
    expect(pagePoints()[3]).toBe(
      'No single policy can be cancelled. Cancelling the whole rental asks Bonzah to cancel its policies, and Bonzah can refuse.',
    );
  });

  it('draws every page invisibly too, so the book is as tall as its longest page', () => {
    const { dialog } = openReader('installments');
    const sizers = Array.from(dialog.querySelectorAll('[data-page-turn] > .invisible'));
    // Installments has four pages.
    expect(sizers).toHaveLength(4);
    for (const sizer of sizers) {
      expect(sizer).toHaveAttribute('aria-hidden', 'true');
      expect(sizer.hasAttribute('inert')).toBe(true);
    }
  });
});
