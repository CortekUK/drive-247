'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { promoApi, type ProgramSettings, type Tier } from './api';
import { TermsFields, TierEditor, draftFromTerms, termsFromDraft, tierDrafts, tiersFromDrafts, type TermsDraft, type TierDraft } from './shared';

export function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<ProgramSettings | null>(null);
  const [terms, setTerms] = useState<TermsDraft | null>(null);
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [engineReport, setEngineReport] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await promoApi<{ settings: ProgramSettings; defaultTiers: Tier[] }>('get_program_settings', {});
      setSettings(res.settings);
      setTerms(draftFromTerms({
        discount_type: res.settings.default_referee_discount_type,
        discount_value: res.settings.default_referee_discount_value,
        duration: res.settings.default_referee_duration,
        duration_months: res.settings.default_referee_duration_months,
      }));
      setTiers(tierDrafts(res.defaultTiers));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key);
    try {
      await promoApi('update_program_settings', body);
      toast.success(done);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runEngine = async () => {
    setBusy('engine');
    try {
      const res = await promoApi<{ engine: Record<string, unknown> }>('run_engine', {});
      const e = res.engine ?? {};
      setEngineReport(
        e.skipped ? String(e.skipped)
          : `Codes made ${e.codesCreated ?? 0}, rotated ${e.codesRotated ?? 0} · new subscriptions checked ${e.subscriptionsScanned ?? 0}, codes found ${e.redemptionsFound ?? 0} · referrers ${e.referrersEvaluated ?? 0}, tier changes ${e.tiersChanged ?? 0}, Stripe updates ${e.stripeUpdates ?? 0}` +
            (Array.isArray(e.errors) && e.errors.length ? ` · problems: ${(e.errors as string[]).join('; ')}` : ''),
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!settings || !terms) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Programme</CardTitle>
          <CardDescription>Switching it off stops referral codes working at checkout. Rewards already on bills are removed on the next sync.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Referral programme on</span>
            <Switch checked={settings.enabled} disabled={!canEdit || busy !== null}
              onCheckedChange={v => save('enabled', { enabled: v }, v ? 'Programme switched on' : 'Programme switched off')} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Digits in each code</Label>
              <Select value={String(settings.code_suffix_length)} disabled={!canEdit || busy !== null}
                onValueChange={v => save('digits', { codeSuffixLength: Number(v) }, 'Saved. New codes use this many digits.')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 (SUNSET-482)</SelectItem>
                  <SelectItem value="4">4 (SUNSET-4821)</SelectItem>
                  <SelectItem value="6">6 (SUNSET-482193)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cookie-days">Remember a referral link for (days)</Label>
              <Input id="cookie-days" type="number" min={1} max={365} defaultValue={settings.link_cookie_days} disabled={!canEdit}
                onBlur={e => {
                  const v = Number(e.target.value);
                  if (v !== settings.link_cookie_days) save('cookie', { linkCookieDays: v }, 'Saved');
                }} />
            </div>
          </div>
          {canEdit && (
            <div className="space-y-2 border-t border-border pt-3">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={runEngine} disabled={busy !== null}>
                {busy === 'engine' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run the referral engine now
              </Button>
              <p className="text-xs text-muted-foreground">It also runs by itself every 15 minutes.</p>
              {engineReport && <p className="text-xs">{engineReport}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Default discount for a new operator</CardTitle>
          <CardDescription>What a referral code gives, unless an operator has custom terms. Changing it moves every default code to the new terms; anyone who already used a code keeps what they got.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <TermsFields value={terms} onChange={setTerms} disabled={!canEdit} />
          {canEdit && (
            <Button size="sm" disabled={busy !== null} onClick={() => save('referee', { refereeDiscount: termsFromDraft(terms) }, 'Default discount saved')}>
              {busy === 'referee' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Default reward tiers for referrers</CardTitle>
          <CardDescription>Used by every operator without custom tiers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <TierEditor rows={tiers} onChange={setTiers} disabled={!canEdit} />
          {canEdit && (
            <Button size="sm" disabled={busy !== null} onClick={() => save('tiers', { defaultTiers: tiersFromDrafts(tiers) }, 'Default tiers saved')}>
              {busy === 'tiers' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save tiers
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
