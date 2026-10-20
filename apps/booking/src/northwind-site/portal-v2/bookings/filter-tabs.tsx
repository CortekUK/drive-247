'use client';

/**
 * The bookings filter: the operator portal's segmented control (the sidebar's
 * Portal / Website switch, shared/portal-v2/segmented-control.tsx) with each
 * option's count in the badge beside its label. Full width on a phone, where a
 * customer taps it; its own width from `sm`.
 */

import { SegmentedControl } from '@portal-v2-shared/segmented-control';

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  counts,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Omitted while loading, so a tab never states a count it does not have. */
  counts?: Record<T, number>;
  label: string;
}) {
  return (
    <SegmentedControl
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      counts={counts}
      className="w-full sm:w-fit"
    />
  );
}
