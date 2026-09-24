'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, RotateCcw, Shuffle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { money, promoApi, SOURCE_LABEL, type PromoCode, type Referral, type TenantLite, type Tier } from './api';
import {
  CopyValue, TermsFields, TierEditor, draftFromTerms, termsFromDraft, tierDrafts, tiersFromDrafts,
  type TermsDraft, type TierDraft,
} from './shared';
import { VoidReferralDialog } from './referral-dialogs';

type Setup = {
  tenant: TenantLite & { contact_email: string | null; tenant_type: string | null };
  subscribed: boolean;
  settings: { referrals_enabled: boolean; brand_prefix: string | null; uses_default_referee_discount: boolean; show_name_on_invite: boolean };
  code: PromoCode | null;
  tiers: Tier[];
  customTiers: boolean;
  state: { active_referrals: number; total_referrals: number; current_discount_type: string | null; current_discount_value: number | null; last_evaluated_at: string | null; last_error: string | null } | null;
  referralsMade: Array<Referral & { referred_tenant_id: string }>;
  referredBy: Array<{ id: string; referrer_name_snapshot: string; source: Referral['source']; status: string; attributed_at: string }>;
  savedCents: number;
  programDefaults: { discountText: string; durationText: string };
};

/**
 * One operator's referral set-up: their code and link, what a new operator
 * gets, their reward tiers and who they referred.
 *
 * Opened with View from the Referral Links list (and from the leaderboard),
 * which is why it takes a tenant id and offers a way back rather than owning
 * an operator picker of its own.
 */
export function OperatorReferralView({
  tenantId, canEdit, onBack,
}: { tenantId: string; canEdit: boolean; onBack: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSetup(await promoApi<Setup>('get_tenant_referral', { tenantId }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2 gap-1.5" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> Back to referral links
      </Button>
      {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {setup && !loading && <OperatorSetup setup={setup} canEdit={canEdit} onChanged={load} />}
    </div>
  );
}

function OperatorSetup({ setup, canEdit, onChanged }: { setup: Setup; canEdit: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [brand, setBrand] = useState(setup.settings.brand_prefix ?? '');
  const [useDefault, setUseDefault] = useState(setup.settings.uses_default_referee_discount);
  const [terms, setTerms] = useState<TermsDraft>(draftFromTerms(setup.code));
  const [customTiers, setCustomTiers] = useState(setup.customTiers);
  const [tierRows, setTierRows] = useState<TierDraft[]>(tierDrafts(setup.tiers));
  const [voiding, setVoiding] = useState<Referral | null>(null);

  const run = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key);
    try {
      await promoApi('update_tenant_referral', { tenantId: setup.tenant.id, ...body });
      toast.success(done);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async () => {
    setBusy('regen');
    try {
      await promoApi('regenerate_code', { tenantId: setup.tenant.id });
      toast.success('New code made. The old one stops working.');
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      await promoApi('run_engine', { tenantId: setup.tenant.id });
      toast.success('Synced with Stripe');
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const state = setup.state;
  const reward = state?.current_discount_type
    ? `${state.current_discount_type === 'percent' ? `${Number(state.current_discount_value)}%` : `$${Number(state.current_discount_value)}`} off every bill`
    : 'No reward yet';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── their code ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{setup.tenant.company_name || setup.tenant.slug}</CardTitle>
              <CardDescription>
                {setup.subscribed ? 'Subscribed' : 'Not subscribed'}{setup.tenant.tenant_type === 'test' ? ' · test account' : ''}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={sync} disabled={busy !== null || !canEdit}>
              {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {setup.code ? (
            <>
              <CopyValue value={setup.code.code} label="Code" />
              {setup.code.link && <CopyValue value={setup.code.link} label="Link" />}
              <p className="text-sm">
                Their code gives a new operator{' '}
                <span className="font-medium">{setup.code.discountText} {setup.code.durationText}</span>.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No code yet — one is made when they subscribe, or make one now.</p>
          )}
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="brand">Brand part</Label>
                <Input id="brand" className="w-40 font-mono uppercase" placeholder="Automatic" value={brand}
                  onChange={e => setBrand(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} />
              </div>
              <Button variant="outline" size="sm" disabled={busy !== null || brand === (setup.settings.brand_prefix ?? '')}
                onClick={() => run('brand', { brandPrefix: brand || null }, 'Brand saved and a new code made')}>
                Save brand
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={regenerate}>
                {busy === 'regen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shuffle className="h-3.5 w-3.5" />}
                {setup.code ? 'New number' : 'Make a code'}
              </Button>
            </div>
          )}
          <div className="space-y-2 border-t border-border pt-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Referrals switched on for this operator</span>
              <Switch checked={setup.settings.referrals_enabled} disabled={!canEdit || busy !== null}
                onCheckedChange={v => run('enabled', { referralsEnabled: v }, v ? 'Referrals switched on' : 'Referrals switched off')} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Show their name on the invite (&ldquo;{setup.tenant.company_name} invited you&rdquo;)</span>
              <Switch checked={setup.settings.show_name_on_invite} disabled={!canEdit || busy !== null}
                onCheckedChange={v => run('showname', { showNameOnInvite: v }, 'Saved')} />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* ── standing ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Standing</CardTitle>
          <CardDescription>A referral counts while that operator stays subscribed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
            <Stat label="Subscribed referrals" value={String(state?.active_referrals ?? 0)} />
            <Stat label="Referred in total" value={String(state?.total_referrals ?? setup.referralsMade.filter(r => r.status === 'active').length)} />
            <Stat label="Saved so far" value={money(setup.savedCents)} />
          </div>
          <p className="text-sm">Current reward: <span className="font-medium">{reward}</span></p>
          {state?.last_error && <p className="text-xs text-destructive">Last sync problem: {state.last_error}</p>}
          {state?.last_evaluated_at && <p className="text-xs text-muted-foreground">Last synced {new Date(state.last_evaluated_at).toLocaleString()}</p>}
          {setup.referredBy.length > 0 && (
            <p className="text-sm">Referred by <span className="font-medium">{setup.referredBy[0].referrer_name_snapshot}</span>
              {setup.referredBy[0].status === 'void' ? ' (voided)' : ''}</p>
          )}
        </CardContent>
      </Card>

      {/* ── the discount their code gives ──────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What their code gives a new operator</CardTitle>
          <CardDescription>Platform default: {setup.programDefaults.discountText} {setup.programDefaults.durationText}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Use the platform default</span>
            <Switch checked={useDefault} disabled={!canEdit} onCheckedChange={setUseDefault} />
          </label>
          {!useDefault && <TermsFields value={terms} onChange={setTerms} disabled={!canEdit} />}
          {canEdit && (
            <Button size="sm" disabled={busy !== null}
              onClick={() => run('referee', { refereeDiscount: useDefault ? { useDefault: true } : { terms: termsFromDraft(terms) } },
                'Saved. Operators who already used the code keep what they got.')}>
              {busy === 'referee' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── their tier table ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Their reward tiers</CardTitle>
          <CardDescription>{setup.customTiers ? 'Custom for this operator.' : 'Using the platform default tiers.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Custom tiers for this operator</span>
            <Switch checked={customTiers} disabled={!canEdit} onCheckedChange={setCustomTiers} />
          </label>
          <TierEditor rows={tierRows} onChange={setTierRows} disabled={!canEdit || !customTiers} />
          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" disabled={busy !== null}
                onClick={() => run('tiers', { tiers: customTiers ? tiersFromDrafts(tierRows) : null },
                  customTiers ? 'Tiers saved. Their reward updates from their next bill.' : 'Back on the platform default tiers')}>
                {busy === 'tiers' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save tiers
              </Button>
              {setup.customTiers && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null}
                  onClick={() => run('tiers', { tiers: null }, 'Back on the platform default tiers')}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to default
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── who they referred ──────────────────────────────────────────── */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Operators they referred</CardTitle>
        </CardHeader>
        <CardContent>
          {setup.referralsMade.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {setup.referralsMade.map(r => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.referred_name_snapshot}</p>
                    <p className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[r.source]} · {new Date(r.attributed_at).toLocaleDateString()}
                      {r.status === 'void' && r.void_reason ? ` · voided: ${r.void_reason}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === 'void'
                      ? <Badge variant="outline">Voided</Badge>
                      : <Badge variant={r.counts ? 'success' : 'warning'}>{r.counts ? 'Counts' : 'Not subscribed'}</Badge>}
                    {canEdit && r.status === 'active' && (
                      <Button variant="ghost" size="sm" onClick={() => setVoiding(r)}>Void</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {voiding && (
        <VoidReferralDialog referral={voiding} onClose={() => setVoiding(null)} onDone={async () => { setVoiding(null); await onChanged(); }} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
