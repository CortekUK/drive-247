"use client";

// ── Twilio: the account + number flow both Twilio cards share ─────────────────
//
// Ghulam, Oct 2 2026: from Twilio Messages AND Twilio Calling an operator can
// connect their Twilio account, then either BUY a number right here or use
// one they already own — and it is checked and pointed at Drive247 in the
// same step. One account and one number serve both cards (texts and calls
// share `tenants.twilio_*`), so this file is the one place that writes them
// from v2; each panel only decides what happens once the number is in.
//
//   1. Your Twilio account   Account SID + Auth Token, checked with Twilio
//                            (`twilio-numbers-v2` verify — saves nothing).
//   2. Which number?         Get a new one, or use one on the account.
//   3a. Pick a new number    Search by country + area code, pick, confirm the
//                            monthly charge, buy (`buy` — stores it).
//   3b. Pick your number     Their numbers, with what each can do; one that
//                            cannot do the job is shown but not offered
//                            (`connect` — stores it).
//
// A connected operator changing number starts at step 2 with the stored
// credentials — the token is never sent back to the browser to be re-used.
//
// FIRST-RUN DEMO — northwind only, on screen only, like Stripe / Square /
// Xero / Zoho. northwind has no Twilio account, so on the canary every step
// is played in the browser: the account check, the search, the purchase and
// the connection resolve to stand-ins after a short pause, and NOTHING is
// called or written. The demo state is shared by both Twilio cards (one
// account behind both) and lasts until the page reloads; Disconnect puts it
// back to the start. To remove: delete `twilioDemo`, `useTwilioDemo` and every
// `demo` branch in the two panels and here.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, KeyRound, Loader2, Phone, Search, ShoppingCart } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";

import type { PanelTenant } from "./_kit";
import { ScreenNav, useNarrowDialog } from "./_screens";

/* ─────────────────────────────── the demo ───────────────────────────────── */

export const TWILIO_DEMO_SLUGS: readonly string[] = ["northwind"];

export type TwilioDemoState = {
  live: boolean;
  number: string | null;
  smsOn: boolean;
  voiceOn: boolean;
  forwarding: boolean;
  forwardTo: string | null;
  callerIdMode: "caller" | "business_line";
  voicemail: boolean;
  greeting: string | null;
  recording: boolean;
};

const DEMO_START: TwilioDemoState = {
  live: false,
  number: null,
  smsOn: true,
  voiceOn: false,
  forwarding: false,
  forwardTo: null,
  callerIdMode: "caller",
  voicemail: true,
  greeting: null,
  recording: false,
};

export const twilioDemo = (() => {
  let state = DEMO_START;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => state,
    patch: (p: Partial<TwilioDemoState>) => {
      state = { ...state, ...p };
      emit();
    },
    reset: () => {
      state = DEMO_START;
      emit();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
})();

export function useTwilioDemo(tenant: PanelTenant) {
  const demo = TWILIO_DEMO_SLUGS.includes(tenant.slug);
  const state = useSyncExternalStore(twilioDemo.subscribe, twilioDemo.get, twilioDemo.get);
  return { demo, state };
}

export const demoPause = <T,>(value: T, ms = 1200) =>
  new Promise<T>((r) => window.setTimeout(() => r(value), ms));

/** `+14155550142` → `+1 (415) 555-0142`; anything else as it came. */
export function prettyNumber(n: string | null | undefined): string {
  if (!n) return "—";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : n;
}

/** `AC1234…7f9c`. The SID is a username, not a secret, but there is no reason to print it whole. */
export const maskSid = (sid: string) => (sid.length > 12 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid);

/* ──────────────────────────── edge function ─────────────────────────────── */

/**
 * `functions.invoke` folds every non-2xx into one opaque message; Twilio's own
 * refusal ("Authenticate", "number not available") is in the body and is the
 * whole value of each step, so it is read back out — all of it, via Response.
 */
async function numbers<T>(action: string, tenantId: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("twilio-numbers-v2", {
    // `tenantId` is honoured only for a super admin (tenant_id NULL); everyone
    // else is held to their own tenant by the function.
    body: { action, tenantId, ...params },
  });
  if (error) {
    const body = (error as { context?: { body?: ReadableStream } }).context?.body;
    if (body) {
      try {
        const parsed = JSON.parse(await new Response(body).text());
        if (typeof parsed?.error === "string") throw new Error(parsed.error);
      } catch (e) {
        if (e instanceof Error && e.message !== (error as Error).message && !(e instanceof SyntaxError)) throw e;
      }
    }
    throw error;
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

type OwnedNumber = { phoneNumber: string; friendlyName: string; sms: boolean; voice: boolean; pointedAtDrive247: boolean };
type ForSale = { phoneNumber: string; friendlyName: string; locality: string | null; region: string | null; sms: boolean; voice: boolean };

/* ───────────────────────────── demo stand-ins ───────────────────────────── */

const DEMO_PLACES: Record<string, string> = {
  "415": "San Francisco, CA",
  "212": "New York, NY",
  "305": "Miami, FL",
  "312": "Chicago, IL",
  "720": "Denver, CO",
  "904": "Jacksonville, FL",
  "201": "Jersey City, NJ",
  "504": "New Orleans, LA",
};

/** 555-01XX is the range set aside for fiction — none of these can ring anyone. */
function demoForSale(areaCode: string): ForSale[] {
  const ac = /^\d{3}$/.test(areaCode) ? areaCode : "415";
  const place = DEMO_PLACES[ac] ?? "United States";
  const [city, region] = place.includes(",") ? place.split(", ") : [place, null];
  return ["0134", "0158", "0172", "0119", "0187", "0146"].map((tail) => ({
    phoneNumber: `+1${ac}555${tail}`,
    friendlyName: `(${ac}) 555-${tail}`,
    locality: city,
    region,
    sms: true,
    voice: true,
  }));
}

const DEMO_OWNED: OwnedNumber[] = [
  { phoneNumber: "+14155550142", friendlyName: "Main line", sms: true, voice: true, pointedAtDrive247: false },
  { phoneNumber: "+16285550199", friendlyName: "Texts only", sms: true, voice: false, pointedAtDrive247: false },
];

/* ─────────────────────────────── the flow ───────────────────────────────── */

const COUNTRIES = [
  { code: "US", label: "United States", flag: "us" },
  { code: "CA", label: "Canada", flag: "ca" },
  { code: "GB", label: "United Kingdom", flag: "gb" },
] as const;

type Step = "account" | "choose" | "buy" | "own";

export function TwilioNumberFlow({
  tenant,
  need,
  useStored,
  onBack,
  onConnected,
}: {
  tenant: PanelTenant;
  /** What the number must be able to do: texts, or texts AND calls. */
  need: "sms" | "voice";
  /** Already connected — reuse the stored credentials and start at step 2. */
  useStored?: boolean;
  /** Back from the first step. */
  onBack?: () => void;
  /** The number is stored (or, in the demo, pretended to be). */
  onConnected: (phoneNumber: string) => void;
}) {
  useNarrowDialog();
  const { demo } = useTwilioDemo(tenant);
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>(useStored ? "choose" : "account");
  // The demo starts with plausible-looking values so it can be clicked through.
  const [sid, setSid] = useState(demo ? "AC3f9bxxxxxxxxxxxxxxxxxxxxxxxx5a6b" : "");
  const [token, setToken] = useState(demo ? "demo-token-not-real" : "");
  const [account, setAccount] = useState<{ friendlyName: string; numbers: OwnedNumber[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const creds = useStored ? {} : { accountSid: sid.trim(), authToken: token.trim() };

  const finish = async (phoneNumber: string) => {
    // Typed credentials leave component state the moment they are stored.
    setToken("");
    if (demo) {
      twilioDemo.patch({ live: true, number: phoneNumber, smsOn: true });
    } else {
      // Both cards read these columns; TenantContext's copy is refreshed by the panel.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["twilio-messages"] }),
        qc.invalidateQueries({ queryKey: ["twilio-calling", tenant.id] }),
        qc.invalidateQueries({ queryKey: ["twilio-voice-status"] }),
      ]);
    }
    onConnected(phoneNumber);
  };

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Twilio didn't answer. Try again in a moment.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    const res = await run("verify", () =>
      demo
        ? demoPause({ friendlyName: "Northwind Rentals", numbers: DEMO_OWNED })
        : numbers<{ friendlyName: string; numbers: OwnedNumber[] }>("verify", tenant.id, creds),
    );
    if (res) {
      setAccount(res);
      setStep("choose");
    }
  };

  // Step 2 from a stored connection needs the account's numbers too.
  useEffect(() => {
    if (useStored && !account) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body =
    step === "account" ? (
      <AccountStep
        sid={sid}
        token={token}
        setSid={setSid}
        setToken={setToken}
        busy={busy === "verify"}
        error={error}
        onContinue={verify}
      />
    ) : step === "choose" ? (
      <ChooseStep
        account={account}
        loading={busy === "verify"}
        error={error}
        need={need}
        onBuy={() => {
          setError(null);
          setStep("buy");
        }}
        onOwn={() => {
          setError(null);
          setStep("own");
        }}
      />
    ) : step === "buy" ? (
      <BuyStep
        demo={demo}
        tenantId={tenant.id}
        creds={creds}
        need={need}
        country={(tenant.country as string | undefined) ?? "US"}
        busy={busy}
        error={error}
        run={run}
        onBought={finish}
      />
    ) : (
      <OwnStep
        demo={demo}
        tenantId={tenant.id}
        creds={creds}
        need={need}
        numbers={account?.numbers ?? []}
        busy={busy === "connect"}
        error={error}
        run={run}
        onConnected={finish}
      />
    );

  const back =
    step === "account"
      ? onBack
      : step === "choose"
        ? useStored
          ? onBack
          : () => {
              setError(null);
              setStep("account");
            }
        : () => {
            setError(null);
            setStep("choose");
          };

  return (
    <div key={step} className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      {body}
      <ScreenNav className="mt-6" onBack={back} />
    </div>
  );
}

/* ── shared pieces ─────────────────────────────────────────────────────────── */

function StepHead({ n, of = 3, title, children }: { n: number; of?: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Step {n} of {of}
      </p>
      <h3 className="text-xl font-medium leading-snug text-foreground">{title}</h3>
      {children && (
        <p className="mx-auto max-w-[30rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">{children}</p>
      )}
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  ...input
}: { icon: typeof Phone; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    // The label sits inside the field, on the left — the screen also carries
    // the three "where to find it" steps and must not scroll.
    <label className="flex h-12 items-center gap-2.5 rounded-2xl border border-input bg-background px-4 text-left transition-[border-color,box-shadow] duration-200 focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/30 motion-reduce:transition-none">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="contents">
        <input
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none [&:not(:placeholder-shown)]:font-mono placeholder:text-muted-foreground/70"
          {...input}
        />
      </span>
    </label>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return <p className="min-h-[1.25rem] text-center text-xs text-destructive">{error}</p>;
}

/* ── 1. the account ───────────────────────────────────────────────────────── */

function AccountStep({
  sid,
  token,
  setSid,
  setToken,
  busy,
  error,
  onContinue,
}: {
  sid: string;
  token: string;
  setSid: (v: string) => void;
  setToken: (v: string) => void;
  busy: boolean;
  error: string | null;
  onContinue: () => void;
}) {
  const sidWrong = sid.length > 0 && !sid.trim().startsWith("AC");
  const ready = sid.trim().length > 10 && token.trim().length > 0 && !sidWrong;
  return (
    <form
      className="mx-auto flex w-full max-w-xl flex-col gap-3 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onContinue();
      }}
    >
      <StepHead n={1} title="Your Twilio account.">
        Texts and calls go through your own Twilio account — the number is yours, and Twilio bills you directly.
      </StepHead>
      {/* Where the two values live in Twilio's console, step by step. */}
      <ol className="grid grid-cols-3 gap-2.5">
        {[
          <>
            Sign in at{" "}
            <a
              href="https://console.twilio.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
            >
              console.twilio.com
            </a>
          </>,
          <>
            Find <span className="font-medium text-foreground">Account Info</span> on the home page
          </>,
          <>
            Copy the <span className="font-medium text-foreground">Account SID</span> and{" "}
            <span className="font-medium text-foreground">Auth Token</span> (press Show)
          </>,
        ].map((text, i) => (
          <li key={i} className="flex gap-2 rounded-2xl border bg-background/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
              {i + 1}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <Field
        icon={KeyRound}
        label={sidWrong ? "Starts with AC" : "Account SID"}
        value={sid}
        onChange={(e) => setSid(e.target.value)}
        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        aria-invalid={sidWrong || undefined}
      />
      <Field
        icon={KeyRound}
        label="Auth Token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Press Show in Twilio, then paste it"
      />
      {error && <ErrorLine error={error} />}
      <div className="flex flex-col items-center gap-1.5">
        <Button type="submit" className="h-10 rounded-2xl px-6" disabled={!ready || busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? "Checking with Twilio…" : "Check my account"}
          {!busy && <ArrowRight />}
        </Button>
        <a
          href="https://www.twilio.com/try-twilio"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          No Twilio account yet? Create one free
        </a>
      </div>
    </form>
  );
}

/* ── 2. new or own ────────────────────────────────────────────────────────── */

function ChooseStep({
  account,
  loading,
  error,
  need,
  onBuy,
  onOwn,
}: {
  account: { friendlyName: string; numbers: OwnedNumber[] } | null;
  loading: boolean;
  error: string | null;
  need: "sms" | "voice";
  onBuy: () => void;
  onOwn: () => void;
}) {
  const usable = (account?.numbers ?? []).filter((n) => n.sms && (need === "sms" || n.voice)).length;
  const owned = account?.numbers.length ?? 0;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 py-1">
      <StepHead n={2} title="Which number should I use?">
        {account ? (
          <>
            I&rsquo;m in <span className="font-medium text-foreground">{account.friendlyName}</span>. Get a new number,
            or use one you already have there.
          </>
        ) : loading ? (
          "Reading the numbers on your Twilio account…"
        ) : (
          "Get a new number, or use one you already have."
        )}
      </StepHead>
      <div className="grid grid-cols-2 gap-3">
        <Choice
          icon={ShoppingCart}
          title="Get a new number"
          detail="I'll find one in your area. Twilio bills it monthly, usually about $1.15."
          onClick={onBuy}
          disabled={loading || !account}
        />
        <Choice
          icon={Phone}
          title="Use a number I have"
          detail={
            !account
              ? "Numbers already on your Twilio account."
              : owned === 0
                ? "There are no numbers on this account yet."
                : `${owned} on this account, ${usable} ready for ${need === "voice" ? "texts and calls" : "texts"}.`
          }
          onClick={onOwn}
          disabled={loading || !account || owned === 0}
        />
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  detail,
  onClick,
  disabled,
}: {
  icon: typeof Phone;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-center gap-3 rounded-2xl border bg-background/70 px-5 py-6 text-center transition-colors duration-200 hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
        <Icon className="size-5" />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground [text-wrap:balance]">{detail}</span>
      </span>
    </button>
  );
}

/* ── 3a. buy one ──────────────────────────────────────────────────────────── */

type Run = <T>(label: string, fn: () => Promise<T>) => Promise<T | null>;

function BuyStep({
  demo,
  tenantId,
  creds,
  need,
  country: tenantCountry,
  busy,
  error,
  run,
  onBought,
}: {
  demo: boolean;
  tenantId: string;
  creds: Record<string, string>;
  need: "sms" | "voice";
  country: string;
  busy: string | null;
  error: string | null;
  run: Run;
  onBought: (n: string) => void;
}) {
  const initial = COUNTRIES.some((c) => c.code === tenantCountry?.toUpperCase()) ? tenantCountry.toUpperCase() : "US";
  const [country, setCountry] = useState<string>(initial);
  const [areaCode, setAreaCode] = useState("");
  const [results, setResults] = useState<ForSale[] | null>(null);
  const [price, setPrice] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const searched = useRef(false);

  const search = async () => {
    setPicked(null);
    const res = await run("search", () =>
      demo
        ? demoPause({ numbers: demoForSale(areaCode), monthlyPrice: "1.15 USD" }, 900)
        : numbers<{ numbers: ForSale[]; monthlyPrice: string | null }>("search", tenantId, {
            ...creds,
            country,
            areaCode,
            // Always ask for both: one number serves texts AND calls, so a
            // texts-only number would have to be replaced to turn calling on.
            voice: true,
          }),
    );
    if (res) {
      setResults(res.numbers);
      setPrice(res.monthlyPrice);
    }
  };

  // Something to look at straight away: the first page of numbers.
  useEffect(() => {
    if (searched.current) return;
    searched.current = true;
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async () => {
    if (!picked) return;
    const res = await run("buy", () =>
      demo
        ? demoPause({ phoneNumber: picked }, 1600)
        : numbers<{ phoneNumber: string }>("buy", tenantId, { ...creds, phoneNumber: picked, need }),
    );
    if (res) onBought(res.phoneNumber);
  };

  const countryInfo = COUNTRIES.find((c) => c.code === country)!;
  const searching = busy === "search";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-1">
      <StepHead n={3} title="Pick your new number." />

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="flex h-11 shrink-0 items-center gap-1 rounded-2xl border bg-background p-1">
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCountry(c.code)}
              title={c.label}
              aria-pressed={country === c.code}
              className={cn(
                "flex h-full items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors duration-200 motion-reduce:transition-none",
                country === c.code ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <img
                src={`https://flagcdn.com/${c.flag}.svg`}
                alt=""
                aria-hidden
                className="h-3 w-[18px] rounded-[2px] object-cover ring-1 ring-black/10"
              />
              {c.code}
            </button>
          ))}
        </div>
        <span className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-input bg-background px-3.5 focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/30">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder={country === "GB" ? "Any area" : "Area code, like 415"}
            inputMode="numeric"
            disabled={country === "GB"}
            aria-label="Area code"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
        </span>
        <Button type="submit" variant="outline" className="h-11 shrink-0 rounded-2xl px-4" disabled={searching}>
          {searching ? <Loader2 className="animate-spin" /> : "Search"}
        </Button>
      </form>

      {/* Six cells, always — the screen doesn't jump while a search runs. */}
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => {
          const n = results?.[i];
          if (searching || !results) {
            return <div key={i} className="h-[4.25rem] animate-pulse rounded-2xl border bg-muted/40 motion-reduce:animate-none" />;
          }
          if (!n) return <div key={i} className="h-[4.25rem] rounded-2xl border border-dashed border-border/60" />;
          const on = picked === n.phoneNumber;
          return (
            <button
              key={n.phoneNumber}
              type="button"
              onClick={() => setPicked(n.phoneNumber)}
              aria-pressed={on}
              className={cn(
                "relative h-[4.25rem] rounded-2xl border px-3 text-left transition-colors duration-200 motion-reduce:transition-none",
                on ? "border-primary/50 bg-primary/10" : "bg-background/70 hover:border-primary/30",
              )}
            >
              <span className="block truncate font-mono text-[13px] font-medium text-foreground">
                {prettyNumber(n.phoneNumber)}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {[n.locality, n.region].filter(Boolean).join(", ") || countryInfo.label}
              </span>
              {on && <Check className="absolute right-2.5 top-2.5 size-3.5 text-primary" />}
            </button>
          );
        })}
      </div>

      {results && results.length === 0 && !searching ? (
        <p className="text-center text-xs text-muted-foreground">
          Twilio has no numbers there right now — try a nearby area code.
        </p>
      ) : (
        <ErrorLine error={error} />
      )}

      <div className="flex justify-center">
        <Button className="h-10 rounded-2xl px-6" disabled={!picked || busy === "buy"} onClick={() => setConfirm(true)}>
          {busy === "buy" ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
          {busy === "buy" ? "Buying and connecting…" : picked ? `Get ${prettyNumber(picked)}` : "Pick a number"}
        </Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Get {prettyNumber(picked)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Twilio adds it to your account and bills you {price ? `${price} a month` : "monthly"} for it. It&rsquo;s
              yours: it stays on your Twilio account even if you disconnect it here. I&rsquo;ll point it at Drive247
              as soon as it&rsquo;s bought.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                void buy();
              }}
            >
              Get this number
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── 3b. one they own ─────────────────────────────────────────────────────── */

function OwnStep({
  demo,
  tenantId,
  creds,
  need,
  numbers: owned,
  busy,
  error,
  run,
  onConnected,
}: {
  demo: boolean;
  tenantId: string;
  creds: Record<string, string>;
  need: "sms" | "voice";
  numbers: OwnedNumber[];
  busy: boolean;
  error: string | null;
  run: Run;
  onConnected: (n: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // What a number is missing for this card — shown, never hidden.
  const missing = (n: OwnedNumber) => (!n.sms ? "No SMS" : need === "voice" && !n.voice ? "No calls" : null);
  const shown = useMemo(() => owned.slice(0, 6), [owned]);

  const connect = async () => {
    if (!picked) return;
    const res = await run("connect", () =>
      demo
        ? demoPause({ phoneNumber: picked }, 1400)
        : numbers<{ phoneNumber: string }>("connect", tenantId, { ...creds, phoneNumber: picked, need }),
    );
    if (res) onConnected(res.phoneNumber);
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-1">
      <StepHead n={3} title="Pick the number to connect.">
        I&rsquo;ll check it can {need === "voice" ? "text and take calls" : "send texts"}, then point it at Drive247.
      </StepHead>
      <div className={cn("grid gap-2.5", shown.length > 2 ? "grid-cols-3" : "grid-cols-2")}>
        {shown.map((n) => {
          const why = missing(n);
          const on = picked === n.phoneNumber;
          return (
            <button
              key={n.phoneNumber}
              type="button"
              disabled={!!why}
              onClick={() => setPicked(n.phoneNumber)}
              aria-pressed={on}
              className={cn(
                "relative rounded-2xl border px-3.5 py-3 text-left transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
                on ? "border-primary/50 bg-primary/10" : "bg-background/70 hover:border-primary/30",
              )}
            >
              <span className="block truncate font-mono text-[13px] font-medium text-foreground">
                {prettyNumber(n.phoneNumber)}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                <Tag on={n.sms}>SMS</Tag>
                <Tag on={n.voice}>Calls</Tag>
                {n.pointedAtDrive247 && <Tag on>Set up</Tag>}
              </span>
              {why && <span className="mt-1 block text-[11px] text-muted-foreground">{why}</span>}
              {on && <Check className="absolute right-2.5 top-2.5 size-3.5 text-primary" />}
            </button>
          );
        })}
      </div>
      {owned.length > shown.length && (
        <p className="text-center text-xs text-muted-foreground">
          Showing 6 of {owned.length}. Release the ones you don&rsquo;t use in Twilio to see the rest.
        </p>
      )}
      <ErrorLine error={error} />
      <div className="flex justify-center">
        <Button className="h-10 rounded-2xl px-6" disabled={!picked || busy} onClick={() => void connect()}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? "Checking and connecting…" : picked ? `Connect ${prettyNumber(picked)}` : "Pick a number"}
        </Button>
      </div>
    </div>
  );
}

function Tag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-px text-[10px] font-medium",
        on ? "bg-success/10 text-success" : "bg-muted text-muted-foreground line-through",
      )}
    >
      {children}
    </span>
  );
}
