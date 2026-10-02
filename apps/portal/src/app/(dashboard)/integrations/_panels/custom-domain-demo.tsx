"use client";

// ── Custom Domain — the self-serve flow, as a DEMO ───────────────────────────
//
// Ghulam, Oct 2 2026: the domain connection should need (almost) nothing from
// our team, and Drive247 should never hold an operator's domain. The design
// agreed for that: the operator types their domain, the portal adds it to our
// hosting through Vercel's Domains API, the screen shows the TWO DNS records
// they add at their own registrar, then it checks until Vercel has issued the
// certificate. No registrar login, no DNS access, no support email.
//
// THIS FILE IS THAT FLOW, MOCKED, FOR DEMOING ON THE CANARY. Nothing here
// calls Vercel, reads DNS or writes a row: "added to hosting", "record found"
// and "certificate issued" are timed steps on screen. It is shown to northwind
// only (see `CUSTOM_DOMAIN_DEMO_SLUGS` in custom-domain.tsx); every other
// tenant keeps the real, manual-handoff panel. The real build replaces the
// timers with a `custom-domain-v2` edge function holding a Vercel API token —
// the screens stay as they are.
//
// The two records are the ones Vercel genuinely asks for (A @ 76.76.21.21 for
// the apex, CNAME portal → cname.vercel-dns.com), so what the demo shows is
// what a real operator would type.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Check, Copy, Globe } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { CustomDomainArt } from "@/components/illustrations-v2/scenes/custom-domain";

import { Hero, QuietNav, ScreenNav, useNarrowDialog } from "./_screens";

/* ─────────────────────────────── demo state ─────────────────────────────── */

type DemoStage = "fresh" | "pending" | "live";

/** Shared with the header chip, so it reads "Live" the moment the demo does. */
export const customDomainDemo = (() => {
  let stage: DemoStage = "fresh";
  let domain = "";
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => stage,
    domain: () => domain,
    set: (next: DemoStage, d?: string) => {
      // Only announce a real change — a repeat set must not re-render the
      // flow (it would restart the pending timer, forever).
      if (next === stage && (d === undefined || d === domain)) return;
      stage = next;
      if (d !== undefined) domain = d;
      emit();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
})();

export function useCustomDomainDemoStage(): DemoStage {
  return useSyncExternalStore(customDomainDemo.subscribe, customDomainDemo.get, customDomainDemo.get);
}

/* ──────────────────────────────── records ───────────────────────────────── */

const RECORDS = [
  { type: "A", name: "@", value: "76.76.21.21", what: "Points your domain at your booking site." },
  { type: "CNAME", name: "portal", value: "cname.vercel-dns.com", what: "Points portal. at your portal." },
] as const;

/**
 * Where each provider keeps its DNS records, as three short steps in the
 * operator's own words. Checked against each provider's current dashboard
 * layout; if one moves things, change its steps here.
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
    steps: ["Sign in where you bought the domain.", "Find its DNS settings — often DNS Management or Zone Editor.", "Add both records, then save."],
  },
] as const;

/* ──────────────────────────────── the flow ──────────────────────────────── */

type Step = "domain" | "records" | "checking" | "live";

export function CustomDomainDemo({
  slug,
  onBack,
  onClose,
  normalize,
  validate,
}: {
  slug: string;
  onBack?: () => void;
  onClose: () => void;
  /** The real panel's own rules, so the demo accepts exactly what it would. */
  normalize: (raw: string) => string;
  validate: (domain: string) => string | null;
}) {
  const stage = useCustomDomainDemoStage();
  const [step, setStep] = useState<Step>(stage === "live" ? "live" : "domain");
  const [raw, setRaw] = useState(customDomainDemo.domain());

  // Reset when the dialog closes, so the demo can be shown again from the top.
  useEffect(() => () => customDomainDemo.set("fresh", ""), []);

  const domain = normalize(raw);
  const error = raw.trim() ? validate(domain) : null;
  const ready = !!domain && !error;

  const body =
    step === "domain" ? (
      <DomainStep
        raw={raw}
        setRaw={setRaw}
        domain={domain}
        error={error}
        ready={ready}
        slug={slug}
        onContinue={() => setStep("records")}
      />
    ) : step === "records" ? (
      <RecordsStep domain={domain} onDone={() => setStep("checking")} />
    ) : step === "checking" ? (
      <CheckingStep
        domain={domain}
        onLive={() => {
          customDomainDemo.set("live", domain);
          setStep("live");
        }}
      />
    ) : (
      <LiveStep
        domain={customDomainDemo.domain() || domain}
        onClose={onClose}
        onChange={() => {
          customDomainDemo.set("fresh", "");
          setRaw("");
          setStep("domain");
        }}
      />
    );

  const back =
    step === "records"
      ? () => setStep("domain")
      : step === "checking"
        ? () => {
            customDomainDemo.set("fresh"); // the pill drops back from Pending
            setStep("records");
          }
        : step === "domain"
          ? onBack
          : undefined;

  return (
    <div key={step} className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      {body}
      {/* No empty nav row on a screen with nowhere to go back to (live). */}
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
  slug,
  onContinue,
}: {
  raw: string;
  setRaw: (v: string) => void;
  domain: string;
  error: string | null;
  ready: boolean;
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
          if (ready) onContinue();
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
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70"
          />
          {ready && <Check className="size-4 shrink-0 text-success" aria-hidden />}
        </div>

        {/* What the input will become — or why it can't. */}
        <div className="min-h-[2.75rem] px-1 text-xs leading-relaxed">
          {error ? (
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
          <Button type="submit" className="h-10 rounded-2xl px-6" disabled={!ready}>
            Continue
            <ArrowRight />
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ── 2. the records ───────────────────────────────────────────────────────── */

function RecordsStep({ domain, onDone }: { domain: string; onDone: () => void }) {
  useNarrowDialog();
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["id"]>("godaddy");
  const steps = PROVIDERS.find((p) => p.id === provider)!.steps;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 py-1">
      <div className="space-y-2 text-center">
        <h3 className="text-xl font-medium leading-snug text-foreground">Add these two records.</h3>
        <p className="text-sm text-muted-foreground">
          Where you bought <span className="font-medium text-foreground">{domain}</span> — nobody needs your access.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-background/70">
        <div className="grid grid-cols-[4.5rem_5rem_minmax(0,1fr)] gap-3 border-b bg-muted/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Type</span>
          <span>Name</span>
          <span>Value</span>
        </div>
        {RECORDS.map((r) => (
          // What each record does is on hover — the row stays one line.
          <div
            key={r.type}
            title={r.what}
            className="grid grid-cols-[4.5rem_5rem_minmax(0,1fr)] items-center gap-3 border-b px-4 py-2 last:border-b-0"
          >
            <span className="text-sm font-medium text-foreground">{r.type}</span>
            <CopyChip value={r.name} />
            <div className="min-w-0">
              <CopyChip value={r.value} />
            </div>
          </div>
        ))}
      </div>

      {/* How to add them, for the operator's own provider: tabs along the
          top, three numbered steps under them. */}
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
          {steps.map((step, i) => (
            <li key={step} className="flex items-start gap-2.5 text-sm text-foreground/85">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium tabular-nums text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex justify-center">
        <Button className="h-10 rounded-2xl px-6" onClick={onDone}>
          I&rsquo;ve added them
          <ArrowRight />
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

/** How long the demo sits in "Pending" before it goes live. */
const PENDING_MS = 5000;

function CheckingStep({ domain, onLive }: { domain: string; onLive: () => void }) {
  useNarrowDialog();
  // Pending while it "connects" — the header pill reads Pending — then live.
  // A stand-in for polling the hosting provider until the certificate exists.
  // The latest onLive, without restarting the timer when the parent re-renders.
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  useEffect(() => {
    customDomainDemo.set("pending");
    const t = window.setTimeout(() => onLiveRef.current(), PENDING_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 py-1 text-center">
      <ConnectingArt domain={domain} />
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Step 3 of 3</p>
        <h3 className="text-xl font-medium leading-snug text-foreground [text-wrap:balance]">Connecting {domain}…</h3>
        <p className="mx-auto max-w-[30rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
          I&rsquo;m checking your records and setting up a secure certificate. It usually takes a few
          minutes — you can close this, and I&rsquo;ll let you know when it&rsquo;s live.
        </p>
      </div>
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
    <div className="relative w-full max-w-[400px]">
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
        {/* your domain */}
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
        {/* the link being made */}
        <path className="bz-link" d="M118 80 C 165 50, 235 50, 282 80" fill="none" stroke={acc} strokeWidth="2.2" strokeDasharray="4 8" strokeLinecap="round" />
        <circle className="bz-pulse" r="5" fill={acc} />
        <circle className="bz-pulse bz-pulse-2" r="5" fill={acc} />
        {/* Drive247 */}
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

function LiveStep({ domain, onClose, onChange }: { domain: string; onClose: () => void; onChange: () => void }) {
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
      footer={<QuietNav items={[{ label: "Use a different domain", onClick: onChange }]} />}
    >
      Customers can book at {domain}, and your team signs in at portal.{domain}. Your Drive247
      addresses keep working too, and the certificate renews on its own.
    </Hero>
  );
}
