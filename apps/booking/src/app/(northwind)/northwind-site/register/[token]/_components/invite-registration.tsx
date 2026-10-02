"use client";

/**
 * The invite registration flow, new booking design.
 *
 * Layout: a split card on desktop — a deep-forest welcome panel (who invited
 * you, what happens next) beside a stepped form — that collapses to a single
 * column with a compact header on a phone. Three steps:
 *
 *   1. Your details   name, email, phone, and "I drive for Uber/Lyft…"
 *   2. Verify          optional ID check by QR on the phone, or skip
 *   3. Done
 *
 * Behaviour is the original page's, call for call (see page.tsx). The only
 * thing it does not keep is a toast for every message: errors sit next to what
 * caused them, which is how the rest of this design reports them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ImagePlus,
  Loader2,
  ScanFace,
  ShieldCheck,
  Smartphone,
  X,
  XCircle,
} from "lucide-react-nw";
import { toast } from "sonner-nw";

import { supabase } from "@nw/integrations/supabase/client";
import { Button } from "@nw/components/ui/button";
import { Checkbox } from "@nw/components/ui/checkbox";
import { Input } from "@nw/components/ui/input";
import { Label } from "@nw/components/ui/label";
import {
  CHECKBOX_CLASS,
  FIELD_INPUT_CLASS,
  FieldError,
  FieldLabel,
} from "@nw/components/booking/field-primitives";
import { cn } from "@nw/lib/utils";

/* ─────────────────────────────── types ──────────────────────────────────── */

interface TenantInfo {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantLogo: string | null;
  tenantPrimaryColor: string | null;
  acceptedVerificationDocument: "drivers_license" | "passport" | "id_card";
  expiresAt: string;
}

const DOC_LABEL: Record<string, string> = {
  drivers_license: "driver's license",
  passport: "passport",
  id_card: "ID card",
};

type Phase = "loading" | "invalid" | "form" | "submitting" | "done";
type Step = 0 | 1;

const QR_LIFETIME_S = 900;

/* ─────────────────────────────── helpers ────────────────────────────────── */

function validate(v: { name: string; email: string; phone: string }) {
  const e: Partial<Record<"name" | "email" | "phone", string>> = {};
  if (v.name.trim().length < 2) e.name = "Enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (v.phone.replace(/\D/g, "").length < 5) e.phone = "Enter a phone number we can reach you on.";
  return e;
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function fmtExpiry(iso: string | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/* ──────────────────────────────── shell ─────────────────────────────────── */

export function InviteRegistration({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [invalidReason, setInvalidReason] = useState("");
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [step, setStep] = useState<Step>(0);

  const [values, setValues] = useState({ name: "", email: "", phone: "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isGig, setIsGig] = useState(false);
  const [gigFiles, setGigFiles] = useState<File[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Verification (identical mechanics to the original page).
  const [session, setSession] = useState<{ sessionId: string; qrUrl: string; expiresAt: Date } | null>(null);
  const [creating, setCreating] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [polling, setPolling] = useState(false);
  const [verified, setVerified] = useState<null | "GREEN" | "RED" | "REVIEW">(null);
  const [verifiedSessionId, setVerifiedSessionId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const errors = useMemo(() => validate(values), [values]);
  const docLabel = DOC_LABEL[tenant?.acceptedVerificationDocument ?? "drivers_license"];

  /* ── the invite ──────────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("validate-customer-invite", { body: { token } });
        if (cancelled) return;
        if (error || !data?.ok) {
          setInvalidReason(data?.error || "This invite link is invalid or has expired.");
          setPhase("invalid");
          return;
        }
        setTenant(data as TenantInfo);
        setPhase("form");
      } catch {
        if (!cancelled) {
          setInvalidReason("We couldn't check this invite link. Please try again in a moment.");
          setPhase("invalid");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  /* ── verification ────────────────────────────────────────────────────── */

  const startVerification = async () => {
    if (!tenant) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-ai-verification-session", {
        body: {
          customerDetails: { name: values.name.trim(), email: values.email.trim(), phone: values.phone.trim() },
          tenantId: tenant.tenantId,
          tenantSlug: tenant.tenantSlug,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Couldn't start verification");
      setSession({ sessionId: data.sessionId, qrUrl: data.qrUrl, expiresAt: new Date(data.expiresAt) });
      setPolling(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start verification");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setPolling(false);
        setSession(null);
        toast.error("The QR code expired. Start again to get a new one.");
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session]);

  const check = useCallback(async () => {
    if (!polling || !session) return;
    try {
      const { data, error } = await supabase
        .from("identity_verifications")
        .select("status, review_status, review_result")
        .eq("session_id", session.sessionId)
        .single();
      if (error || !data) return;
      const row = data as { status: string; review_result: string | null };
      if (row.status === "completed") {
        setPolling(false);
        setVerifiedSessionId(session.sessionId);
        setVerified(row.review_result === "GREEN" ? "GREEN" : row.review_result === "RED" ? "RED" : "REVIEW");
      }
    } catch {
      /* keep polling */
    }
  }, [polling, session]);

  useEffect(() => {
    if (!polling || !session) return;
    const first = setTimeout(check, 5000);
    pollRef.current = setInterval(check, 3000);
    return () => {
      clearTimeout(first);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [polling, session, check]);

  /* ── submit ──────────────────────────────────────────────────────────── */

  const submit = async () => {
    setSubmitError(null);
    setPhase("submitting");
    try {
      const paths: string[] = [];
      if (isGig) {
        for (const file of gigFiles) {
          const name = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
          const path = `pending/${name}`;
          const { error } = await supabase.storage
            .from("gig-driver-images")
            .upload(path, file, { cacheControl: "3600", upsert: false });
          if (error) throw new Error(`Couldn't upload ${file.name}`);
          paths.push(path);
        }
      }
      const { data, error } = await supabase.functions.invoke("submit-customer-registration", {
        body: {
          token,
          name: values.name.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          verificationSessionId: verifiedSessionId || undefined,
          isGigDriver: isGig || undefined,
          gigDriverImagePaths: paths.length ? paths : undefined,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Registration failed");
      setPhase("done");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Registration failed. Please try again.");
      setPhase("form");
    }
  };

  const goVerify = () => {
    setTouched({ name: true, email: true, phone: true });
    if (Object.keys(errors).length) return;
    setStep(1);
  };

  /* ── render ──────────────────────────────────────────────────────────── */

  if (phase === "loading") {
    return (
      <Center>
        <Loader2 className="size-7 animate-spin text-brand-forest" aria-hidden />
        <p className="mt-3 text-sm text-brand-text-soft">Opening your invite…</p>
      </Center>
    );
  }

  if (phase === "invalid") {
    return (
      <Center>
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger-subtle">
          <XCircle className="size-7 text-danger" aria-hidden />
        </div>
        <h1 className="mt-5 text-2xl font-medium tracking-[-0.02em] text-brand-text">This invite can't be used</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-brand-text-soft">
          {invalidReason} Ask the rental company to send you a new link.
        </p>
      </Center>
    );
  }

  const company = tenant?.tenantName ?? "your rental company";

  return (
    <div className="flex min-h-svh items-center justify-center bg-brand-cream px-4 py-8 sm:px-6 sm:py-14">
      <div className="grid w-full max-w-[980px] overflow-hidden rounded-[22px] border border-brand-border-soft bg-white md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <WelcomePanel tenant={tenant} company={company} step={phase === "done" ? 2 : step} docLabel={docLabel} />

        <div className="flex min-h-[560px] flex-col px-5 py-7 sm:px-10 sm:py-10">
          {phase === "done" ? (
            <Done company={company} verified={verified} />
          ) : phase === "submitting" ? (
            <div className="m-auto flex flex-col items-center text-center">
              <Loader2 className="size-8 animate-spin text-brand-forest" aria-hidden />
              <p className="mt-4 text-base font-medium text-brand-text">Setting up your account…</p>
              <p className="mt-1 text-sm text-brand-text-soft">This only takes a moment.</p>
            </div>
          ) : (
            <>
              <StepMeter step={step} />
              <div key={step} className="flex flex-1 flex-col animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
                {step === 0 ? (
                  <DetailsStep
                    values={values}
                    errors={errors}
                    touched={touched}
                    onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
                    onBlur={(k) => setTouched((t) => ({ ...t, [k]: true }))}
                    isGig={isGig}
                    setIsGig={(v) => {
                      setIsGig(v);
                      if (!v) setGigFiles([]);
                    }}
                    gigFiles={gigFiles}
                    setGigFiles={setGigFiles}
                    onNext={goVerify}
                  />
                ) : (
                  <VerifyStep
                    docLabel={docLabel}
                    session={session}
                    creating={creating}
                    remaining={remaining}
                    polling={polling}
                    verified={verified}
                    onStart={startVerification}
                    onCancel={() => {
                      setPolling(false);
                      setSession(null);
                    }}
                    onBack={() => setStep(0)}
                    onSubmit={submit}
                    submitError={submitError}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── pieces ──────────────────────────────────── */

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-brand-cream px-6">
      <div className="flex flex-col items-center text-center">{children}</div>
    </div>
  );
}

function WelcomePanel({
  tenant,
  company,
  step,
  docLabel,
}: {
  tenant: TenantInfo | null;
  company: string;
  step: number;
  docLabel: string;
}) {
  const expires = fmtExpiry(tenant?.expiresAt);
  const steps = [
    { title: "Your details", body: "Name, email and phone — nothing else." },
    { title: "Verify your ID", body: `Optional: photograph your ${docLabel} and a selfie on your phone.` },
    { title: "You're all set", body: "Next time you book, everything's already filled in." },
  ];
  return (
    <aside className="relative overflow-hidden bg-brand-forest-deep px-6 py-7 text-white sm:px-10 sm:py-10">
      {/* soft light in the corner */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-white/[0.06] blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-brand-amber/[0.08] blur-3xl" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-center gap-3">
          {tenant?.tenantLogo ? (
            <span className="inline-flex rounded-xl bg-white px-2.5 py-1.5">
              <img src={tenant.tenantLogo} alt="" className="h-7 w-auto max-w-[140px] object-contain" />
            </span>
          ) : null}
          <span className="text-sm font-medium text-white/85">{company}</span>
        </div>

        <div className="mt-8 md:mt-14">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-brand-amber">You're invited</p>
          <h1 className="mt-3 text-[28px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[34px]">
            Rent with {company} in a couple of minutes.
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70">
            Set up your account once, and every booking after this one is quicker.
          </p>
        </div>

        <ol className="mt-8 hidden space-y-5 md:block">
          {steps.map((s, i) => {
            const done = i < step;
            const now = i === step;
            return (
              <li key={s.title} className="flex gap-3.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200",
                    done ? "bg-brand-amber text-brand-text" : now ? "bg-white text-brand-forest-deep" : "bg-white/10 text-white/60",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : i + 1}
                </span>
                <span>
                  <span className={cn("block text-sm font-medium", now || done ? "text-white" : "text-white/60")}>{s.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-white/55">{s.body}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-auto hidden items-center gap-2 pt-10 text-xs text-white/55 md:flex">
          <ShieldCheck className="size-4 text-brand-amber" aria-hidden />
          <span>
            Your details go only to {company}.{expires ? ` This invite is open until ${expires}.` : ""}
          </span>
        </div>
      </div>
    </aside>
  );
}

function StepMeter({ step }: { step: Step }) {
  return (
    <div className="mb-7 flex items-center gap-3">
      <span className="text-xs font-medium text-brand-text-subtle">Step {step + 1} of 2</span>
      <div className="flex flex-1 gap-1.5">
        {[0, 1].map((i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-brand-stone">
            <span
              className={cn("block h-full rounded-full bg-brand-forest transition-[width] duration-500 ease-out", i <= step ? "w-full" : "w-0")}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── step 1 ─────────────────────────────────────────────────────────────── */

function DetailsStep({
  values,
  errors,
  touched,
  onChange,
  onBlur,
  isGig,
  setIsGig,
  gigFiles,
  setGigFiles,
  onNext,
}: {
  values: { name: string; email: string; phone: string };
  errors: Partial<Record<"name" | "email" | "phone", string>>;
  touched: Record<string, boolean>;
  onChange: (k: "name" | "email" | "phone", v: string) => void;
  onBlur: (k: string) => void;
  isGig: boolean;
  setIsGig: (v: boolean) => void;
  gigFiles: File[];
  setGigFiles: React.Dispatch<React.SetStateAction<File[]>>;
  onNext: () => void;
}) {
  const err = (k: "name" | "email" | "phone") => (touched[k] ? errors[k] : undefined);
  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
      noValidate
    >
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-brand-text">Tell us about you</h2>
      <p className="mt-1.5 text-sm text-brand-text-soft">We'll use these to confirm bookings and reach you about your rental.</p>

      <div className="mt-7 space-y-5">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="inv-name" required>
            Full name
          </FieldLabel>
          <Input
            id="inv-name"
            autoComplete="name"
            autoFocus
            value={values.name}
            placeholder="As it appears on your license"
            onChange={(e) => onChange("name", e.target.value.replace(/\d/g, ""))}
            onBlur={() => onBlur("name")}
            aria-invalid={err("name") ? true : undefined}
            className={cn(FIELD_INPUT_CLASS, err("name") && "border-danger")}
          />
          <FieldError message={err("name")} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="inv-email" required>
              Email
            </FieldLabel>
            <Input
              id="inv-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={values.email}
              placeholder="you@example.com"
              onChange={(e) => onChange("email", e.target.value)}
              onBlur={() => onBlur("email")}
              aria-invalid={err("email") ? true : undefined}
              className={cn(FIELD_INPUT_CLASS, err("email") && "border-danger")}
            />
            <FieldError message={err("email")} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="inv-phone" required>
              Phone
            </FieldLabel>
            <Input
              id="inv-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={values.phone}
              placeholder="(555) 123-4567"
              onChange={(e) => onChange("phone", e.target.value.replace(/[^0-9\s\-()+]/g, ""))}
              onBlur={() => onBlur("phone")}
              aria-invalid={err("phone") ? true : undefined}
              className={cn(FIELD_INPUT_CLASS, err("phone") && "border-danger")}
            />
            <FieldError message={err("phone")} />
          </div>
        </div>

        {/* Gig driver — a selectable card, not a stray checkbox */}
        <div
          className={cn(
            "rounded-2xl border transition-colors duration-200",
            isGig ? "border-brand-forest/40 bg-brand-forest/[0.04]" : "border-brand-border-soft hover:border-brand-border",
          )}
        >
          <label htmlFor="inv-gig" className="flex cursor-pointer items-center gap-3.5 px-4 py-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-stone text-brand-forest">
              <Briefcase className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-brand-text">I drive for a gig app</span>
              <span className="block text-xs text-brand-text-soft">Uber, Lyft, Bolt, DoorDash and similar</span>
            </span>
            <Checkbox id="inv-gig" checked={isGig} onCheckedChange={(c) => setIsGig(c === true)} className={CHECKBOX_CLASS} />
          </label>
          {isGig && (
            <div className="border-t border-brand-border-soft px-4 py-3.5">
              <p className="mb-2.5 text-xs text-brand-text-soft">Add a screenshot of your driver profile or earnings (JPG or PNG, up to 10 MB).</p>
              <div className="flex flex-wrap gap-2">
                {gigFiles.map((f, i) => (
                  <span key={f.name} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-brand-border-soft bg-white py-1 pl-3 pr-1 text-xs text-brand-text">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setGigFiles((p) => p.filter((_, x) => x !== i))}
                      className="flex size-6 items-center justify-center rounded-full text-brand-text-subtle hover:bg-brand-stone hover:text-brand-text"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
                <Label
                  htmlFor="inv-gig-files"
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-brand-border px-3 text-xs font-medium text-brand-forest hover:bg-brand-stone"
                >
                  <ImagePlus className="size-3.5" aria-hidden />
                  {gigFiles.length ? "Add another" : "Add proof"}
                </Label>
                <input
                  id="inv-gig-files"
                  type="file"
                  accept=".jpg,.jpeg,.png"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []).filter(
                      (f) => ["image/jpeg", "image/jpg", "image/png"].includes(f.type) && f.size <= 10 * 1024 * 1024,
                    );
                    setGigFiles((prev) => {
                      const names = new Set(prev.map((f) => f.name));
                      return [...prev, ...picked.filter((f) => !names.has(f.name))];
                    });
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto pt-8">
        <Button type="submit" variant="brand" className="h-12 w-full rounded-full text-[15px] font-medium">
          Continue
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </form>
  );
}

/* ── step 2 ─────────────────────────────────────────────────────────────── */

function VerifyStep({
  docLabel,
  session,
  creating,
  remaining,
  polling,
  verified,
  onStart,
  onCancel,
  onBack,
  onSubmit,
  submitError,
}: {
  docLabel: string;
  session: { qrUrl: string } | null;
  creating: boolean;
  remaining: number;
  polling: boolean;
  verified: null | "GREEN" | "RED" | "REVIEW";
  onStart: () => void;
  onCancel: () => void;
  onBack: () => void;
  onSubmit: () => void;
  submitError: string | null;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-brand-text">Verify your identity</h2>
      <p className="mt-1.5 text-sm text-brand-text-soft">
        Optional, but it means you won't need to do it at pickup. Takes about two minutes on your phone.
      </p>

      <div className="mt-7 flex-1">
        {verified ? (
          <div
            className={cn(
              "flex items-start gap-3.5 rounded-2xl border px-5 py-4",
              verified === "GREEN" ? "border-success/30 bg-success-light" : verified === "RED" ? "border-danger/30 bg-danger-subtle" : "border-brand-gold/40 bg-brand-pale-yellow",
            )}
          >
            {verified === "RED" ? (
              <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            ) : (
              <BadgeCheck className={cn("mt-0.5 size-5 shrink-0", verified === "GREEN" ? "text-success" : "text-brand-gold")} aria-hidden />
            )}
            <div>
              <p className="text-sm font-medium text-brand-text">
                {verified === "GREEN" ? "You're verified" : verified === "RED" ? "We couldn't verify your ID" : "Sent for a quick review"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-brand-text-soft">
                {verified === "GREEN"
                  ? "Your ID and selfie matched. Finish below to create your account."
                  : verified === "RED"
                    ? "You can still finish — the rental company will check your ID at pickup."
                    : "The rental company will confirm it shortly. You can finish now."}
              </p>
            </div>
          </div>
        ) : session ? (
          <div className="grid items-center gap-6 rounded-2xl border border-brand-border-soft p-5 sm:grid-cols-[auto_1fr]">
            <div className="mx-auto rounded-2xl border border-brand-border-soft bg-white p-3">
              <img
                src={`https://quickchart.io/qr?text=${encodeURIComponent(session.qrUrl)}&size=200&margin=1&dark=000000&light=ffffff&ecLevel=M&format=png`}
                alt="QR code to verify on your phone"
                width={168}
                height={168}
                className="block size-[168px] [image-rendering:pixelated]"
              />
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-brand-text">Scan with your phone's camera</p>
                <p className="mt-1 text-xs leading-relaxed text-brand-text-soft">
                  Take a photo of your {docLabel}, then a quick selfie. Keep this page open — it moves on by itself.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-brand-forest">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-forest/50" />
                  <span className="relative inline-flex size-2 rounded-full bg-brand-forest" />
                </span>
                {polling ? "Waiting for your phone…" : "Starting…"}
                <span className={cn("ml-auto inline-flex items-center gap-1 tabular-nums", remaining < 60 ? "text-danger" : "text-brand-text-subtle")}>
                  <Clock className="size-3.5" aria-hidden />
                  {fmtClock(remaining)}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-brand-stone">
                <div className="h-full rounded-full bg-brand-forest transition-[width] duration-1000 ease-linear" style={{ width: `${(remaining / QR_LIFETIME_S) * 100}%` }} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(session.qrUrl);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-brand-border-soft px-3 text-xs text-brand-text hover:bg-brand-stone"
                >
                  {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied ? "Link copied" : "Copy link instead"}
                </button>
                <button type="button" onClick={onCancel} className="h-8 px-2 text-xs text-brand-text-subtle hover:text-brand-text">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={creating}
            className="group flex w-full items-center gap-4 rounded-2xl border border-brand-border-soft px-5 py-5 text-left transition-colors duration-200 hover:border-brand-forest/40 hover:bg-brand-forest/[0.03] disabled:opacity-70"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-forest text-white">
              {creating ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ScanFace className="size-5" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-brand-text">Verify with your phone</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-brand-text-soft">
                Scan a QR code, photograph your {docLabel}, take a selfie.
              </span>
            </span>
            <span className="flex items-center gap-1 text-sm font-medium text-brand-forest">
              {creating ? "Starting…" : "Start"}
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </span>
          </button>
        )}

        {!session && !verified && (
          <p className="mt-4 flex items-center gap-2 text-xs text-brand-text-subtle">
            <Smartphone className="size-3.5" aria-hidden />
            No phone handy? Skip it — you can verify at pickup instead.
          </p>
        )}
        {submitError && <p className="mt-4 text-sm text-danger">{submitError}</p>}
      </div>

      <div className="flex items-center gap-3 pt-8">
        <Button type="button" variant="brand-outline" className="h-12 rounded-full px-5" onClick={onBack} disabled={polling}>
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <Button
          type="button"
          variant="brand"
          className="h-12 flex-1 rounded-full text-[15px] font-medium"
          onClick={onSubmit}
          disabled={polling}
        >
          {polling ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Finishing verification…
            </>
          ) : verified ? (
            "Create my account"
          ) : (
            "Skip and create my account"
          )}
        </Button>
      </div>
    </div>
  );
}

/* ── done ───────────────────────────────────────────────────────────────── */

function Done({ company, verified }: { company: string; verified: null | "GREEN" | "RED" | "REVIEW" }) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center text-center animate-in fade-in-0 zoom-in-95 duration-300 ease-out motion-reduce:animate-none">
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-full bg-success/20 [animation-iteration-count:2]" aria-hidden />
        <span className="relative flex size-16 items-center justify-center rounded-full bg-success-light">
          <CheckCircle2 className="size-8 text-success" aria-hidden />
        </span>
      </div>
      <h2 className="mt-6 text-2xl font-medium tracking-[-0.02em] text-brand-text">You're registered</h2>
      <p className="mt-2 text-sm leading-relaxed text-brand-text-soft">
        {company} has your details. They'll be in touch about your rental — and next time you book, you're already set up.
      </p>
      {verified && verified !== "RED" && (
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-success-light px-3 py-1 text-xs font-medium text-success">
          <ShieldCheck className="size-3.5" aria-hidden />
          ID {verified === "GREEN" ? "verified" : "sent for review"}
        </p>
      )}
      <Button asChild variant="brand-outline" className="mt-8 h-11 rounded-full px-6">
        <a href="/">Visit {company}</a>
      </Button>
    </div>
  );
}
