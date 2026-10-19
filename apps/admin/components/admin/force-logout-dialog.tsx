'use client';

/**
 * Force logout, done properly: every session a company has open — its portal
 * staff and its booking customers — with who, which device and browser, the
 * IP, when they signed in and when they were last active. Untick anyone to
 * leave them signed in; the rest are signed out.
 *
 * Sessions come from admin_list_tenant_sessions (super admin only). Signing
 * out a chosen few uses admin_revoke_tenant_sessions. Signing out everyone
 * goes through the admin-force-logout function instead (`onLogoutAll`), which
 * also tells open portals to sign out at once rather than at their next
 * token refresh.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Laptop, Loader2, LogOut, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Session {
  session_id: string;
  user_id: string;
  kind: 'staff' | 'customer';
  name: string | null;
  email: string | null;
  role: string | null;
  signed_in_at: string;
  last_active: string | null;
  user_agent: string | null;
  ip: string | null;
}

/** "Chrome on macOS" and the kind of device, from a user agent. */
function describeDevice(ua: string | null): { label: string; kind: 'mobile' | 'tablet' | 'desktop' } {
  if (!ua) return { label: 'Unknown device', kind: 'desktop' };
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Unknown OS';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua) && !/Chromium/.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const kind = /iPad|Tablet/.test(ua) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'mobile' : 'desktop';
  return { label: `${browser} on ${os}`, kind };
}

/** "3 min ago", "2 h ago", "Oct 14". */
function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Laptop };

/** Seen in the last 15 minutes. */
const isActive = (s: { last_active: string | null }) =>
  !!s.last_active && Date.now() - new Date(s.last_active).getTime() < 15 * 60_000;

export function ForceLogoutDialog({
  open,
  onOpenChange,
  tenantId,
  companyName,
  onLogoutAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  companyName: string;
  /** Sign everyone out through admin-force-logout. Resolves when done. */
  onLogoutAll: () => Promise<void>;
}) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sessions left signed in. Everything else is signed out.
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await (supabase as any).rpc('admin_list_tenant_sessions', { p_tenant_id: tenantId });
    if (rpcError) {
      setError(rpcError.message);
      setSessions([]);
      return;
    }
    setSessions(data ?? []);
  }, [tenantId]);

  useEffect(() => {
    if (!open) return;
    setSessions(null);
    setKeep(new Set());
    void load();
  }, [open, load]);

  const groups = useMemo(
    () =>
      (['staff', 'customer'] as const)
        .map((kind) => ({ kind, rows: (sessions ?? []).filter((s) => s.kind === kind) }))
        .filter((g) => g.rows.length > 0),
    [sessions],
  );
  const total = sessions?.length ?? 0;
  const activeNow = (sessions ?? []).filter(isActive).length;
  const out = total - keep.size;
  const people = new Set((sessions ?? []).filter((s) => !keep.has(s.session_id)).map((s) => s.user_id)).size;

  const toggle = (ids: string[], leave: boolean) =>
    setKeep((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (leave) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const signOut = async () => {
    if (out === 0 || !sessions) return;
    setBusy(true);
    try {
      if (keep.size === 0) {
        await onLogoutAll();
      } else {
        const ids = sessions.filter((s) => !keep.has(s.session_id)).map((s) => s.session_id);
        const { data, error: rpcError } = await (supabase as any).rpc('admin_revoke_tenant_sessions', {
          p_tenant_id: tenantId,
          p_session_ids: ids,
        });
        if (rpcError) throw new Error(rpcError.message);
        toast.success(`Signed out ${data ?? ids.length} ${(data ?? ids.length) === 1 ? 'session' : 'sessions'}`);
      }
      await load();
      setKeep(new Set());
    } catch (e) {
      toast.error(`Couldn't sign them out: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 overflow-hidden rounded-3xl p-7 pb-0">
        <DialogHeader className="mb-4">
          <DialogTitle className="flex items-center gap-2">
            Sessions
            {sessions && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{total}</span>}
          </DialogTitle>
          <DialogDescription>
            Everyone signed in to {companyName}, staff and customers. Untick anyone to keep them signed in.
          </DialogDescription>
        </DialogHeader>

        {/* At a glance: how many, who, on what, from where, and who is on right now. */}
        {sessions && total > 0 && (
          <div className="mb-4 grid grid-cols-5 gap-2">
            {[
              { label: 'Sessions', value: total },
              { label: 'People', value: new Set(sessions.map((s) => s.user_id)).size },
              { label: 'Devices', value: new Set(sessions.map((s) => describeDevice(s.user_agent).label)).size },
              { label: 'IPs', value: new Set(sessions.map((s) => s.ip)).size },
              { label: 'Active now', value: activeNow, live: true },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-muted/50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {stat.live && (
                    <span className="relative flex size-1.5">
                      {stat.value > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
                      <span className={cn('relative inline-flex size-1.5 rounded-full', stat.value > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                    </span>
                  )}
                  {stat.label}
                </p>
                <p className="text-lg font-semibold tabular-nums leading-tight text-foreground">{stat.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-24">
          {sessions === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading sessions…
            </p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-destructive">Couldn&apos;t load sessions: {error}</p>
          ) : total === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nobody is signed in right now.</p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => {
                const ids = g.rows.map((r) => r.session_id);
                const allOut = ids.every((id) => !keep.has(id));
                const someOut = ids.some((id) => !keep.has(id));
                return (
                  <section key={g.kind}>
                    <label className="mb-1.5 flex cursor-pointer items-center gap-2.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <Checkbox
                        checked={allOut}
                        indeterminate={!allOut && someOut}
                        onCheckedChange={(v) => toggle(ids, !v)}
                        aria-label={`Sign out all ${g.kind === 'staff' ? 'portal staff' : 'booking customers'}`}
                      />
                      {g.kind === 'staff' ? 'Portal staff' : 'Booking customers'} · {g.rows.length}
                    </label>
                    <ul className="overflow-hidden rounded-2xl border border-border/70">
                      {g.rows.map((s) => {
                        const device = describeDevice(s.user_agent);
                        const Icon = DEVICE_ICON[device.kind];
                        const out = !keep.has(s.session_id);
                        return (
                          <li key={s.session_id} className="border-b border-border/60 last:border-b-0">
                            <label
                              className={cn(
                                'grid cursor-pointer grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50',
                                !out && 'opacity-55',
                              )}
                              title={s.user_agent ?? undefined}
                            >
                              <Checkbox checked={out} onCheckedChange={(v) => toggle([s.session_id], !v)} aria-label={`Sign out ${s.email ?? 'this session'}`} />
                              <span className="min-w-0">
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate text-sm font-medium text-foreground">{s.name || s.email || 'Unknown'}</span>
                                  {s.role && (
                                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium capitalize text-primary">
                                      {s.role.replace(/_/g, ' ')}
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">{s.email}</span>
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span className="truncate">{device.label}</span>
                                </span>
                                <span className="block truncate font-mono text-[11px] text-muted-foreground">{s.ip ?? 'No IP'}</span>
                              </span>
                              <span className="text-right">
                                <span className="flex items-center justify-end gap-1.5 text-[13px] tabular-nums text-foreground">
                                  {isActive(s) && <span className="size-1.5 rounded-full bg-emerald-500" aria-label="Active now" />}
                                  {isActive(s) ? 'Active now' : ago(s.last_active)}
                                </span>
                                <span className="block text-[11px] text-muted-foreground">since {ago(s.signed_in_at)}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-card from-55% via-card/90 to-transparent px-7 pb-6 pt-12 [&>*]:pointer-events-auto">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              className="gap-1.5 bg-gradient-to-r from-rose-500 via-red-500 to-red-600 text-white shadow-lg shadow-red-500/30 transition-all hover:-translate-y-px hover:text-white hover:shadow-xl hover:shadow-red-500/40 disabled:shadow-none"
              onClick={() => void signOut()}
              disabled={busy || out === 0}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
              {keep.size === 0
                ? 'Sign out everyone'
                : `Sign out ${out} ${out === 1 ? 'session' : 'sessions'} · ${people} ${people === 1 ? 'person' : 'people'}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
