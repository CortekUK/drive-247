'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { promoApi, termsPreview, tierFor, type DiscountType, type Duration, type TenantLite, type Terms, type Tier } from './api';

/** A value with a Copy button — codes and referral links. */
export function CopyValue({ value, label, mono = true, className }: { value: string; label?: string; mono?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (non-HTTPS, permissions): the value is still selectable.
    }
  };
  return (
    <div className={cn('flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2', className)}>
      {label && <span className="shrink-0 text-xs text-muted-foreground">{label}</span>}
      <span className={cn('min-w-0 flex-1 truncate text-sm', mono && 'font-mono')} title={value}>{value}</span>
      <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 gap-1.5 px-2" onClick={copy} aria-label={`Copy ${label ?? 'value'}`}>
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export type TermsDraft = {
  discount_type: DiscountType;
  discount_value: string;
  duration: Duration;
  duration_months: string;
};

export function draftFromTerms(t?: Partial<Terms> | null): TermsDraft {
  return {
    discount_type: t?.discount_type ?? 'percent',
    discount_value: t?.discount_value != null ? String(t.discount_value) : '20',
    duration: t?.duration ?? 'repeating',
    duration_months: t?.duration_months != null ? String(t.duration_months) : '3',
  };
}

export function termsFromDraft(d: TermsDraft): Terms {
  return {
    discount_type: d.discount_type,
    discount_value: Number(d.discount_value),
    duration: d.duration,
    duration_months: d.duration === 'repeating' ? Number(d.duration_months) : null,
  };
}

/** Discount amount + how long it lasts, with a plain-English preview. */
export function TermsFields({ value, onChange, disabled }: { value: TermsDraft; onChange: (v: TermsDraft) => void; disabled?: boolean }) {
  const set = (patch: Partial<TermsDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Discount</Label>
          <div className="flex gap-2">
            <Select value={value.discount_type} onValueChange={v => set({ discount_type: v as DiscountType })} disabled={disabled}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percent</SelectItem>
                <SelectItem value="fixed">Dollars</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number" min={0} step="0.01" inputMode="decimal" disabled={disabled}
              value={value.discount_value} onChange={e => set({ discount_value: e.target.value })}
              aria-label={value.discount_type === 'percent' ? 'Percent off' : 'Dollars off'}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>For how long</Label>
          <div className="flex gap-2">
            <Select value={value.duration} onValueChange={v => set({ duration: v as Duration })} disabled={disabled}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="once">First bill only</SelectItem>
                <SelectItem value="repeating">A number of months</SelectItem>
                <SelectItem value="forever">Every bill</SelectItem>
              </SelectContent>
            </Select>
            {value.duration === 'repeating' && (
              <Input
                type="number" min={1} max={36} step="1" className="w-20" disabled={disabled}
                value={value.duration_months} onChange={e => set({ duration_months: e.target.value })}
                aria-label="Months"
              />
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A new operator gets: <span className="font-medium text-foreground">{termsPreview(termsFromDraft(value))}</span>
        {value.duration !== 'forever' && ' of real bills (a free trial month is not counted).'}
      </p>
    </div>
  );
}

export type TierDraft = { min: string; type: DiscountType; value: string };

export function tierDrafts(tiers: Tier[]): TierDraft[] {
  return tiers.map(t => ({ min: String(t.min_active_referrals), type: t.discount_type, value: String(t.discount_value) }));
}

export function tiersFromDrafts(rows: TierDraft[]): Tier[] {
  return rows.map(r => ({ min_active_referrals: Number(r.min), discount_type: r.type, discount_value: Number(r.value) }));
}

/**
 * The referrer's tier table, with a live preview that shows it is LEVELS, not a
 * running total: "With 2 subscribed referrals: 10% off every bill".
 */
export function TierEditor({ rows, onChange, disabled }: { rows: TierDraft[]; onChange: (rows: TierDraft[]) => void; disabled?: boolean }) {
  const tiers = useMemo(() => tiersFromDrafts(rows).filter(t => t.min_active_referrals >= 1 && t.discount_value > 0), [rows]);
  const maxMin = Math.max(5, ...tiers.map(t => t.min_active_referrals + 1));
  const update = (i: number, patch: Partial<TierDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const reward = (t: Tier | null) =>
    t ? `${t.discount_type === 'percent' ? `${t.discount_value}%` : `$${t.discount_value}`} off every bill` : 'no discount';

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">From</span>
            <Input type="number" min={1} step="1" className="w-20" value={r.min} disabled={disabled}
              onChange={e => update(i, { min: e.target.value })} aria-label="Subscribed referrals" />
            <span className="text-sm text-muted-foreground">subscribed referrals:</span>
            <Input type="number" min={0} step="0.01" className="w-24" value={r.value} disabled={disabled}
              onChange={e => update(i, { value: e.target.value })} aria-label="Discount" />
            <Select value={r.type} onValueChange={v => update(i, { type: v as DiscountType })} disabled={disabled}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">% off</SelectItem>
                <SelectItem value="fixed">$ off</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={disabled || rows.length === 1}
              onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove tier">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled || rows.length >= 20}
          onClick={() => {
            const last = rows[rows.length - 1];
            onChange([...rows, { min: String(Number(last?.min ?? 0) + 1), type: last?.type ?? 'percent', value: last?.value ?? '10' }]);
          }}>
          <Plus className="h-4 w-4" /> Add a tier
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Preview — the operator gets the discount of the highest tier reached. Tiers never add up.
        </p>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {Array.from({ length: maxMin + 1 }, (_, n) => (
            <p key={n}>
              With <span className="font-medium">{n}</span> subscribed referral{n === 1 ? '' : 's'}:{' '}
              <span className={cn(tierFor(tiers, n) ? 'text-foreground' : 'text-muted-foreground')}>{reward(tierFor(tiers, n))}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Search operators by name or slug. */
export function TenantPicker({
  value, onChange, placeholder = 'Search operators…', excludeId,
}: {
  value: TenantLite | null;
  onChange: (t: TenantLite | null) => void;
  placeholder?: string;
  excludeId?: string | null;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TenantLite[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await promoApi<{ tenants: TenantLite[] }>('search_tenants', { q });
        setResults(res.tenants.filter(t => t.id !== excludeId));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open, excludeId]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.company_name || value.slug}</p>
          <p className="truncate text-xs text-muted-foreground">{value.slug}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-9" placeholder={placeholder} value={q} onFocus={() => setOpen(true)}
        onChange={e => { setQ(e.target.value); setOpen(true); }} />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {results.map(t => (
            <button key={t.id} type="button" className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left hover:bg-muted"
              onClick={() => { onChange(t); setOpen(false); setQ(''); }}>
              <span className="text-sm font-medium">{t.company_name || t.slug}</span>
              <span className="text-xs text-muted-foreground">{t.slug}{t.status === 'suspended' ? ' · suspended' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Plain-English reason for a code the function refused. */
export function reasonText(reason: string): string {
  const map: Record<string, string> = {
    not_found: 'No such code',
    expired: 'This code has expired',
    maxed_out: 'This code has been used the maximum number of times',
    inactive: 'This code is switched off',
    plan_not_eligible: 'This code does not apply to this plan',
    programme_disabled: 'The referral programme is switched off',
    owner_disabled: "This operator's referrals are switched off",
    self_referral: 'An operator cannot use their own code',
    not_new_operator: 'Codes are for new operators only',
    already_referred: 'This operator was already referred by someone',
    one_code_per_checkout: 'Only one code per checkout',
  };
  return map[reason] ?? reason.replace(/_/g, ' ');
}
