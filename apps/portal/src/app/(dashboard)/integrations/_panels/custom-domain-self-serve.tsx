"use client";

// ── Custom Domain — self-serve ───────────────────────────────────────────────
//
// Ghulam, Oct 2 2026: the domain connection should need (almost) nothing from
// our team, and Drive247 should never hold an operator's domain. So: the
// operator types their domain, we show the DNS records Vercel wants, they add
// them at their own registrar, and "I've added them" puts the domain on our
// Vercel projects through the `custom-domain` edge function. From there it is
// checked until DNS points at us and the certificate exists — here every 15s
// while the screen is open, and by `custom-domain-run` every 5 minutes when it
// is not, which emails the operator once it is live.
//
// Shown to SELF_SERVE_SLUGS only (custom-domain.tsx, and enforced again in the
// edge function). Every other tenant keeps the manual-handoff panel.
//
// ⚠️ ISOLATION. The read below carries `.eq('id', tenant.id)`; every write
// goes through the edge function, which takes the tenant from the caller's own
// app_users row and never from the request.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, Copy, Globe, Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { CustomDomainArt } from "@/components/illustrations-v2/scenes/custom-domain";

import type { PanelTenant } from "./_kit";
import { StatusChip } from "./_kit";
import { DisconnectScreen, Hero, QuietNav, ScreenNav, useNarrowDialog } from "./_screens";

/* ──────────────────────────────── data ──────────────────────────────────── */

type DnsRecord = { type: "A" | "CNAME" | "TXT"; name: string; value: string; ok?: boolean };

type DomainRow = {
  custom_booking_domain: string | null;
  custom_portal_domain: string | null;
  custom_domain_status: "pending" | "active" | "error" | null;
  custom_domain_detail: string | null;
  custom_domain_records: DnsRecord[] | null;
  custom_domain_checked_at: string | null;
};

const rowKey = (tenantId: string) => ["custom-domain-self-serve", tenantId] as const;

/** How often the open screen re-checks a pending domain. */
const CHECK_EVERY_MS = 15_000;

function useDomainRow(tenantId: string) {
  return useQuery({
    queryKey: rowKey(tenantId),
    queryFn: async (): Promise<DomainRow> => {
      const { data, error } = await supabaseUntyped
        .from("tenants")
        .select(
          "custom_booking_domain, custom_portal_domain, custom_domain_status, custom_domain_detail, custom_domain_records, custom_domain_checked_at",
        )
        .eq("id", tenantId) // ← isolation
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Tenant row not found");
      return data as DomainRow;
    },
    // The runner may flip it to live while the board is open.
    refetchInterval: (q) => (q.state.data?.custom_domain_status === "pending" ? 30_000 : false),
    staleTime: 15_000,
  });
}

/** Invoke the edge function and surface its real error message, not supabase-js's generic one. */
async function callDomainFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("custom-domain", { body });
  if (!error) return data as T;
  let message = "Something went wrong. Please try again.";
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    try {
      const payload = await context.json();
      if (payload?.error) message = String(payload.error);
    } catch {
      /* not JSON — keep the generic message */
    }
  }
  throw new Error(message);
}

function useDomainAction(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => callDomainFn<{ tenant: DomainRow }>(body),
    onSuccess: (res) => {
      if (res?.tenant) queryClient.setQueryData(rowKey(tenantId), res.tenant);
    },
  });
}

/* ──────────────────────────────── chip ──────────────────────────────────── */

export function SelfServeDomainStatus({ tenant }: { tenant: PanelTenant }) {
  const { data, isLoading, isError } = useDomainRow(tenant.id);
  if (isError) return <StatusChip state="attention" label="Status unknown" />;
  if (isLoading || !data) return <StatusChip state="loading" />;
  if (data.custom_domain_status === "active") return <StatusChip state="connected" label="Live" />;
  if (data.custom_domain_status === "pending") return <StatusChip state="disconnected" label="Pending" />;
  if (data.custom_domain_status === "error") return <StatusChip state="attention" label="Needs attention" />;
  return <StatusChip state="disconnected" label="Not set up" />;
}

/* ─────────────────────────────── the flow ───────────────────────────────── */

type Step = "domain" | "records" | "checking" | "live" | "remove";

export function CustomDomainSelfServe({
  tenant,
  onBack,
  onClose,
  normalize,
  validate,
}: {
  tenant: PanelTenant;
  onBack?: () => void;
  onClose: () => void;
  /** The real panel's own rules, so the client accepts exactly what the server will. */
  normalize: (raw: string) => string;
  validate: (domain: string) => string | null;
}) {
  const { isAdmin } = useAuth();
  const canManage = isAdmin();
  const row = useDomainRow(tenant.id);
  const action = useDomainAction(tenant.id);

  const [step, setStep] = useState<Step | null>(null);
  const [raw, setRaw] = useState("");
  const [records, setRecords] = useState<DnsRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // First paint: open where the domain actually stands.
  useEffect(() => {
    if (step || !row.data) return;
    const s = row.data.custom_domain_status;
    setRaw(row.data.custom_booking_domain ?? "");
    setStep(s === "active" ? "live" : s === "pending" || s === "error" ? "checking" : "domain");
  }, [row.data, step]);

  // Went live (here or via the runner) while the checking screen is up.
  useEffect(() => {
    if (step === "checking" && row.data?.custom_domain_status === "active") setStep("live");
  }, [row.data?.custom_domain_status, step]);

  if (row.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
        <p>We couldn&rsquo;t load your domain just now.</p>
        <Button variant="outline" onClick={() => row.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!row.data || !step) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const saved = row.data;
  const domain = normalize(raw);
  const problem = raw.trim() ? validate(domain) : null;
  const ready = !!domain && !problem;
  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const body =
    step === "domain" ? (
      <DomainStep
        raw={raw}
        setRaw={(v) => {
          setRaw(v);
          setError(null);
        }}
        domain={domain}
        error={problem ?? error}
        ready={ready}
        busy={action.isPending}
        canManage={canManage}
        slug={tenant.slug}
        onContinue={() =>
          action.mutate(
            { action: "records", domain },
            {
              onSuccess: (res: any) => {
                setRecords(res?.records ?? null);
                go("records");
              },
              onError: (e) => setError((e as Error).message),
            },
          )
        }
      />
    ) : step === "records" ? (
      <RecordsStep
        domain={domain}
        records={records ?? saved.custom_domain_records ?? []}
        busy={action.isPending}
        error={error}
        onDone={() =>
          action.mutate(
            { action: "connect", domain },
            { onSuccess: () => go("checking"), onError: (e) => setError((e as Error).message) },
          )
        }
      />
    ) : step === "checking" ? (
      <CheckingStep
        tenantId={tenant.id}
        row={saved}
        onDifferent={
          canManage
            ? () =>
                action.mutate(
                  { action: "disconnect" },
                  {
                    onSuccess: () => {
                      setRaw("");
                      setRecords(null);
                      go("domain");
                    },
                    onError: (e) => setError((e as Error).message),
                  },
                )
            : undefined
        }
        busy={action.isPending}
        error={error}
      />
    ) : step === "live" ? (
      <LiveStep
        domain={saved.custom_booking_domain ?? domain}
        onClose={onClose}
        onRemove={canManage ? () => go("remove") : undefined}
      />
    ) : (
      <DisconnectScreen
        name={saved.custom_booking_domain ?? "your domain"}
        canManage={canManage}
        pending={action.isPending}
        consequence={
          <>
            {saved.custom_booking_domain} and {saved.custom_portal_domain} stop working at once — anyone using those
            addresses gets an error page until you connect a domain again. {tenant.slug}.drive-247.com keeps working.
          </>
        }
        onBack={() => go("live")}
        onConfirm={() =>
          action.mutate(
            { action: "disconnect" },
            {
              onSuccess: () => {
                setRaw("");
                setRecords(null);
                go("domain");
              },
              onError: (e) =>
                toast({ title: "Could not remove the domain", description: (e as Error).message, variant: "destructive" }),
            },
          )
        }
      />
    );

  const back =
    step === "records"
      ? () => go("domain")
      : step === "checking"
        ? () => go("records")
        : step === "domain"
          ? onBack
          : undefined;

  return (
    <div key={step} className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      {body}
      {back && <ScreenNav className="mt-4" onBack={back} />}
    </div>
  );
}

/* ── 1. the domain ────────────────────────────────────────────────────────── */

function DomainStep({
  raw,
  setRaw,
  domain,
  error,
  ready,
  busy,
  canManage,
  slug,
  onContinue,
}: {
  raw: string;
  setRaw: (v: string) => void;
  domain: string;
  error: string | null;
  ready: boolean;
  busy: boolean;
  canManage: boolean;
  slug: string;
  onContinue: () => void;
}) {
  useNarrowDialog();
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 py-1 text-center">
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Step 1 of 3</p>
        <h3 className="text-xl font-medium leading-snug text-foreground">What&rsquo;s your domain?</h3>
        <p className="mx-auto max-w-[30rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
          The web address you already own. I&rsquo;ll put your booking site on it, and your portal on
          portal. in front of it.
        </p>
      </div>

      <form
        className="w-full space-y-2 text-left"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && canManage && !busy) onContinue();
        }}
      >
        <div
          className={cn(
            "flex h-12 items-center gap-2 rounded-2xl border bg-background px-4 transition-[border-color,box-shadow] duration-200 focus-within:ring-3 motion-reduce:transition-none",
            error ? "border-destructive/60 focus-within:ring-destructive/20" : "border-input focus-within:border-primary/50 focus-within:ring-ring/30",
          )}
        >
          <Globe className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="yourrentals.com"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Your domain"
            aria-invalid={!!error || undefined}
            disabled={!canManage}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70"
          />
          {ready && !error && <Check className="size-4 shrink-0 text-success" aria-hidden />}
        </div>

        <div className="min-h-[2.75rem] px-1 text-xs leading-relaxed">
          {!canManage ? (
            <p className="text-muted-foreground">Connecting a domain needs an admin or head admin account.</p>
          ) : error ? (
            <p className="text-destructive">{error}</p>
          ) : ready ? (
            <div className="space-y-0.5 text-muted-foreground">
              <p>
                Bookings at <span className="font-medium text-foreground">{domain}</span>
              </p>
              <p>
                Your portal at <span className="font-medium text-foreground">portal.{domain}</span>
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Paste it however you have it — I&rsquo;ll tidy up https://, www. and slashes. You keep{" "}
              {slug}.drive-247.com too.
            </p>
          )}
        </div>

        <div className="flex justify-center pt-1">
          <Button type="submit" className="h-10 rounded-2xl px-6" disabled={!ready || !canManage || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Continue
            {!busy && <ArrowRight />}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ── 2. the records ───────────────────────────────────────────────────────── */

/**
 * Where each provider keeps its DNS records, as three short steps in the
 * operator's own words. If a provider moves things, change its steps here.
 */
const PROVIDERS = [
  {
    id: "godaddy",
    label: "GoDaddy",
    steps: ["Sign in and open My Products.", "Next to your domain, choose DNS.", "Click Add New Record for each one, then Save."],
  },
  {
    id: "namecheap",
    label: "Namecheap",
    steps: ["Sign in and open Domain List.", "Click Manage next to your domain, then Advanced DNS.", "Add New Record for each one, then the green tick."],
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    steps: ["Open your site, then DNS → Records.", "Add record for each one.", "Set Proxy status to DNS only (grey cloud), then Save."],
  },
  {
    id: "wix",
    label: "Wix",
    steps: ["Open Domains in your Wix account.", "Click ⋯ next to your domain → Manage DNS records.", "Add each record in its section, then Save."],
  },
  {
    id: "other",
    label: "Other",
    steps: ["Sign in where you bought the domain.", "Find its DNS settings — often DNS Management or Zone Editor.", "Add each record, then save."],
  },
] as const;

const RECORD_HINT: Record<string, string> = {
  "A:@": "Points your domain at your booking site.",
  "CNAME:www": "Sends www. to your booking site too.",
  "CNAME:portal": "Points portal. at your portal.",
};

function RecordTable({ records, showStatus }: { records: DnsRecord[]; showStatus?: boolean }) {
  const cols = showStatus ? "grid-cols-[4.5rem_5rem_minmax(0,1fr)_1.25rem]" : "grid-cols-[4.5rem_5rem_minmax(0,1fr)]";
  return (
    <div className="overflow-hidden rounded-2xl border bg-background/70 text-left">
      <div className={cn("grid gap-3 border-b bg-muted/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground", cols)}>
        <span>Type</span>
        <span>Name</span>
        <span>Value</span>
        {showStatus && <span />}
      </div>
      {records.map((r) => (
        <div
          key={`${r.type}:${r.name}:${r.value}`}
          title={RECORD_HINT[`${r.type}:${r.name}`]}
          className={cn("grid items-center gap-3 border-b px-4 py-2 last:border-b-0", cols)}
        >
          <span className="text-sm font-medium text-foreground">{r.type}</span>
          <CopyChip value={r.name} />
          <div className="min-w-0">
            <CopyChip value={r.value} />
          </div>
          {showStatus &&
            (r.ok ? (
              <Check className="size-4 text-success" aria-label="Found" />
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Waiting" />
            ))}
        </div>
      ))}
    </div>
  );
}

function RecordsStep({
  domain,
  records,
  busy,
  error,
  onDone,
}: {
  domain: string;
  records: DnsRecord[];
  busy: boolean;
  error: string | null;
  onDone: () => void;
}) {
  useNarrowDialog();
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["id"]>("godaddy");
  const steps = PROVIDERS.find((p) => p.id === provider)!.steps;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 py-1">
      <div className="space-y-2 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Step 2 of 3</p>
        <h3 className="text-xl font-medium leading-snug text-foreground">Add these records.</h3>
        <p className="text-sm text-muted-foreground">
          Where you bought <span className="font-medium text-foreground">{domain}</span> — nobody needs your access.
        </p>
      </div>

      <RecordTable records={records} />

      <div className="overflow-hidden rounded-2xl border bg-background/70">
        <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/40 px-2 py-1.5" role="tablist" aria-label="Where is your domain?">
          <span className="shrink-0 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Your provider</span>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={provider === p.id}
              onClick={() => setProvider(p.id)}
              className={cn(
                "h-7 shrink-0 rounded-full px-3 text-xs transition-colors duration-200 motion-reduce:transition-none",
                provider === p.id
                  ? "bg-background font-medium text-foreground shadow-[0_0_0_1px_hsl(var(--border))]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <ol key={provider} className="space-y-1 px-4 py-2.5 duration-200 ease-out animate-in fade-in-0 motion-reduce:animate-none">
          {steps.map((s, i) => (
            <li key={s} className="flex items-start gap-2.5 text-sm text-foreground/85">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium tabular-nums text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {error && (
        <p className="flex items-start justify-center gap-1.5 text-center text-xs text-destructive">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex justify-center">
        <Button className="h-10 rounded-2xl px-6" onClick={onDone} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          I&rsquo;ve added them
          {!busy && <ArrowRight />}
        </Button>
      </div>
    </div>
  );
}

/** A value with a one-tap copy, the way a DNS record is actually typed in. */
function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      title="Copy"
      className="group inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1 font-mono text-[12px] text-foreground transition-colors duration-200 hover:border-primary/40 motion-reduce:transition-none"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-success" />
      ) : (
        <Copy className="size-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
      )}
    </button>
  );
}

/* ── 3. connecting ───────────────────────────────────────────────────────── */

function CheckingStep({
  tenantId,
  row,
  onDifferent,
  busy,
  error,
}: {
  tenantId: string;
  row: DomainRow;
  onDifferent?: () => void;
  busy: boolean;
  error: string | null;
}) {
  useNarrowDialog();
  const check = useDomainAction(tenantId);
  const domain = row.custom_booking_domain ?? "";
  const failed = row.custom_domain_status === "error";

  // Re-check on a timer while the screen is open. Not after a give-up: that
  // waits for the operator to fix their records and press Check again.
  const checkRef = useRef(check.mutate);
  checkRef.current = check.mutate;
  useEffect(() => {
    if (failed) return;
    const t = window.setInterval(() => checkRef.current({ action: "check" }), CHECK_EVERY_MS);
    return () => window.clearInterval(t);
  }, [failed]);

  const records = row.custom_domain_records ?? [];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-1 text-center">
      {!failed && <ConnectingArt domain={domain} />}
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Step 3 of 3</p>
        <h3 className="text-xl font-medium leading-snug text-foreground [text-wrap:balance]">
          {failed ? `${domain} isn't connected yet` : `Connecting ${domain}…`}
        </h3>
        <p className={cn("mx-auto max-w-[30rem] text-sm leading-relaxed [text-wrap:balance]", failed ? "text-destructive" : "text-muted-foreground")}>
          {row.custom_domain_detail ?? "Checking your records…"}
        </p>
        {!failed && (
          <p className="mx-auto max-w-[30rem] text-xs leading-relaxed text-muted-foreground [text-wrap:balance]">
            You can close this — we keep checking and email you the moment it&rsquo;s live.
          </p>
        )}
      </div>

      {records.length > 0 && (
        <div className="w-full">
          <RecordTable records={records} showStatus />
        </div>
      )}

      {(error || check.error) && (
        <p className="text-xs text-destructive">{error ?? (check.error as Error).message}</p>
      )}

      <Button
        variant="outline"
        className="h-9 rounded-2xl"
        disabled={check.isPending}
        onClick={() => check.mutate({ action: "check" })}
      >
        {check.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {failed ? "Check again" : "Check now"}
      </Button>

      {onDifferent && <QuietNav items={[{ label: "Use a different domain", onClick: onDifferent, disabled: busy }]} />}
    </div>
  );
}

/**
 * The slow "making the connection" picture: your domain on the left, Drive247
 * on the right, a pulse travelling the dashed link between them and a soft
 * ring breathing on each end. Transform and opacity only, slow on purpose,
 * and still under reduced motion.
 */
function ConnectingArt({ domain }: { domain: string }) {
  const ink = "hsl(var(--foreground) / 0.85)";
  const card = "hsl(var(--card))";
  const lite = "hsl(var(--muted-foreground) / 0.25)";
  const acc = "hsl(var(--primary))";
  const soft = "hsl(var(--primary) / 0.12)";
  const label = domain.length > 18 ? domain.slice(0, 17) + "…" : domain;
  return (
    <div className="relative w-full max-w-[340px]">
      <style>{`
        @keyframes bz-travel { from { offset-distance: 0%; opacity: 0 } 12% { opacity: 1 } 88% { opacity: 1 } to { offset-distance: 100%; opacity: 0 } }
        @keyframes bz-breathe { 0%,100% { transform: scale(1); opacity: .55 } 50% { transform: scale(1.18); opacity: 0 } }
        @keyframes bz-dash { to { stroke-dashoffset: -24 } }
        .bz-pulse { offset-path: path("M118 80 C 165 50, 235 50, 282 80"); animation: bz-travel 2.6s ease-in-out infinite; }
        .bz-pulse-2 { animation-delay: 1.3s; }
        .bz-ring { transform-box: fill-box; transform-origin: center; animation: bz-breathe 2.8s ease-out infinite; }
        .bz-link { animation: bz-dash 1.6s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .bz-pulse, .bz-ring, .bz-link { animation: none; } .bz-pulse { opacity: 0; } }
      `}</style>
      <svg viewBox="0 0 400 170" className="h-auto w-full" aria-hidden>
        <circle className="bz-ring" cx="70" cy="82" r="56" fill={soft} />
        <g transform="translate(20 44)">
          <rect width="100" height="76" rx="10" fill={card} stroke={ink} strokeWidth="2.2" />
          <path d="M0 16 H100" stroke={lite} strokeWidth="1.5" />
          {[10, 18, 26].map((x) => (
            <circle key={x} cx={x} cy="8" r="2.5" fill={lite} />
          ))}
          <rect x="10" y="26" width="80" height="14" rx="7" fill={soft} />
          <text x="50" y="36" textAnchor="middle" fontFamily="DM Sans,Helvetica,sans-serif" fontSize="8.5" fontWeight="700" fill={ink}>
            {label}
          </text>
          <rect x="10" y="48" width="44" height="5" rx="2.5" fill={lite} />
          <rect x="10" y="58" width="62" height="5" rx="2.5" fill={lite} />
        </g>
        <path className="bz-link" d="M118 80 C 165 50, 235 50, 282 80" fill="none" stroke={acc} strokeWidth="2.2" strokeDasharray="4 8" strokeLinecap="round" />
        <circle className="bz-pulse" r="5" fill={acc} />
        <circle className="bz-pulse bz-pulse-2" r="5" fill={acc} />
        <circle className="bz-ring" style={{ animationDelay: "1.4s" }} cx="330" cy="82" r="56" fill={soft} />
        <g transform="translate(286 44)">
          <rect width="88" height="76" rx="10" fill={card} stroke={ink} strokeWidth="2.2" />
          {[18, 36, 54].map((y) => (
            <g key={y}>
              <rect x="12" y={y - 6} width="64" height="12" rx="4" fill={soft} />
              <circle cx="22" cy={y} r="2.5" fill={acc} />
              <rect x="30" y={y - 1.5} width="36" height="3" rx="1.5" fill={lite} />
            </g>
          ))}
        </g>
        <ellipse cx="200" cy="150" rx="150" ry="6" fill="#000" opacity="0.05" />
      </svg>
    </div>
  );
}

/* ── live ─────────────────────────────────────────────────────────────────── */

function LiveStep({ domain, onClose, onRemove }: { domain: string; onClose: () => void; onRemove?: () => void }) {
  return (
    <Hero
      art={CustomDomainArt}
      eyebrow="Live"
      title={`${domain} is live.`}
      actions={
        <div className="flex justify-center">
          <Button className="h-10 rounded-2xl px-6" onClick={onClose}>
            Done
          </Button>
        </div>
      }
      footer={onRemove && <QuietNav items={[{ label: "Remove or change domain", onClick: onRemove }]} />}
    >
      Customers can book at {domain}, and your team signs in at portal.{domain}. Your Drive247
      addresses keep working too, and the certificate renews on its own.
    </Hero>
  );
}
