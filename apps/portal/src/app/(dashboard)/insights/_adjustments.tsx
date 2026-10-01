'use client';

/**
 * Insights — correcting a single entry.
 *
 * Every itemised line in the receipt's dialogs can be re-priced or left out,
 * so an operator who knows "that $180 was really $120" or "that refund was a
 * test" can make the page add up to their books. The correction lives in
 * `insights_entry_adjustments` (ops/insights_entry_adjustments.sql) and NEVER
 * in the ledger: invoices, exports and every other screen keep the recorded
 * figure, and the line here always shows the original beside the correction
 * with a way back to it.
 */

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import { Switch } from '@/components/ui-v2/switch';
import { Input } from '@/components/ui-v2/input';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import { currencySymbol } from './_calculator';

/** Admins change what the page counts; everyone else reads it. RLS agrees. */
export function useCanEditInsights(): boolean {
  const { appUser } = useAuth();
  return !!appUser && (!!appUser.is_super_admin || ['head_admin', 'admin'].includes(appUser.role));
}

export type AdjustTarget = { kind: 'entry' | 'payment'; id: string };
type AdjustInput = AdjustTarget & { excluded: boolean; amount: number | null };

/**
 * Save one correction — or remove it, when it no longer changes anything.
 *
 * Delete-then-insert rather than an upsert: the uniqueness lives in two
 * PARTIAL indexes (one per target kind), which PostgREST's `onConflict`
 * cannot name.
 */
function useAdjustEntry() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = tenant?.id;

  return useMutation({
    mutationFn: async ({ kind, id, excluded, amount }: AdjustInput) => {
      if (!tenantId) throw new Error('No tenant');
      const column = kind === 'entry' ? 'pnl_entry_id' : 'payment_id';
      const { error: deleteError } = await supabaseUntyped
        .from('insights_entry_adjustments')
        .delete()
        .eq('tenant_id', tenantId)
        .eq(column, id);
      if (deleteError) throw deleteError;
      if (!excluded && amount == null) return;
      const { error } = await supabaseUntyped.from('insights_entry_adjustments').insert({
        tenant_id: tenantId,
        [column]: id,
        excluded,
        amount,
        updated_by: appUser?.is_super_admin ? null : (appUser?.id ?? null),
      });
      if (error) throw error;
    },
    onError: (error) =>
      toast.error("Couldn't save that change", {
        description: error instanceof Error ? error.message : 'Please try again.',
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['insights', tenantId] }),
  });
}

/**
 * One itemised line that can be corrected — controls always in view.
 *
 *   label / date · car        [ $ amount ]  ( counted ●)  ↺
 *
 * The amount is a live field: edit it and press Enter or leave the field to
 * save. The switch is "does this count?" — off leaves the line out of every
 * sum but keeps it listed, struck through, so it can be switched back. ↺
 * appears only on a changed line and returns it to the recorded figure.
 * Typing the recorded amount back in is "no correction", so it clears the
 * override rather than storing the same number.
 */
export function EntryLine({
  target,
  label,
  sub,
  amount,
  originalAmount,
  excluded,
  adjusted,
  currency,
}: {
  target: AdjustTarget;
  label: string;
  sub?: string | null;
  amount: number;
  originalAmount?: number;
  excluded?: boolean;
  adjusted?: boolean;
  currency: string;
}) {
  const canEdit = useCanEditInsights();
  const adjust = useAdjustEntry();
  const [draft, setDraft] = useState(amount.toFixed(2));

  // Follow the saved figure when it changes underneath (a save, a refetch).
  useEffect(() => setDraft(amount.toFixed(2)), [amount]);

  const money = (value: number) => formatCurrency(value, currency);
  const symbol = currencySymbol(currency);
  const recorded = originalAmount ?? amount;
  const counted = !excluded;
  const priced = originalAmount != null;

  const save = (input: Omit<AdjustInput, keyof AdjustTarget>) => adjust.mutate({ ...target, ...input });

  const commitDraft = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      setDraft(amount.toFixed(2));
      return;
    }
    if (Math.abs(parsed - amount) < 0.005) return;
    save({ excluded: !!excluded, amount: Math.abs(parsed - recorded) < 0.005 ? null : parsed });
  };

  const text = (
    <div className="min-w-0 flex-1">
      <p className={cn('truncate text-sm', excluded && 'text-muted-foreground line-through')}>{label}</p>
      {sub ? <p className="mt-0.5 text-xs break-words text-muted-foreground">{sub}</p> : null}
    </div>
  );

  if (!canEdit) {
    return (
      <div className="flex items-baseline justify-between gap-4 border-b border-foreground/5 py-2 last:border-b-0">
        {text}
        <div className="shrink-0 text-right">
          <p className={cn('text-sm tabular-nums', excluded && 'text-muted-foreground line-through')}>
            {money(amount)}
          </p>
          {excluded || priced ? (
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {excluded ? 'left out' : `was ${money(recorded)}`}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b border-foreground/5 py-2 last:border-b-0">
      {text}

      <div className="flex shrink-0 flex-col items-end">
        <span className="relative block">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
          {symbol}
        </span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={draft}
          disabled={excluded || adjust.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(amount.toFixed(2));
              e.currentTarget.blur();
            }
          }}
          aria-label={`Amount for ${label}`}
          className={cn(
            'h-8 w-32 text-right tabular-nums',
            priced && !excluded && 'font-medium',
            excluded && 'line-through',
          )}
        />
        </span>
        {priced ? (
          <span className="mt-0.5 pr-3 text-xs tabular-nums text-muted-foreground">was {money(recorded)}</span>
        ) : null}
      </div>

      <Switch
        checked={counted}
        disabled={adjust.isPending}
        onCheckedChange={(on) => save({ excluded: !on, amount: priced ? amount : null })}
        aria-label={counted ? `Leave ${label} out` : `Count ${label}`}
        title={counted ? 'Counted — switch off to leave it out' : 'Left out — switch on to count it'}
      />

      {/* Fixed-width slot, so a column of switches stays in line whether or
          not a row has anything to undo. */}
      <span className="flex size-7 shrink-0 items-center justify-center">
        {adjusted ? (
          <button
            type="button"
            disabled={adjust.isPending}
            onClick={() => save({ excluded: false, amount: null })}
            title={`Use the original ${money(recorded)}`}
            aria-label={`Use the original ${money(recorded)} for ${label}`}
            className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </span>
    </div>
  );
}
