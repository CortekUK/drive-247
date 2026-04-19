'use client';

import type { CoverageSelection } from '@drive247/shared-types';
import { COVERAGE_TIER_LABELS } from '@drive247/shared-types';

interface Props {
  value: CoverageSelection;
  onChange: (value: CoverageSelection) => void;
}

const DESCRIPTIONS: Record<keyof CoverageSelection, string> = {
  cdw: 'Covers damage to the rental vehicle in an accident. $1,000 deductible, up to $35,000.',
  rcli: "Primary liability for damages to third parties when the renter is at fault. Covers state minimum.",
  sli: 'Excess liability on top of RCLI — up to $100,000 per person / $500,000 per accident.',
  pai: 'Personal accident: loss of life, medical expenses, personal effects for renter and passengers.',
};

/**
 * Four coverage tiles — CDW / RCLI / SLI / PAI. Enforces the business rule
 * that SLI requires RCLI (disabling SLI when RCLI is off). At least one
 * must be selected (enforced at submit by the parent form).
 */
export function CoverageTiles({ value, onChange }: Props) {
  const toggle = (key: keyof CoverageSelection) => {
    const next = { ...value, [key]: !value[key] };
    // SLI requires RCLI — auto-uncheck SLI when RCLI turns off
    if (key === 'rcli' && value.rcli === true) next.sli = false;
    onChange(next);
  };

  const tiles: Array<{
    key: keyof CoverageSelection;
    disabled?: boolean;
    disabledReason?: string;
  }> = [
    { key: 'cdw' },
    { key: 'rcli' },
    {
      key: 'sli',
      disabled: !value.rcli,
      disabledReason: 'Requires RCLI',
    },
    { key: 'pai' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map(({ key, disabled, disabledReason }) => {
        const checked = value[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => !disabled && toggle(key)}
            disabled={disabled}
            className={[
              'text-left rounded-md border p-3 transition-colors',
              disabled
                ? 'bg-[#f8fafc] border-[#e5e7eb] cursor-not-allowed opacity-60'
                : checked
                  ? 'bg-[#e0e7ff] border-[#6366f1]'
                  : 'bg-white border-[#e5e7eb] hover:border-[#c7d2fe]',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-sm">
                {COVERAGE_TIER_LABELS[key]}
              </span>
              <input
                type="checkbox"
                checked={checked}
                readOnly
                disabled={disabled}
                className="mt-1 h-4 w-4"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {DESCRIPTIONS[key]}
            </p>
            {disabled && disabledReason && (
              <p className="text-xs text-[#d97706] mt-1">{disabledReason}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
