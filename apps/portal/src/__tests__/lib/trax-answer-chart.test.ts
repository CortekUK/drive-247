import { describe, expect, it } from 'vitest';
import { chartable, type AnswerGroup } from '../../components/trax/support/AnswerChart';

/*
 * When a measured breakdown is worth drawing.
 *
 * The chart renders the query layer's own `groups` — it never recomputes a
 * figure — so the only judgement it makes is whether a set is comparable at all.
 * Getting that wrong produces the classic chart mistakes: two currencies sharing
 * one axis, a single bar pretending to be a comparison, or a row of zeroes.
 */
const group = (over: Partial<AnswerGroup>): AnswerGroup =>
  ({ key: 'k', label: 'Label', value: '10.00', currency: 'GBP', rows: 1, ...over });

describe('what gets drawn', () => {
  it('draws a comparison of two or more groups', () => {
    expect(chartable([group({ label: 'Card', value: '1234.50' }), group({ label: 'Transfer', value: '99.99' })])).toBe(true);
  });

  it('does not draw a single group — that is a number, not a comparison', () => {
    expect(chartable([group({ value: '400.00' })])).toBe(false);
    expect(chartable([])).toBe(false);
    expect(chartable(undefined)).toBe(false);
  });

  it('never puts two currencies on one axis', () => {
    // The query layer keeps currencies separate on purpose; a shared axis would
    // silently imply GBP 100 and AED 100 are the same size.
    expect(chartable([
      group({ label: 'UK', value: '100.00', currency: 'GBP' }),
      group({ label: 'UAE', value: '100.00', currency: 'AED' }),
    ])).toBe(false);
  });

  it('draws counts, which carry no currency at all', () => {
    expect(chartable([
      group({ label: 'Available', value: '12', currency: null }),
      group({ label: 'Maintenance', value: '3', currency: null }),
    ])).toBe(true);
  });

  it('does not draw a row of zeroes', () => {
    expect(chartable([group({ value: '0.00' }), group({ value: '0.00' })])).toBe(false);
    // One real value among zeroes is still a comparison.
    expect(chartable([group({ value: '0.00' }), group({ value: '5.00' })])).toBe(true);
  });

  it('refuses anything it cannot read as a number', () => {
    expect(chartable([group({ value: 'Name unavailable' }), group({ value: '5.00' })])).toBe(false);
    expect(chartable([group({ value: '' }), group({ value: '5.00' })])).toBe(false);
  });

  it('refuses negatives, which a bar length cannot honestly show', () => {
    // A customer in credit has a negative net; that needs a different form.
    expect(chartable([group({ value: '-75.00' }), group({ value: '160.00' })])).toBe(false);
  });

  it('reads thousands separators rather than rejecting them', () => {
    expect(chartable([group({ value: '1,234.50' }), group({ value: '99.99' })])).toBe(true);
  });
});
