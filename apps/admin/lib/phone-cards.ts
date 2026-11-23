'use client';

/**
 * Phone cards for every table in Super Admin, the operator portal's pattern
 * (apps/portal list-table-v2.tsx + v2-theme.css `[data-phone-cards]`): below
 * `lg` a table is not a 900px grid scrolled sideways inside a phone; each row
 * is a compact block, its first cell the title and every other cell its value
 * under the column's own name as a small label. Nothing desktop shows is
 * dropped — the same cells, reflowed (globals.css).
 *
 * The labels are the header's own words, copied onto each cell as
 * `data-label` so CSS can print them. Doing it here, once, for every
 * `[data-phone-cards] table` on the page means the 20-odd tables (the shared
 * `Table` opts in by default; hand-written `<table>`s carry the attribute on
 * their wrapper) need no per-cell edits, and rows that load later are
 * labelled as they arrive. A row whose single cell spans the table (an empty
 * or loading state) is marked `data-full` and keeps its width.
 */

import { useEffect } from 'react';

function headerLabels(table: HTMLTableElement): string[] {
  const row = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!row) return [];
  const labels: string[] = [];
  for (const th of Array.from(row.cells)) {
    const text = (th.textContent || th.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    // A row's controls need no caption on a card: like the operator's ⋯ they
    // go to the card's top-right corner (globals.css), which an empty label
    // asks for.
    if (/^actions?$/i.test(text)) {
      for (let i = 0; i < (th.colSpan || 1); i++) labels.push('');
      continue;
    }
    for (let i = 0; i < (th.colSpan || 1); i++) labels.push(text);
  }
  return labels;
}

function labelTable(table: HTMLTableElement) {
  const labels = headerLabels(table);
  const columns = labels.length;
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      const cells = Array.from(row.cells);
      if (cells.length === 1 && (cells[0].colSpan > 1 || columns > 1)) {
        if (!cells[0].hasAttribute('data-full')) cells[0].setAttribute('data-full', '');
        continue;
      }
      let col = 0;
      for (const cell of cells) {
        // A label set by the page itself wins.
        if (!cell.hasAttribute('data-label') || cell.hasAttribute('data-auto-label')) {
          const label = labels[col] ?? '';
          if (cell.getAttribute('data-label') !== label) {
            cell.setAttribute('data-label', label);
            cell.setAttribute('data-auto-label', '');
          }
        }
        col += cell.colSpan || 1;
      }
    }
  }
}

function labelAll(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>('[data-phone-cards] table').forEach(labelTable);
}

/** Mount once, in the shell. */
export function usePhoneCardLabels() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        labelAll(document);
      });
    };
    labelAll(document);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
