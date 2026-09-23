'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Power, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';
import { promoApi, type PromoCode } from './api';
import { CopyValue, TermsFields, draftFromTerms, termsFromDraft, type TermsDraft } from './shared';

type Kind = 'all' | 'campaign' | 'referral';
type Status = 'all' | 'active' | 'inactive' | 'superseded';

export function CodesTab({ canEdit }: { canEdit: boolean }) {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>('all');
  const [status, setStatus] = useState<Status>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PromoCode | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await promoApi<{ codes: PromoCode[] }>('list', {
        ...(kind !== 'all' ? { kind } : {}),
        ...(status !== 'all' ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      setCodes(res.codes);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kind, status, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const toggle = async (c: PromoCode) => {
    setBusyId(c.id);
    try {
      await promoApi('set_status', { id: c.id, status: c.status === 'active' ? 'inactive' : 'active' });
      toast.success(c.status === 'active' ? `${c.code} switched off` : `${c.code} switched on`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="code-search">Search</Label>
          <Input id="code-search" placeholder="SUNSET, LAUNCH50…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Kind</Label>
          <Select value={kind} onValueChange={v => setKind(v as Kind)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All codes</SelectItem>
              <SelectItem value="campaign">Drive247 campaigns</SelectItem>
              <SelectItem value="referral">Operator referral codes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={v => setStatus(v as Status)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Switched off</SelectItem>
              <SelectItem value="superseded">Old versions</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="icon" onClick={load} aria-label="Reload"><RefreshCw className="h-4 w-4" /></Button>
        {canEdit && (
          <Button className="gap-1.5" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New campaign code</Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>New operator gets</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
              ) : codes.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No codes match.</TableCell></TableRow>
              ) : codes.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="min-w-[220px]">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{c.code}</span>
                        <Badge variant={c.kind === 'campaign' ? 'info' : 'secondary'}>{c.kind === 'campaign' ? 'Campaign' : 'Referral'}</Badge>
                      </div>
                      {c.link && c.status === 'active' && <CopyValue value={c.link} label="Link" className="py-1" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{c.ownerName ?? <span className="text-muted-foreground">Drive247</span>}</TableCell>
                  <TableCell className="text-sm">
                    {c.discountText} <span className="text-muted-foreground">{c.durationText}</span>
                    {c.expires_at && <p className="text-xs text-muted-foreground">Expires {new Date(c.expires_at).toLocaleDateString()}</p>}
                    {c.restrict_signup_plan_keys && c.restrict_signup_plan_keys.length > 0 && (
                      <p className="text-xs text-muted-foreground">Plans: {c.restrict_signup_plan_keys.join(', ')}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{c.redemptions ?? 0}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'active' ? 'success' : c.status === 'inactive' ? 'warning' : 'outline'}>
                      {c.status === 'active' ? 'Active' : c.status === 'inactive' ? 'Off' : 'Old version'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && c.status !== 'superseded' && (
                      <div className="flex justify-end gap-1">
                        {c.status === 'active' && (
                          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                        )}
                        <Button variant="ghost" size="sm" className="gap-1.5" disabled={busyId === c.id} onClick={() => toggle(c)}>
                          {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                          {c.status === 'active' ? 'Switch off' : 'Switch on'}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <CodeDialog
          code={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function CodeDialog({ code, onClose, onSaved }: { code: PromoCode | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const isCampaign = !code || code.kind === 'campaign';
  const [codeText, setCodeText] = useState(code?.code ?? '');
  const [terms, setTerms] = useState<TermsDraft>(draftFromTerms(code ?? { discount_type: 'percent', discount_value: 50, duration: 'repeating', duration_months: 3 }));
  const [maxUses, setMaxUses] = useState(code?.max_redemptions ? String(code.max_redemptions) : '');
  const [expires, setExpires] = useState(code?.expires_at ? code.expires_at.slice(0, 10) : '');
  const [plans, setPlans] = useState((code?.restrict_signup_plan_keys ?? []).join(', '));
  const [note, setNote] = useState(code?.note ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...termsFromDraft(terms),
        ...(isCampaign ? {
          max_redemptions: maxUses.trim() ? Number(maxUses) : null,
          // End of the chosen day, UTC: "expires 31 Oct" means usable on 31 Oct.
          expires_at: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null,
          restrict_signup_plan_keys: plans.split(',').map(s => s.trim()).filter(Boolean),
        } : {}),
        note,
      };
      if (!code) {
        await promoApi('create_campaign', { code: codeText, terms: payload });
        toast.success(`${codeText.toUpperCase()} created`);
      } else {
        await promoApi('update_code', { id: code.id, terms: payload, ...(isCampaign ? { code: codeText } : {}) });
        toast.success(`${code.code} updated`);
      }
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{code ? `Edit ${code.code}` : 'New Drive247 campaign code'}</DialogTitle>
          <DialogDescription>
            {code
              ? 'Saving makes a new version of this code. Operators who already used it keep the terms they got.'
              : 'Money off a new operator’s Drive247 subscription. Nobody’s referral tier changes when a campaign code is used.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {isCampaign && (
            <div className="space-y-1.5">
              <Label htmlFor="campaign-code">Code</Label>
              <Input id="campaign-code" className="font-mono uppercase" placeholder="LAUNCH50" value={codeText}
                onChange={e => setCodeText(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} />
              <p className="text-xs text-muted-foreground">Letters, numbers and single dashes. Not case-sensitive for customers.</p>
            </div>
          )}
          <TermsFields value={terms} onChange={setTerms} />
          {isCampaign && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="max-uses">Maximum uses</Label>
                <Input id="max-uses" type="number" min={1} placeholder="No limit" value={maxUses} onChange={e => setMaxUses(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expires">Expires on</Label>
                <Input id="expires" type="date" value={expires} onChange={e => setExpires(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="plans">Only for these signup plans</Label>
                <Input id="plans" placeholder="Leave empty for any plan (self-serve plan keys, comma separated)" value={plans} onChange={e => setPlans(e.target.value)} />
                <p className="text-xs text-muted-foreground">A plan-limited code works on self-serve signup only, not on sales payment links.</p>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="note">Internal note</Label>
            <Textarea id="note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Why this code exists (not shown to operators)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || (isCampaign && !codeText.trim())}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {code ? 'Save new version' : 'Create code'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
