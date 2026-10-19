'use client';

/**
 * Contact Requests → Connect: where leads come from.
 *
 *   Website     always on (drive-247.com's strategy-call form writes here).
 *   Meta Ads    Continue with Facebook → pick Pages → their Lead Ads forms
 *               arrive through the lead-webhook-meta function.
 *   Google Ads  a webhook URL + key to paste into each lead form's
 *               "Webhook integration" settings (lead-webhook-google).
 *
 * The server side is supabase/functions/lead-sources.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export interface LeadConnection {
  id: string;
  provider: 'meta' | 'google';
  label: string;
  external_id: string | null;
  webhook_key: string | null;
  status: 'active' | 'error';
  last_error: string | null;
  last_lead_at: string | null;
  lead_count: number;
  created_at: string;
}

interface SourcesStatus {
  meta: { configured: boolean; appId: string | null; scopes: string[] };
  googleWebhookBase: string;
}

const META_STATE_KEY = 'd247-meta-oauth-state';
const redirectUri = () => `${window.location.origin}/admin/contacts`;

async function call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('lead-sources', { body: { action, ...extra } });
  if (error) {
    // supabase-js hides the function's own message in the response body.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }
  return data as T;
}

const ago = (iso: string | null) => {
  if (!iso) return 'No leads yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `Last lead ${mins <= 1 ? 'just now' : `${mins} min ago`}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `Last lead ${hrs} h ago`;
  return `Last lead ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
};

export function useLeadConnections() {
  const [connections, setConnections] = useState<LeadConnection[]>([]);
  const reload = useCallback(async () => {
    const { data } = await supabase.from('lead_connections').select('*').order('created_at');
    setConnections((data as LeadConnection[] | null) ?? []);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { connections, reload };
}

/* ------------------------------ The dialog ------------------------------ */

export function LeadSourcesDialog({
  open,
  onClose,
  connections,
  websiteCount,
  websiteLast,
  reload,
}: {
  open: boolean;
  onClose: () => void;
  connections: LeadConnection[];
  websiteCount: number;
  websiteLast: string | null;
  reload: () => Promise<void>;
}) {
  const [status, setStatus] = useState<SourcesStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open || status) return;
    call<SourcesStatus>('status')
      .then(setStatus)
      .catch((e: Error) => setStatusError(e.message));
  }, [open, status]);

  const meta = connections.filter((c) => c.provider === 'meta');
  const google = connections.find((c) => c.provider === 'google') ?? null;

  const connectMeta = () => {
    if (!status?.meta.appId) return;
    const state = crypto.randomUUID();
    try {
      sessionStorage.setItem(META_STATE_KEY, state);
    } catch {
      /* private mode: the state check below then fails safe */
    }
    const params = new URLSearchParams({
      client_id: status.meta.appId,
      redirect_uri: redirectUri(),
      state,
      response_type: 'code',
      scope: status.meta.scopes.join(','),
    });
    window.location.href = `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  };

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      await reload();
      if (success) toast.success(success);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (c: LeadConnection) => {
    const ok = await confirmDialog({
      title: `Disconnect ${c.label}?`,
      description: 'New leads from it stop arriving. Leads already here stay.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (ok) void run(c.id, () => call('disconnect', { id: c.id }), 'Disconnected');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-[640px] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="px-6 pb-4 pt-6 text-left">
          <DialogTitle>Lead sources</DialogTitle>
          <DialogDescription>Every lead from these lands in Contact Requests, marked with where it came from.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-3 overflow-y-auto px-6 pb-6 [scrollbar-width:thin]">
          {/* Website */}
          <SourceCard dot="bg-primary" name="Website" sub="The strategy-call form on drive-247.com" connected>
            <p className="text-xs text-muted-foreground">
              {websiteCount.toLocaleString()} leads · {ago(websiteLast)}
            </p>
          </SourceCard>

          {/* Meta */}
          <SourceCard
            dot="bg-[#0866FF]"
            name="Meta Ads"
            sub="Lead forms on Facebook and Instagram ads"
            connected={meta.length > 0}
            action={
              status?.meta.configured ? (
                <Button size="sm" className="h-8 rounded-full bg-[#0866FF] px-3.5 text-[13px] text-white hover:bg-[#0866FF]/90" onClick={connectMeta}>
                  {meta.length ? 'Add a Page' : 'Continue with Facebook'}
                </Button>
              ) : null
            }
          >
            {status && !status.meta.configured && (
              <p className="text-xs text-muted-foreground">The Meta app keys are not on the server yet (META_LEADS_APP_ID / META_LEADS_APP_SECRET).</p>
            )}
            {statusError && <p className="text-xs text-destructive">{statusError}</p>}
            {meta.length > 0 && (
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {meta.map((c) => (
                  <ConnectionRow key={c.id} c={c} busy={busy === c.id} onDisconnect={() => void disconnect(c)} />
                ))}
              </ul>
            )}
          </SourceCard>

          {/* Google */}
          <SourceCard
            dot="bg-[#34A853]"
            name="Google Ads"
            sub="Lead form assets on Search, YouTube and Discovery"
            connected={!!google}
            action={
              !google ? (
                <Button
                  size="sm"
                  className="h-8 rounded-full px-3.5 text-[13px]"
                  disabled={busy === 'google'}
                  onClick={() => void run('google', () => call('google_connect'), 'Google Ads connected. Paste the URL and key into your lead form.')}
                >
                  {busy === 'google' && <Loader2 className="size-3.5 animate-spin" />}
                  Connect
                </Button>
              ) : null
            }
          >
            {google && status && (
              <div className="space-y-3">
                <CopyField label="Webhook URL" value={`${status.googleWebhookBase}?c=${google.id}`} />
                <CopyField label="Key" value={google.webhook_key ?? ''} />
                <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                  <li>In Google Ads, open your lead form asset.</li>
                  <li>Under Lead delivery options, choose Webhook integration.</li>
                  <li>Paste the URL and the key, then press Send test data.</li>
                  <li>The test lead shows up here within seconds, marked Test.</li>
                </ol>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <p className={cn('text-xs', google.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                    {google.status === 'error' ? google.last_error : `${google.lead_count.toLocaleString()} leads · ${ago(google.last_lead_at)}`}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full text-[13px]"
                      disabled={busy === google.id}
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: 'Issue a new key?',
                          description: 'The old key stops working, so every lead form must be updated with the new one.',
                          confirmLabel: 'New key',
                        });
                        if (ok) void run(google.id, () => call('google_rotate', { id: google.id }), 'New key issued');
                      }}
                    >
                      New key
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full text-[13px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void disconnect(google)}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </SourceCard>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceCard({
  dot,
  name,
  sub,
  connected,
  action,
  children,
}: {
  dot: string;
  name: string;
  sub: string;
  connected: boolean;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-3xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className={cn('size-2 rounded-full', dot)} />
            {name}
            {connected && <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Connected</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ConnectionRow({ c, busy, onDisconnect }: { c: LeadConnection; busy: boolean; onDisconnect: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{c.label}</p>
        <p className={cn('truncate text-xs', c.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
          {c.status === 'error' ? c.last_error : `${c.lead_count.toLocaleString()} leads · ${ago(c.last_lead_at)}`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        className="h-8 shrink-0 rounded-full text-[13px] text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onDisconnect}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        Disconnect
      </Button>
    </li>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-full bg-muted/60 py-1 pl-4 pr-1">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{value}</code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

/* --------------------- Back from Facebook: pick Pages --------------------- */

interface MetaPage {
  id: string;
  name: string;
  connected: boolean;
  canReadLeads: boolean;
}

/** Handles ?code=&state= on return from Facebook Login, then lets you pick Pages. */
export function MetaReturnHandler({ onDone }: { onDone: () => Promise<void> }) {
  const [handoff, setHandoff] = useState<string | null>(null);
  const [pages, setPages] = useState<MetaPage[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const denied = params.get('error');
    if (!code && !denied) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (denied) {
      toast.error('Facebook sign-in was cancelled.');
      return;
    }
    let expected: string | null = null;
    try {
      expected = sessionStorage.getItem(META_STATE_KEY);
      sessionStorage.removeItem(META_STATE_KEY);
    } catch {
      /* fall through to the mismatch below */
    }
    if (!state || state !== expected) {
      toast.error('That Facebook sign-in could not be verified. Try Connect again.');
      return;
    }
    setPages([]);
    call<{ handoffId: string; pages: MetaPage[] }>('meta_exchange', { code, redirectUri: redirectUri() })
      .then((r) => {
        setHandoff(r.handoffId);
        setPages(r.pages);
        setPicked(new Set(r.pages.filter((p) => !p.connected && p.canReadLeads).map((p) => p.id)));
      })
      .catch((e: Error) => {
        setPages(null);
        toast.error(`Facebook: ${e.message}`);
      });
  }, []);

  const close = () => {
    setPages(null);
    setHandoff(null);
  };

  const connect = async () => {
    if (!handoff) return;
    setBusy(true);
    try {
      const r = await call<{ results: { name: string; ok: boolean; error?: string }[] }>('meta_connect', { handoffId: handoff, pageIds: [...picked] });
      const ok = r.results.filter((x) => x.ok);
      const bad = r.results.filter((x) => !x.ok);
      if (ok.length) toast.success(`Connected ${ok.map((x) => x.name).join(', ')}`);
      for (const b of bad) toast.error(`${b.name}: ${b.error}`);
      await onDone();
      close();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={pages !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="w-[96vw] max-w-[480px] gap-5 rounded-3xl p-6">
        <DialogHeader className="text-left">
          <DialogTitle>Pick your Facebook Pages</DialogTitle>
          <DialogDescription>Leads from Lead Ads forms on these Pages come straight into Contact Requests.</DialogDescription>
        </DialogHeader>
        {pages === null || (pages.length === 0 && !handoff) ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Talking to Facebook…
          </div>
        ) : pages.length === 0 ? (
          <p className="rounded-2xl bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">This Facebook account does not manage any Pages.</p>
        ) : (
          <ul className="max-h-[300px] divide-y divide-border overflow-y-auto rounded-2xl border border-border [scrollbar-width:thin]">
            {pages.map((p) => (
              <li key={p.id}>
                <label className={cn('flex items-center gap-3 px-4 py-2.5', p.connected ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-muted/50')}>
                  <Checkbox
                    checked={p.connected || picked.has(p.id)}
                    disabled={p.connected}
                    onCheckedChange={(v) =>
                      setPicked((prev) => {
                        const s = new Set(prev);
                        if (v) s.add(p.id);
                        else s.delete(p.id);
                        return s;
                      })
                    }
                    aria-label={p.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{p.name}</span>
                    {p.connected ? (
                      <span className="text-xs text-muted-foreground">Already connected</span>
                    ) : !p.canReadLeads ? (
                      <span className="text-xs text-warning">Your role on this Page may not allow reading leads</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={close}>
            Cancel
          </Button>
          <Button className="rounded-full" disabled={busy || !handoff || picked.size === 0} onClick={() => void connect()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Connect {picked.size > 0 ? picked.size : ''} {picked.size === 1 ? 'Page' : 'Pages'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
