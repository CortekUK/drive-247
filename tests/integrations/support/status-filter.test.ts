// =============================================================================
// The support status filter.
//
// It was a native `<select>`. Its OPTION LIST is drawn by the operating system,
// not by us — the panel, the font and that flat blue highlight row come from
// Windows, and no class on the element reaches inside them. So the control sat
// in the middle of a themed sidebar looking like nothing else on the page, and
// could not be made to match however it was styled.
//
// `shared/trax-support` is mounted by BOTH the portal and the admin app and
// imports nothing from either, so the replacement cannot reach for a shadcn
// Select. It is built from the same Tailwind tokens the rest of the file uses,
// which resolve per app — which is exactly why it must never name a colour.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../../../shared/trax-support/inbox-ui.tsx'),
  'utf8',
);
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Just the filter, so nothing here passes on another control in the file. */
const filter = code.slice(
  code.indexOf('export function StatusFilter'),
  code.indexOf('export function TicketRow'),
);

describe('it is no longer an OS-drawn control', () => {
  it('renders a listbox we draw, not a <select>', () => {
    expect(filter).not.toMatch(/<select/);
    expect(filter).not.toMatch(/<option/);
    expect(filter).toMatch(/role="listbox"/);
    expect(filter).toMatch(/role="option"/);
  });
});

describe('it takes its colours from whichever app mounts it', () => {
  it('names no colour of its own', () => {
    // A literal here would be right in one app and wrong in the other.
    expect(filter).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(filter).not.toMatch(
      /\b(bg|text|border)-(blue|indigo|violet|purple|slate|zinc|gray|grey)-\d{2,3}\b/,
    );
  });

  it('uses the theme tokens the rest of the file already uses', () => {
    for (const token of [
      'border-input',
      'bg-background',
      'ring-ring',
      'text-muted-foreground',
      'bg-popover',
    ]) {
      expect(filter, token).toContain(token);
    }
    // The highlight is the brand, not the OS blue.
    expect(filter).toMatch(/bg-primary\/10 text-primary/);
  });
});

describe('it keeps what a native select gave for free', () => {
  it('is announced as a dropdown', () => {
    expect(filter).toMatch(/aria-haspopup="listbox"/);
    expect(filter).toMatch(/aria-expanded=\{open\}/);
    expect(filter).toMatch(/aria-selected=\{isSelected\}/);
    expect(filter).toMatch(/aria-label="Filter ticket status"/);
  });

  it('is fully keyboard operable', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Enter']) {
      expect(filter, key).toContain(`'${key}'`);
    }
  });

  it('returns focus to the trigger when it closes', () => {
    // Otherwise focus lands on <body> and the next Tab restarts the page.
    expect(filter).toMatch(/triggerRef\.current\?\.focus\(\)/);
  });

  it('closes on an outside click', () => {
    expect(filter).toMatch(/addEventListener\('mousedown'/);
    expect(filter).toMatch(/removeEventListener\('mousedown'/);
  });
});
