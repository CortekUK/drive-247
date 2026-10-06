"use client";

/**
 * "Verify their ID" — the v2 screen that follows a new customer, inside the
 * same dialog frame as the add-customer screens (Ghulam, Oct 6 2026: "this
 * screen has potential to be very very good").
 *
 * A v2 copy of v1's `VerificationQRModal` (components/customers/
 * verification-qr-modal.tsx, untouched — v1's customer form and identity tab
 * still use it). The same session, the same QR source, the same poll of
 * `identity_verifications` by session id, the same GREEN / RED / RETRY
 * outcome. What is new is that it shows the customer's progress LIVE — on
 * the QR code itself, nothing else (Ghulam, Oct 6: "just with the QR code,
 * nothing else"). The capture page on their phone writes `verification_step`
 * as they go (qr_scanned → document_front → document_back → selfie →
 * processing → completed), and the code follows it:
 *
 *   waiting   the QR in a viewfinder, a slow scan line passing over it
 *   scanned   the code fades back, a thin ring around it fills with their
 *             progress, and the step they are on sits in its middle
 *             (hovering the code brings it back, if they need to rescan)
 *   result    verified / couldn't verify / needs a closer look / expired
 *
 * Motion is the app standard (200ms, ease-out in, opacity + 12px lift). The
 * scan line and the progress ring are loaders — the standard's stated
 * exception — and both stop under reduced motion.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  CreditCard,
  IdCard,
  Loader2,
  RotateCcw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  TimerOff,
  type LucideIcon,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";

export interface VerifySession {
  sessionId: string;
  qrUrl: string;
  expiresAt: Date;
}

type Outcome = "GREEN" | "RED" | "RETRY" | "EXPIRED";

/** `verification_step`, in the order the capture page writes it. */
const ORDER = [
  "init",
  "qr_scanned",
  "document_front",
  "document_front_captured",
  "document_back",
  "document_back_captured",
  "selfie",
  "selfie_captured",
  "uploading",
  "processing",
  "completed",
];

/**
 * Where they are. A stage is done once the step reaches `doneAt`; the first
 * one not done is the current one — its `line` is what Trax says and its
 * icon and label sit in the middle of the code.
 */
const NODES: { label: string; icon: LucideIcon; doneAt: string; line: string }[] = [
  { label: "Scan", icon: Check, doneAt: "qr_scanned", line: "Waiting for them to scan the code with their phone." },
  { label: "Front of licence", icon: IdCard, doneAt: "document_front_captured", line: "They're in. Now a photo of the front of their licence." },
  { label: "Back of licence", icon: CreditCard, doneAt: "document_back_captured", line: "Front's done. Now the back of their licence." },
  { label: "Selfie", icon: ScanFace, doneAt: "selfie_captured", line: "Licence captured. Now a quick selfie." },
  { label: "Checking", icon: Loader2, doneAt: "completed", line: "I have everything. Checking their licence and selfie now." },
];

/** How far round the ring is at each step — the same stops the customer's own bar uses. */
const PERCENT: Record<string, number> = {
  init: 0, qr_scanned: 10, document_front: 20, document_front_captured: 35, document_back: 45,
  document_back_captured: 55, selfie: 65, selfie_captured: 75, uploading: 85, processing: 95, completed: 100,
};

const rank = (step: string | null | undefined) => Math.max(0, ORDER.indexOf(step ?? "init"));

function formatLeft(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function VerifyIdScreenV2({
  session,
  name,
  onDone,
  onRetry,
  onComplete,
  retrying,
}: {
  session: VerifySession;
  /** The customer's name, for the copy. */
  name: string;
  onDone: () => void;
  /** Start a fresh session (expired, or a failed check). */
  onRetry: () => void;
  onComplete?: (result: "GREEN" | "RED" | "RETRY") => void;
  retrying?: boolean;
}) {
  const { tenant } = useTenant();
  const [step, setStep] = useState<string>("init");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [left, setLeft] = useState(() => Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)));
  const [copied, setCopied] = useState(false);
  const first = name.trim().split(/\s+/)[0] || name;
  // Held in a ref so a parent re-render never restarts the poll.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // A new session (Try again) starts the screen over.
  useEffect(() => {
    setStep("init");
    setOutcome(null);
    setCopied(false);
  }, [session.sessionId]);

  // The countdown. Expiry is a clock event: nothing in the database says so.
  useEffect(() => {
    if (outcome) return;
    const tick = () => {
      const s = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setOutcome("EXPIRED");
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session.expiresAt, outcome]);

  // The poll — v1's, plus `verification_step`, scoped to this tenant (V2_PLAN §5).
  const check = useCallback(async () => {
    if (!tenant?.id) return;
    const { data, error } = await supabase
      .from("identity_verifications")
      .select("status, review_result, verification_step")
      .eq("session_id", session.sessionId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (error || !data) return;
    const row = data as { status: string | null; review_result: string | null; verification_step: string | null };
    if (row.verification_step) setStep(row.verification_step);
    if (row.status === "completed") {
      const result = (row.review_result as "GREEN" | "RED" | "RETRY") || "RETRY";
      setStep("completed");
      setOutcome(result);
      onCompleteRef.current?.(result);
    }
  }, [session.sessionId, tenant?.id]);

  useEffect(() => {
    if (outcome) return;
    void check();
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, [check, outcome]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(session.qrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused — the link is still in the QR */
    }
  };

  /* ── the result ─────────────────────────────────────────────────────── */

  if (outcome) {
    const r = {
      GREEN: {
        icon: ShieldCheck,
        tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        title: `${name} is verified.`,
        line: "Their licence and selfie match. I've saved both to their record.",
      },
      RED: {
        icon: ShieldAlert,
        tone: "bg-destructive/10 text-destructive",
        title: `I couldn't verify ${first}.`,
        line: "The licence or the selfie didn't pass. The photos and my reasons are on their record.",
      },
      RETRY: {
        icon: ShieldQuestion,
        tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        title: `${first} needs a closer look.`,
        line: "I wasn't sure about one of the photos. Take a look on their record before they rent.",
      },
      EXPIRED: {
        icon: TimerOff,
        tone: "bg-muted text-muted-foreground",
        title: "That code has expired.",
        line: `I can make a new one, and ${first} picks up from the start.`,
      },
    }[outcome];
    const Icon = r.icon;
    const canRetry = outcome === "RED" || outcome === "EXPIRED";
    return (
      <div className="flex flex-col">
        <div className="flex h-[456px] flex-col items-center justify-center px-10 text-center">
          <span
            className={cn(
              "flex size-20 items-center justify-center rounded-full duration-200 ease-out animate-in fade-in-0 zoom-in-90 motion-reduce:animate-none",
              r.tone,
            )}
          >
            <Icon className="size-9" strokeWidth={1.75} />
          </span>
          <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 [animation-delay:80ms] [animation-fill-mode:both] motion-reduce:animate-none">
            <h3 className="mt-6 text-xl font-medium text-foreground [text-wrap:balance]">{r.title}</h3>
            <p className="mx-auto mt-2 max-w-[24rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">{r.line}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 border-t px-8 py-4">
          {canRetry ? (
            <Button variant="outline" className="h-10 rounded-full px-5" onClick={onRetry} disabled={retrying}>
              {retrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              {retrying ? "Making a new code…" : "New code"}
            </Button>
          ) : (
            <span />
          )}
          <Button className="h-10 rounded-full px-5" onClick={onDone}>
            <Check className="size-4" /> Done
          </Button>
        </div>
      </div>
    );
  }

  /* ── waiting: the QR and the live tracker ───────────────────────────── */

  const at = rank(step);
  const done = NODES.map((n) => at >= rank(n.doneAt));
  const current = Math.max(0, done.indexOf(false));
  const scanned = current > 0;
  const percent = PERCENT[step] ?? 0;
  const Now = NODES[current].icon;

  return (
    <div className="flex flex-col">
      {/* The scan line's travel. Scoped name; a loader. */}
      <style>{`@keyframes v2-verify-scan{0%{transform:translateY(0);opacity:0}12%{opacity:1}88%{opacity:1}100%{transform:translateY(204px);opacity:0}}`}</style>

      <div className="flex h-[456px] flex-col items-center justify-center px-10">
        {/* The code, in a viewfinder. Everything this screen says lives here. */}
        <div className="group relative p-4 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
          {(["left-0 top-0 border-l-2 border-t-2 rounded-tl-2xl", "right-0 top-0 border-r-2 border-t-2 rounded-tr-2xl", "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-2xl", "right-0 bottom-0 border-r-2 border-b-2 rounded-br-2xl"] as const).map((c) => (
            <span
              key={c}
              className={cn(
                "absolute size-7 border-primary transition-opacity duration-200 motion-reduce:transition-none dark:border-[hsl(var(--v2-link,var(--primary)))]",
                scanned && "opacity-0",
                c,
              )}
            />
          ))}

          {/* Their progress: a ring that fills round the code. */}
          <svg aria-hidden className="pointer-events-none absolute inset-1.5 size-[calc(100%-12px)] overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="0" y="0" width="100" height="100" rx="10" pathLength={100} fill="none" vectorEffect="non-scaling-stroke" className="stroke-foreground/10" strokeWidth={2} opacity={scanned ? 1 : 0} />
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="10"
              pathLength={100}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray="100"
              strokeDashoffset={100 - percent}
              className="stroke-primary transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none dark:stroke-[hsl(var(--v2-link,var(--primary)))]"
              opacity={scanned ? 1 : 0}
            />
          </svg>

          <div className="relative overflow-hidden rounded-2xl border border-foreground/10 bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={session.sessionId}
              src={`https://quickchart.io/qr?text=${encodeURIComponent(session.qrUrl)}&size=400&margin=1&dark=000000&light=ffffff&ecLevel=M&format=png`}
              alt="QR code that opens the ID check on the customer's phone"
              width={204}
              height={204}
              className={cn(
                "block size-[204px] transition-opacity duration-200 ease-out [image-rendering:pixelated] motion-reduce:transition-none",
                scanned && "opacity-[0.07] group-hover:opacity-100",
              )}
            />
            {!scanned && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-3 top-0 h-8 bg-gradient-to-b from-transparent via-[hsl(var(--primary)/0.22)] to-transparent motion-reduce:hidden"
                style={{ animation: "v2-verify-scan 2.6s ease-in-out infinite" }}
              >
                <span className="absolute inset-x-0 top-1/2 h-px bg-primary/70" />
              </span>
            )}
            {scanned && (
              /* The step they're on, in the middle of the code. Hover shows the code again. */
              <div
                key={current}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-[#111114] duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 group-hover:opacity-0 motion-reduce:animate-none"
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Now className={cn("size-6", current === 4 && "animate-spin motion-reduce:animate-none")} strokeWidth={1.75} />
                </span>
                <span className="text-sm font-medium">{NODES[current].label}</span>
                <span className="text-[11px] tabular-nums text-[#71717a]">{Math.min(current, 4)} of 4</span>
              </div>
            )}
          </div>
        </div>

        <h3 className="mt-6 text-center text-xl font-medium leading-snug text-foreground [text-wrap:balance]">
          {scanned ? `Verifying ${first}` : `Scan to verify ${first}`}
        </h3>
        {/* What Trax is waiting for — swaps as they move through the steps. */}
        <p
          key={current}
          aria-live="polite"
          className="mx-auto mt-1.5 min-h-[2lh] max-w-[24rem] text-center text-sm leading-relaxed text-muted-foreground duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 [text-wrap:balance] motion-reduce:animate-none"
        >
          {NODES[current].line}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 border-t px-8 py-4">
        <Button variant="outline" className="h-10 rounded-full px-5" onClick={onDone}>
          Later
        </Button>
        <span className={cn("text-xs tabular-nums", left < 60 ? "text-destructive" : "text-muted-foreground")}>
          Code expires in {formatLeft(left)}
        </span>
        <Button variant="outline" className="h-10 w-[128px] rounded-full px-5" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
