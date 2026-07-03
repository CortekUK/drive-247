// Shared coverage-label formatter for Bonzah insurance display.
//
// ⚠️ KEEP THIS FILE BYTE-IDENTICAL in apps/booking/src/lib and apps/portal/src/lib
// (same convention as calculate-rental-price.ts / calculate-extras-total.ts).
//
// Bonzah stores coverage as four independent booleans on `coverage_types`
// ({cdw, rcli, sli, pai}). When BOTH cdw and rcli are present we display them as a
// single "CDW + RCLI" entry (the bundle) instead of two separate chips; sli and pai
// always render on their own. This is display-only — storage is unchanged, so it
// works for coverage picked as a bundle OR as two individual coverages.

export type CoverageLabelMap = Record<string, string>;

export interface CoverageLabelEntry {
  key: string;
  label: string;
}

/**
 * Ordered active-coverage entries for display, merging CDW + RCLI into one entry
 * when both are selected. `labels` supplies the per-coverage text (short or full,
 * per the call site); `mergedLabel` is the combined CDW+RCLI text (default
 * "CDW + RCLI"). SLI and PAI are never merged.
 */
export function getActiveCoverageLabels(
  coverageTypes: Record<string, any> | null | undefined,
  labels: CoverageLabelMap,
  mergedLabel = 'CDW + RCLI',
): CoverageLabelEntry[] {
  const ct = coverageTypes || {};
  const out: CoverageLabelEntry[] = [];
  const hasCdw = !!ct.cdw;
  const hasRcli = !!ct.rcli;

  if (hasCdw && hasRcli) {
    out.push({ key: 'cdw_rcli', label: mergedLabel });
  } else if (hasCdw) {
    out.push({ key: 'cdw', label: labels.cdw });
  } else if (hasRcli) {
    out.push({ key: 'rcli', label: labels.rcli });
  }
  if (ct.sli) out.push({ key: 'sli', label: labels.sli });
  if (ct.pai) out.push({ key: 'pai', label: labels.pai });

  return out;
}
