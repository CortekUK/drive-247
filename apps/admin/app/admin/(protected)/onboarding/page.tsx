'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CreateTenantDialog from '@/components/admin/CreateTenantDialog';
import BonzahSubmissions from '@/components/admin/BonzahSubmissions';
import {
  ClipboardCheck,
  Plus,
  Search,
  Settings2,
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  Send,
  EyeOff,
  Eye,
  PartyPopper,
  Clock,
  Mail,
} from 'lucide-react';

interface OnboardingRow {
  tenant_id: string;
  slug: string;
  company_name: string;
  contact_email: string | null;
  admin_name: string | null;
  created_at: string;
  branding_auto: boolean;
  branding_override: boolean;
  branding_done: boolean;
  subscription_auto: boolean;
  subscription_override: boolean;
  subscription_done: boolean;
  bonzah_auto: boolean;
  bonzah_override: boolean;
  bonzah_done: boolean;
  bonzah_form_submitted: boolean;
  bonzah_form_status: string | null;
  brandon_sent: boolean;
  brandon_sent_at: string | null;
  excluded: boolean;
  notes: string | null;
}

type ItemKey = 'branding' | 'subscription' | 'bonzah';

interface ChecklistItem {
  key: ItemKey;
  label: string;
  owner: string;
  autoHint: string;
}

const ITEMS: ChecklistItem[] = [
  { key: 'branding', label: 'Branding', owner: 'Haseeb', autoHint: 'Auto-clears when the paywall (subscription plan) is set up' },
  { key: 'subscription', label: 'Subscription', owner: 'George', autoHint: 'Auto-clears when the tenant pays through the paywall ($1 card capture)' },
  { key: 'bonzah', label: 'Bonzah', owner: 'Haseeb', autoHint: 'Auto-clears when the Bonzah integration goes live' },
];

const doneCount = (r: OnboardingRow) =>
  ITEMS.filter((i) => r[`${i.key}_done` as keyof OnboardingRow] === true).length;
const isFullyOnboarded = (r: OnboardingRow) => doneCount(r) === ITEMS.length;

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

export default function OnboardingPage() {
  const [rows, setRows] = useState<OnboardingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showExcluded, setShowExcluded] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // `${tenantId}:${action}`

  const loadRows = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('v_tenant_onboarding_status')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows((data || []) as OnboardingRow[]);
    } catch (err: any) {
      toast.error('Failed to load onboarding status: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  const toggleOverride = async (row: OnboardingRow, key: ItemKey) => {
    const field = `${key}_override` as const;
    const next = !row[field];
    setBusy(`${row.tenant_id}:${key}`);
    try {
      const { error } = await (supabase as any)
        .from('tenant_onboarding_checklist')
        .upsert({ tenant_id: row.tenant_id, [field]: next }, { onConflict: 'tenant_id' });
      if (error) throw error;
      setRows((prev) =>
        prev.map((r) =>
          r.tenant_id === row.tenant_id
            ? {
                ...r,
                [field]: next,
                [`${key}_done`]: r[`${key}_auto` as keyof OnboardingRow] === true || next,
              }
            : r,
        ),
      );
    } catch (err: any) {
      toast.error(`Failed to update: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const toggleExcluded = async (row: OnboardingRow) => {
    const next = !row.excluded;
    setBusy(`${row.tenant_id}:excluded`);
    try {
      const { error } = await (supabase as any)
        .from('tenant_onboarding_checklist')
        .upsert({ tenant_id: row.tenant_id, excluded: next }, { onConflict: 'tenant_id' });
      if (error) throw error;
      setRows((prev) =>
        prev.map((r) => (r.tenant_id === row.tenant_id ? { ...r, excluded: next } : r)),
      );
      toast.success(next ? `${row.company_name} hidden from onboarding tracking` : `${row.company_name} back in onboarding tracking`);
    } catch (err: any) {
      toast.error(`Failed to update: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const sendToBrandon = async (row: OnboardingRow) => {
    setBusy(`${row.tenant_id}:brandon`);
    try {
      const { data, error } = await supabase.functions.invoke('send-bonzah-form-to-brandon', {
        body: { tenant_id: row.tenant_id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setRows((prev) =>
        prev.map((r) =>
          r.tenant_id === row.tenant_id
            ? { ...r, brandon_sent: true, brandon_sent_at: data?.brandon_sent_at ?? new Date().toISOString() }
            : r,
        ),
      );
      toast.success(`Form details sent to ${data?.sent_to || 'Brandon'}`);
    } catch (err: any) {
      toast.error(`Send failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const visibleRows = useMemo(() => {
    return rows
      .filter((r) => (showExcluded ? true : !r.excluded))
      .filter((r) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          r.company_name?.toLowerCase().includes(q) ||
          r.slug?.toLowerCase().includes(q) ||
          r.contact_email?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // in-progress first, fully onboarded at the bottom, then newest first
        const aDone = isFullyOnboarded(a) ? 1 : 0;
        const bDone = isFullyOnboarded(b) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [rows, searchQuery, showExcluded]);

  const counts = useMemo(() => {
    const tracked = rows.filter((r) => !r.excluded);
    const onboarded = tracked.filter(isFullyOnboarded).length;
    return {
      inProgress: tracked.length - onboarded,
      onboarded,
      excluded: rows.filter((r) => r.excluded).length,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Onboarding</h1>
            <p className="text-sm text-muted-foreground">
              Track every rental company from creation to fully live
              {counts.inProgress > 0 && (
                <span className="text-warning"> · {counts.inProgress} in progress</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowSettings(true)}>
            <Settings2 className="h-4 w-4" />
            Digest Settings
          </Button>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" />
            Create Rental
          </Button>
        </div>
      </div>

      <Tabs defaultValue="checklist">
        <TabsList>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          <TabsTrigger value="forms">Bonzah Forms</TabsTrigger>
        </TabsList>

        <TabsContent value="checklist" className="space-y-6 mt-4">
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: Clock, label: 'In Progress', count: counts.inProgress, accent: 'warning' },
              { icon: PartyPopper, label: 'Fully Onboarded', count: counts.onboarded, accent: 'success' },
              { icon: EyeOff, label: 'Not Tracked', count: counts.excluded, accent: 'muted' },
            ].map(({ icon: Icon, label, count, accent }) => (
              <Card key={label}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{label}</p>
                      <p className="text-2xl font-bold tabular-nums">{count}</p>
                    </div>
                    <div
                      className={cn(
                        'flex items-center justify-center h-10 w-10 rounded-lg',
                        accent === 'warning' && 'bg-warning/15',
                        accent === 'success' && 'bg-success/15',
                        accent === 'muted' && 'bg-muted/40',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-5 w-5',
                          accent === 'warning' && 'text-warning',
                          accent === 'success' && 'text-success',
                          accent === 'muted' && 'text-muted-foreground',
                        )}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Search & filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by company, slug, or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <button
                  onClick={() => setShowExcluded(!showExcluded)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all border',
                    showExcluded
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80',
                  )}
                >
                  {showExcluded ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  {showExcluded ? 'Showing hidden' : 'Show hidden'}
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Checklist table */}
          <Card>
            <CardContent className="pt-6 overflow-x-auto">
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : visibleRows.length === 0 ? (
                <div className="text-center py-16">
                  <ClipboardCheck className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? 'No tenants match your search.' : 'No production tenants yet.'}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-primary/5 hover:bg-primary/5">
                      <TableHead className="min-w-[180px]">Tenant</TableHead>
                      {ITEMS.map((item) => (
                        <TableHead key={item.key} className="text-center whitespace-nowrap">
                          <div className="text-[11px] leading-tight">{item.label}</div>
                          <div className="text-[10px] font-normal text-muted-foreground">{item.owner}</div>
                        </TableHead>
                      ))}
                      <TableHead className="text-center whitespace-nowrap">
                        <div className="text-[11px] leading-tight">Send to Brandon</div>
                        <div className="text-[10px] font-normal text-muted-foreground">George</div>
                      </TableHead>
                      <TableHead className="text-center">Progress</TableHead>
                      <TableHead className="text-right">Track</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((row) => {
                      const n = doneCount(row);
                      const complete = isFullyOnboarded(row);
                      return (
                        <TableRow key={row.tenant_id} className={cn(row.excluded && 'opacity-50')}>
                          <TableCell>
                            <div className="font-medium whitespace-nowrap">{row.company_name}</div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                              {row.slug} · {fmtDate(row.created_at)}
                            </div>
                          </TableCell>

                          {ITEMS.map((item) => {
                            const auto = row[`${item.key}_auto` as keyof OnboardingRow] === true;
                            const override = row[`${item.key}_override` as keyof OnboardingRow] === true;
                            const done = auto || override;
                            const isBusy = busy === `${row.tenant_id}:${item.key}`;

                            return (
                              <TableCell key={item.key} className="text-center">
                                {auto ? (
                                  <CheckCircle2
                                    className="h-5 w-5 text-success inline"
                                    aria-label={`${item.label} done automatically`}
                                  />
                                ) : (
                                  <button
                                    onClick={() => toggleOverride(row, item.key)}
                                    disabled={!!busy}
                                    title={
                                      override
                                        ? `${item.label} marked done manually — click to undo. ${item.autoHint}.`
                                        : `Click to mark ${item.label} done manually. ${item.autoHint}.`
                                    }
                                    className="inline-flex items-center justify-center p-1 rounded hover:bg-accent transition-colors"
                                  >
                                    {isBusy ? (
                                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                    ) : override ? (
                                      <CheckCircle2 className="h-5 w-5 text-sky-400" />
                                    ) : (
                                      <Circle className="h-5 w-5 text-muted-foreground/50" />
                                    )}
                                  </button>
                                )}
                              </TableCell>
                            );
                          })}

                          {/* Send to Brandon (action, not a checkpoint) */}
                          <TableCell className="text-center">
                            {row.brandon_sent ? (
                              <span title={`Sent ${fmtDate(row.brandon_sent_at)} — click to resend`}>
                                <button
                                  onClick={() => sendToBrandon(row)}
                                  disabled={!!busy}
                                  className="inline-flex items-center justify-center p-1 rounded hover:bg-accent transition-colors"
                                >
                                  {busy === `${row.tenant_id}:brandon` ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                  ) : (
                                    <CheckCircle2 className="h-5 w-5 text-success" />
                                  )}
                                </button>
                              </span>
                            ) : row.bonzah_form_submitted ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={!!busy}
                                onClick={() => sendToBrandon(row)}
                                title="Email the Bonzah form details to Brandon"
                              >
                                {busy === `${row.tenant_id}:brandon` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <Send className="h-3 w-3 mr-1" />
                                    Send
                                  </>
                                )}
                              </Button>
                            ) : (
                              <span title="Waiting for the Bonzah form to be submitted first">
                                <XCircle className="h-5 w-5 text-muted-foreground/30 inline" />
                              </span>
                            )}
                          </TableCell>

                          <TableCell className="text-center">
                            {complete ? (
                              <span className="inline-flex items-center gap-1 text-sm font-semibold text-success whitespace-nowrap">
                                <PartyPopper className="h-4 w-4" />
                                Onboarded
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  'text-sm font-bold tabular-nums',
                                  n >= 2 ? 'text-warning' : 'text-destructive',
                                )}
                              >
                                {n}/{ITEMS.length}
                              </span>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            <button
                              onClick={() => toggleExcluded(row)}
                              disabled={!!busy}
                              title={row.excluded ? 'Resume tracking this tenant' : 'Stop tracking this tenant (hides from daily digest)'}
                              className="inline-flex items-center justify-center p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground"
                            >
                              {busy === `${row.tenant_id}:excluded` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : row.excluded ? (
                                <Eye className="h-4 w-4" />
                              ) : (
                                <EyeOff className="h-4 w-4" />
                              )}
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forms" className="mt-4">
          <BonzahSubmissions />
        </TabsContent>
      </Tabs>

      <CreateTenantDialog
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={loadRows}
      />

      <DigestSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}

// ── Digest settings ──────────────────────────────────────────────────────────

function DigestSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [emails, setEmails] = useState('');
  const [brandonEmail, setBrandonEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (supabase as any)
      .from('admin_settings')
      .select('id, onboarding_digest_emails, bonzah_brandon_email')
      .limit(1)
      .single()
      .then(({ data, error }: any) => {
        if (error) {
          toast.error('Failed to load settings: ' + error.message);
        } else if (data) {
          setSettingsId(data.id);
          setEmails((data.onboarding_digest_emails || []).join('\n'));
          setBrandonEmail(data.bonzah_brandon_email || '');
        }
        setLoading(false);
      });
  }, [open]);

  const handleSave = async () => {
    if (!settingsId) return;
    const list = emails
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => /\S+@\S+\.\S+/.test(e));
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('admin_settings')
        .update({
          onboarding_digest_emails: list,
          bonzah_brandon_email: brandonEmail.trim() || null,
        })
        .eq('id', settingsId);
      if (error) throw error;
      toast.success('Digest settings saved');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    setSendingNow(true);
    try {
      const { data, error } = await supabase.functions.invoke('onboarding-daily-digest', {
        body: {},
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(
        `Digest sent to ${data?.recipients?.length ?? 0} recipient${(data?.recipients?.length ?? 0) === 1 ? '' : 's'} · ${data?.pending ?? 0} tenants pending`,
      );
    } catch (err: any) {
      toast.error(`Send failed: ${err.message}`);
    } finally {
      setSendingNow(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            Onboarding Digest Settings
          </DialogTitle>
          <DialogDescription>
            A status email for every tenant still in onboarding goes out daily to these recipients.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block">Daily digest recipients</Label>
              <Textarea
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                rows={4}
                placeholder={'ghulam@example.com\nhaseeb@example.com\ngeorge@example.com\nneema@example.com'}
              />
              <p className="text-xs text-muted-foreground mt-1">
                One email per line (commas also work).
              </p>
            </div>
            <div>
              <Label className="mb-1.5 block">Brandon&apos;s email (Bonzah)</Label>
              <Input
                type="email"
                value={brandonEmail}
                onChange={(e) => setBrandonEmail(e.target.value)}
                placeholder="brandon@bonzah.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Used by the &quot;Send to Brandon&quot; button on the checklist.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={handleSendNow} disabled={sendingNow || loading}>
            {sendingNow ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send digest now
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
