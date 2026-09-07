import { describe, it, expect } from 'vitest';
import { getActiveCoverageLabels } from '@/lib/coverage-labels';

const SHORT = { cdw: 'CDW', rcli: 'RCLI', sli: 'SLI', pai: 'PAI' };

describe('getActiveCoverageLabels — the CDW+RCLI merge rule', () => {
  it('merges CDW + RCLI into ONE entry when both are present', () => {
    expect(getActiveCoverageLabels({ cdw: true, rcli: true }, SHORT)).toEqual([
      { key: 'cdw_rcli', label: 'CDW + RCLI' },
    ]);
  });

  it('shows only CDW when only CDW is present', () => {
    expect(getActiveCoverageLabels({ cdw: true }, SHORT)).toEqual([{ key: 'cdw', label: 'CDW' }]);
  });

  it('shows only RCLI when only RCLI is present', () => {
    expect(getActiveCoverageLabels({ rcli: true }, SHORT)).toEqual([{ key: 'rcli', label: 'RCLI' }]);
  });

  it('keeps SLI separate after the merged CDW+RCLI', () => {
    expect(getActiveCoverageLabels({ cdw: true, rcli: true, sli: true }, SHORT)).toEqual([
      { key: 'cdw_rcli', label: 'CDW + RCLI' },
      { key: 'sli', label: 'SLI' },
    ]);
  });

  it('handles all four: CDW+RCLI merged, SLI and PAI separate, in order', () => {
    expect(getActiveCoverageLabels({ cdw: true, rcli: true, sli: true, pai: true }, SHORT)).toEqual([
      { key: 'cdw_rcli', label: 'CDW + RCLI' },
      { key: 'sli', label: 'SLI' },
      { key: 'pai', label: 'PAI' },
    ]);
  });

  it('does NOT merge when only one of the pair is present (CDW + PAI)', () => {
    expect(getActiveCoverageLabels({ cdw: true, pai: true }, SHORT)).toEqual([
      { key: 'cdw', label: 'CDW' },
      { key: 'pai', label: 'PAI' },
    ]);
  });

  it('drops nothing and duplicates nothing — every result key is unique', () => {
    const res = getActiveCoverageLabels({ cdw: true, rcli: true, sli: true, pai: true }, SHORT);
    const keys = res.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ignores non-coverage keys like pdf_ids', () => {
    expect(
      getActiveCoverageLabels({ cdw: true, rcli: true, pdf_ids: { cdw: 'x', rcli: 'y' } }, SHORT)
    ).toEqual([{ key: 'cdw_rcli', label: 'CDW + RCLI' }]);
  });

  it('returns [] for null / undefined / empty coverage', () => {
    expect(getActiveCoverageLabels(null, SHORT)).toEqual([]);
    expect(getActiveCoverageLabels(undefined, SHORT)).toEqual([]);
    expect(getActiveCoverageLabels({}, SHORT)).toEqual([]);
  });

  it('uses the caller-supplied label map for singles (full labels)', () => {
    const FULL = { cdw: 'Collision Damage Waiver', rcli: 'RCLI', sli: 'SLI', pai: 'PAI' };
    expect(getActiveCoverageLabels({ cdw: true }, FULL)).toEqual([
      { key: 'cdw', label: 'Collision Damage Waiver' },
    ]);
  });

  it('honors a custom merged label', () => {
    expect(getActiveCoverageLabels({ cdw: true, rcli: true }, SHORT, 'Damage + Liability')).toEqual([
      { key: 'cdw_rcli', label: 'Damage + Liability' },
    ]);
  });

  it('joined-string rendering (as the invoice/timeline sites do) reads as one CDW + RCLI', () => {
    const joined = getActiveCoverageLabels({ cdw: true, rcli: true, pai: true }, SHORT)
      .map((c) => c.label)
      .join(', ');
    expect(joined).toBe('CDW + RCLI, PAI');
  });
});
