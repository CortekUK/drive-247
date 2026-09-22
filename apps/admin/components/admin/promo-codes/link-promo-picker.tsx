'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, TicketPercent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { promoApi, type PromoCode } from './api';

const NONE = '__none__';

/**
 * "Promo / referral code" on a pending payment link (brief §2.2, option B).
 * The payment page the prospect opens then shows the discount and, for a
 * referral code, "Sunset Rentals invited you". One code per link.
 */
export function LinkPromoPicker({ tenantId }: { tenantId: string }) {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [selected, setSelected] = useState<string>(NONE);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await promoApi<{ codes: PromoCode[]; suggested: string | null; pendingLink: { id: string; promoCodeId: string | null } | null }>(
        'list_for_payment_link', { tenantId },
      );
      setCodes(res.codes);
      setSuggested(res.suggested);
      const current = res.codes.find(c => c.id === res.pendingLink?.promoCodeId);
      setSelected(current?.code ?? NONE);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const apply = async (code: string) => {
    setSaving(true);
    try {
      await promoApi('set_link_promo', { tenantId, code: code === NONE ? null : code });
      setSelected(code);
      toast.success(code === NONE ? 'Code removed from the link' : `${code} is on the link — the payment page shows the discount`);
    } catch (e) {
      toast.error((e as Error).message);
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <TicketPercent className="h-3.5 w-3.5" /> Promo / referral code on this link
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selected} onValueChange={apply} disabled={saving}>
          <SelectTrigger className="h-8 w-72 text-xs"><SelectValue placeholder="No code" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No code</SelectItem>
            {codes.map(c => (
              <SelectItem key={c.id} value={c.code}>
                {c.code} — {c.discountText} {c.durationText}{c.ownerName ? ` (${c.ownerName})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {suggested && suggested !== selected && codes.some(c => c.code === suggested) && (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={saving} onClick={() => apply(suggested)}>
            Came via {suggested} — apply
          </Button>
        )}
      </div>
    </div>
  );
}
