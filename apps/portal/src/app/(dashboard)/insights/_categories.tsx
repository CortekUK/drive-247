'use client';

/**
 * Insights — "what counts where".
 *
 * Every ledger category lands on one line of the receipt by default (see
 * `defaultBucket` in `_money-model.ts`). The defaults are right for most
 * operators, but an operator who knows their own books better — "my delivery
 * fee is passed straight to a driver", "that Disposal row was a write-off,
 * leave it out" — can move a category here, and every figure on the page
 * follows: receipt, dialogs, charts and the calculator all read one
 * classification.
 *
 * Saved per tenant in `insights_category_rules`. Choosing the default again
 * DELETES the override rather than storing it, so the table only ever holds
 * real differences, and a later change to the defaults reaches every
 * category nobody chose to move.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui-v2/dialog';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import { COST_SIDE, REVENUE_SIDE, RULES_FOR_SIDE, ruleKey, type Rule } from './_money-model';
import type { CategoryTotal, InsightsData } from './_data';

/** What each bucket is called on the receipt — the operator's words, not ours. */
export const RULE_LABELS: Record<Rule, string> = {
  operating_revenue: 'Money you took in',
  non_revenue: 'Money that was never yours',
  operating_cost: 'Money you spent',
  capital_cost: 'Car purchases',
  ignored: 'Leave it out',
};

/**
 * The same choices, short enough to sit three abreast. The receipt's full
 * wording lives in `RULE_LABELS` (the "usually …" link and the title).
 */
const RULE_SHORT: Record<Rule, string> = {
  operating_revenue: 'Took in',
  non_revenue: 'Never yours',
  operating_cost: 'Spent',
  capital_cost: 'Car purchase',
  ignored: 'Leave out',
};

/**
 * Three options in a row, with a sliding pill under the chosen one — the
 * sidebar's Portal / Website switch, widened to three. Radio semantics, so a
 * screen reader hears one choice out of three rather than three buttons.
 */
function RuleSwitch({
  options,
  value,
  disabled,
  label,
  onChange,
}: {
  options: Rule[];
  value: Rule;
  disabled?: boolean;
  label: string;
  onChange: (value: Rule) => void;
}) {
  const index = Math.max(0, options.indexOf(value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="relative grid shrink-0 self-start rounded-full bg-muted p-1 sm:self-auto"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-background shadow-sm ring-1 ring-primary/20 [transition:transform_200ms_ease-out] motion-reduce:transition-none"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            title={RULE_LABELS[option]}
            disabled={disabled}
            onClick={() => !active && onChange(option)}
            className={cn(
              'relative z-10 h-8 cursor-pointer rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 motion-reduce:transition-none',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default',
              active
                ? 'text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]'
                : 'text-muted-foreground enabled:hover:text-foreground',
            )}
          >
            {RULE_SHORT[option]}
          </button>
        );
      })}
    </div>
  );
}

type SaveInput = { side: string; category: string; rule: Rule; defaultRule: Rule };

/** Save one override, or delete it when the choice is the default again. */
function useSaveCategoryRule() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = tenant?.id;

  return useMutation({
    mutationFn: async ({ side, category, rule, defaultRule }: SaveInput) => {
      if (!tenantId) throw new Error('No tenant');
      if (rule === defaultRule) {
        const { error } = await supabaseUntyped
          .from('insights_category_rules')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('side', side)
          .eq('category', category);
        if (error) throw error;
        return;
      }
      const { error } = await supabaseUntyped.from('insights_category_rules').upsert(
        {
          tenant_id: tenantId,
          side,
          category,
          bucket: rule,
          // Super admins carry no tenant row of their own here; the column is
          // nullable for exactly that.
          updated_by: appUser?.is_super_admin ? null : (appUser?.id ?? null),
        },
        { onConflict: 'tenant_id,side,category' },
      );
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['insights', tenantId] }),
  });
}

export function CategoriesDialog({
  open,
  onOpenChange,
  data,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: InsightsData | undefined;
  currency: string;
}) {
  const { appUser } = useAuth();
  const canEdit = !!appUser && (appUser.is_super_admin || ['head_admin', 'admin'].includes(appUser.role));
  const save = useSaveCategoryRule();

  /*
   * Local choices, so a select shows what was picked the moment it is picked
   * rather than snapping back while the page refetches. Re-seeded from the
   * data every time the dialog opens.
   */
  const [local, setLocal] = useState<Map<string, Rule>>(new Map());
  useEffect(() => {
    if (open) setLocal(new Map((data?.categories ?? []).map((c) => [ruleKey(c.side, c.category), c.rule])));
  }, [open, data?.categories]);

  const categories = data?.categories ?? [];
  const moneyIn = useMemo(() => categories.filter((c) => c.side === REVENUE_SIDE), [categories]);
  const moneyOut = useMemo(() => categories.filter((c) => c.side === COST_SIDE), [categories]);

  const ruleOf = (c: CategoryTotal) => local.get(ruleKey(c.side, c.category)) ?? c.rule;
  const moved = categories.filter((c) => ruleOf(c) !== c.defaultRule);

  const choose = (c: CategoryTotal, rule: Rule) => {
    const key = ruleKey(c.side, c.category);
    const previous = ruleOf(c);
    setLocal((m) => new Map(m).set(key, rule));
    save.mutate(
      { side: c.side, category: c.category, rule, defaultRule: c.defaultRule },
      {
        onError: (error) => {
          setLocal((m) => new Map(m).set(key, previous));
          toast.error(`Couldn't move ${c.category}`, {
            description: error instanceof Error ? error.message : 'Please try again.',
          });
        },
      },
    );
  };

  const resetAll = () => moved.forEach((c) => choose(c, c.defaultRule));

  const money = (amount: number) =>
    formatCurrency(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const section = (title: string, rows: CategoryTotal[]) =>
    rows.length === 0 ? null : (
      <section>
        <h3 className="px-1 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {title}
        </h3>
        <div className="mt-2 divide-y divide-foreground/5">
          {rows.map((c) => {
            const rule = ruleOf(c);
            const isMoved = rule !== c.defaultRule;
            return (
              <div
                key={ruleKey(c.side, c.category)}
                className="flex flex-col gap-3 px-1 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.category}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                    {c.count > 0
                      ? `${money(c.amount)} · ${c.count.toLocaleString()} ${c.count === 1 ? 'entry' : 'entries'} this period`
                      : 'nothing this period'}
                    {isMoved ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => choose(c, c.defaultRule)}
                          className="cursor-pointer text-foreground underline-offset-2 hover:underline disabled:cursor-default disabled:no-underline"
                        >
                          usually {RULE_LABELS[c.defaultRule].toLowerCase()}
                        </button>
                      </>
                    ) : null}
                  </p>
                </div>
                <RuleSwitch
                  options={RULES_FOR_SIDE[c.side]}
                  value={rule}
                  disabled={!canEdit}
                  label={`Where ${c.category} counts`}
                  onChange={(value) => choose(c, value)}
                />
              </div>
            );
          })}
        </div>
      </section>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What counts where</DialogTitle>
          <DialogDescription>
            Each kind of charge lands on one line of the receipt. The defaults suit most
            businesses — move one if your books say otherwise, and every figure on the page follows.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
          {categories.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing has been recorded in this period yet, so there is nothing to sort.
            </p>
          ) : (
            <>
              {section('Money in', moneyIn)}
              {section('Money out', moneyOut)}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 pt-4 text-[13px] text-muted-foreground">
          <span>
            {canEdit
              ? 'Saved as you go, for everyone on your team.'
              : 'Only an admin can change these.'}
          </span>
          {canEdit && moved.length > 0 ? (
            <button
              type="button"
              onClick={resetAll}
              className="flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Back to defaults ({moved.length})
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
