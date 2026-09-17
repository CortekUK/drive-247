'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { loadTenantsByIds } from '@/lib/announcements/api';
import {
  SEGMENTS,
  SEGMENT_KEYS,
  type Audience,
  type Blocking,
  type SegmentKey,
} from '@/lib/announcements/contract';
import type { PickerTenant } from '@/lib/announcements/tenant-filters';
import { cn } from '@/lib/utils';
import { FormField, QUIET_BUTTON } from './form-field';
import { radioKeyTarget, radioTabStop } from './form-logic';
import { SegmentMatches } from './segment-matches';
import { TenantPickerDialog } from './tenant-picker-dialog';

const AUDIENCE_OPTIONS: ReadonlyArray<{ value: Audience; label: string }> = [
  { value: 'all', label: 'All tenants' },
  { value: 'selected', label: 'Specific tenants' },
  { value: 'segment', label: 'Smart filter' },
];

const CHIP_LIMIT = 5;

/**
 * Who sees the announcement: every tenant, a hand-picked list, or a smart
 * filter the database evaluates on every portal read (so tenants enter and
 * leave it by themselves, with no cron).
 */
export function TargetingField({
  audience,
  segmentKey,
  tenantIds,
  blocking,
  showStripeBannerNote,
  errors,
  onChange,
}: {
  audience: Audience;
  segmentKey: SegmentKey | null;
  tenantIds: readonly string[];
  /** Hard items cannot use a smart filter tenants cannot clear themselves. */
  blocking: Blocking;
  showStripeBannerNote: boolean;
  errors: { audience?: string; segment_key?: string; tenant_ids?: string };
  onChange: (patch: { audience?: Audience; segment_key?: SegmentKey | null; tenant_ids?: string[] }) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showAllChips, setShowAllChips] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  // Names for chips of an existing selection (the picker fills this in as well).
  const missing = tenantIds.filter((id) => names[id] === undefined);
  const missingKey = audience === 'selected' ? missing.join(',') : '';
  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    const ids = missingKey.split(',');
    void loadTenantsByIds(ids).then((result) => {
      if (cancelled || !result.ok) return;
      setNames((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = 'Deleted tenant';
        for (const t of result.data) next[t.id] = t.company_name;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  const rememberNames = (tenants: PickerTenant[]) =>
    setNames((prev) => {
      const next = { ...prev };
      for (const t of tenants) next[t.id] = t.company_name;
      return next;
    });

  const hard = blocking === 'hard';
  const chooseRef = useRef<HTMLButtonElement>(null);
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const segmentDisabled = (index: number) => hard && !SEGMENTS[SEGMENT_KEYS[index]].hardAllowed;
  const segmentTabStop = radioTabStop(segmentKey ? SEGMENT_KEYS.indexOf(segmentKey) : -1, SEGMENT_KEYS.length, segmentDisabled);

  const onSegmentKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = radioKeyTarget(e.key, index, SEGMENT_KEYS.length, segmentDisabled);
    if (next === null) return;
    e.preventDefault();
    segmentRefs.current[next]?.focus();
    onChange({ segment_key: SEGMENT_KEYS[next] });
  };

  return (
    <div className="space-y-3">
      <FormField label="Audience" htmlFor="ann-audience" error={errors.audience}>
        <Select value={audience} onValueChange={(v) => onChange({ audience: v as Audience })}>
          <SelectTrigger id="ann-audience" className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUDIENCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {audience === 'selected' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={chooseRef}
              id="ann-tenant-ids"
              type="button"
              variant="outline"
              size="sm"
              className={QUIET_BUTTON}
              onClick={() => setPickerOpen(true)}
            >
              <Users />
              Choose tenants
            </Button>
            <span className="text-sm text-muted-foreground">{tenantIds.length} selected</span>
          </div>
          {tenantIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(showAllChips ? tenantIds : tenantIds.slice(0, CHIP_LIMIT)).map((id) => (
                // The chip is a flex row (name + remove button); the NAME is the
                // block that truncates, because text-overflow does nothing on a flex container.
                <span
                  key={id}
                  className="inline-flex max-w-[16rem] items-center gap-0.5 rounded-full bg-secondary py-0.5 pl-2.5 pr-0.5 text-xs font-medium text-secondary-foreground"
                >
                  <span className="block min-w-0 truncate" title={names[id]}>
                    {names[id] ?? '…'}
                  </span>
                  <button
                    type="button"
                    aria-label={'Remove ' + (names[id] ?? 'this tenant')}
                    title="Remove"
                    onClick={() => onChange({ tenant_ids: tenantIds.filter((t) => t !== id) })}
                    className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-indigo-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-indigo-500/20"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              {tenantIds.length > CHIP_LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowAllChips((v) => !v)}
                  className="inline-flex cursor-pointer items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-indigo-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-indigo-500/20"
                >
                  {showAllChips ? 'Show less' : '+' + (tenantIds.length - CHIP_LIMIT) + ' more'}
                </button>
              )}
            </div>
          )}
          {errors.tenant_ids && (
            <p role="alert" className="text-xs font-medium leading-5 text-destructive">
              {errors.tenant_ids}
            </p>
          )}
          <TenantPickerDialog
            open={pickerOpen}
            initialSelected={tenantIds}
            returnFocusRef={chooseRef}
            onCancel={() => setPickerOpen(false)}
            onConfirm={(ids, tenants) => {
              rememberNames(tenants);
              onChange({ tenant_ids: ids });
              setPickerOpen(false);
            }}
          />
        </div>
      )}

      {audience === 'segment' && (
        <div className="space-y-3">
          <div id="ann-segment-key" role="radiogroup" aria-label="Smart filter" tabIndex={-1} className="space-y-2 outline-none">
            {SEGMENT_KEYS.map((key, index) => {
              const seg = SEGMENTS[key];
              const disabled = segmentDisabled(index);
              const checked = segmentKey === key;
              return (
                <button
                  key={key}
                  ref={(el) => {
                    segmentRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={disabled}
                  tabIndex={index === segmentTabStop ? 0 : -1}
                  onClick={() => onChange({ segment_key: key })}
                  onKeyDown={(e) => onSegmentKeyDown(e, index)}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-3 rounded-2xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60',
                    checked ? 'border-primary/40 bg-primary/10' : 'border-border hover:bg-primary/5',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      checked ? 'border-primary' : 'border-input',
                    )}
                  >
                    {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                      {seg.label}
                      {!seg.hardAllowed && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          Cannot be used with Hard
                        </span>
                      )}
                    </span>
                    <span className="block text-xs leading-5 text-muted-foreground">{seg.description}</span>
                    <span className="block text-xs leading-5 text-muted-foreground">{seg.clearsWhen}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {errors.segment_key && (
            <p role="alert" className="text-xs font-medium leading-5 text-destructive">
              {errors.segment_key}
            </p>
          )}
          {segmentKey && <SegmentMatches segmentKey={segmentKey} />}
        </div>
      )}

      {showStripeBannerNote && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          These tenants already see the red Connect Stripe banner. A dialog avoids showing the same message twice.
        </p>
      )}
    </div>
  );
}
