"use client";

/**
 * The invite registration page's LOGIC, shared by the v1 page
 * (`invite-registration.tsx`) and the v2 one
 * (`northwind-site/site-v2/register/invite-registration.tsx`). Only the markup
 * is forked.
 *
 * Same edge functions, same order, same payloads as the original page:
 * validate-customer-invite → (optional) create-ai-verification-session and a
 * poll of identity_verifications → submit-customer-registration.
 *
 * `notify` is where the two transient messages go (a verification that would
 * not start, a QR that ran out). v1 passes `toast.error`; v2 has no Toaster
 * mounted, so it puts them inline instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@nw/integrations/supabase/client";

/* ─────────────────────────────── types ──────────────────────────────────── */

export interface InviteTenantInfo {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantLogo: string | null;
  tenantPrimaryColor: string | null;
  acceptedVerificationDocument: "drivers_license" | "passport" | "id_card";
  expiresAt: string;
}

export const DOC_LABEL: Record<string, string> = {
  drivers_license: "driver's license",
  passport: "passport",
  id_card: "ID card",
};

export type InvitePhase = "loading" | "invalid" | "form" | "submitting" | "done";
export type InviteStep = 0 | 1;
export type InviteVerdict = null | "GREEN" | "RED" | "REVIEW";
export type InviteField = "name" | "email" | "phone";
export type InviteValues = Record<InviteField, string>;
export type InviteErrors = Partial<Record<InviteField, string>>;

export interface InviteVerificationSession {
  sessionId: string;
  qrUrl: string;
  expiresAt: Date;
}

export const QR_LIFETIME_S = 900;

/* ─────────────────────────────── helpers ────────────────────────────────── */

export function validateInvite(v: InviteValues): InviteErrors {
  const e: InviteErrors = {};
  if (v.name.trim().length < 2) e.name = "Enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (v.phone.replace(/\D/g, "").length < 5) e.phone = "Enter a phone number we can reach you on.";
  return e;
}

export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function fmtExpiry(iso: string | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/** The QR image for a verification link (the original page's renderer). */
export function inviteQrImageUrl(qrUrl: string) {
  return `https://quickchart.io/qr?text=${encodeURIComponent(qrUrl)}&size=200&margin=1&dark=000000&light=ffffff&ecLevel=M&format=png`;
}

/** What the gig-proof picker accepts: JPG or PNG, up to 10 MB. */
export const GIG_ACCEPT = ".jpg,.jpeg,.png";

/** Add picked gig-proof files to the list: valid types and sizes only, no repeated names. */
export function mergeGigFiles(prev: File[], list: ArrayLike<File> | null): File[] {
  const picked = Array.from(list ?? []).filter(
    (f) => ["image/jpeg", "image/jpg", "image/png"].includes(f.type) && f.size <= 10 * 1024 * 1024,
  );
  const names = new Set(prev.map((f) => f.name));
  return [...prev, ...picked.filter((f) => !names.has(f.name))];
}

/** What the name and phone fields allow to be typed. */
export const sanitizeInviteInput = (k: InviteField, v: string) =>
  k === "name" ? v.replace(/\d/g, "") : k === "phone" ? v.replace(/[^0-9\s\-()+]/g, "") : v;

/* ──────────────────────────────── hook ──────────────────────────────────── */

export function useInviteRegistration({
  token,
  notify,
}: {
  token: string;
  notify: (message: string) => void;
}) {
  const [phase, setPhase] = useState<InvitePhase>("loading");
  const [invalidReason, setInvalidReason] = useState("");
  const [tenant, setTenant] = useState<InviteTenantInfo | null>(null);
  const [step, setStep] = useState<InviteStep>(0);

  const [values, setValues] = useState<InviteValues>({ name: "", email: "", phone: "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isGig, setIsGigRaw] = useState(false);
  const [gigFiles, setGigFiles] = useState<File[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Verification (identical mechanics to the original page).
  const [session, setSession] = useState<InviteVerificationSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [polling, setPolling] = useState(false);
  const [verified, setVerified] = useState<InviteVerdict>(null);
  const [verifiedSessionId, setVerifiedSessionId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // `notify` is read through a ref so a caller passing a fresh closure each
  // render does not restart the countdown effect.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const errors = useMemo(() => validateInvite(values), [values]);
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
        setTenant(data as InviteTenantInfo);
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
      notifyRef.current(err instanceof Error ? err.message : "Couldn't start verification");
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
        notifyRef.current("The QR code expired. Start again to get a new one.");
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session]);

  const check = useCallback(async () => {
    if (!polling || !session || !tenant) return;
    try {
      // Scoped to this tenant as well as the session (V2_PLAN §5).
      const { data, error } = await supabase
        .from("identity_verifications")
        .select("status, review_status, review_result")
        .eq("session_id", session.sessionId)
        .eq("tenant_id", tenant.tenantId)
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
  }, [polling, session, tenant]);

  useEffect(() => {
    if (!polling || !session) return;
    const first = setTimeout(check, 5000);
    pollRef.current = setInterval(check, 3000);
    return () => {
      clearTimeout(first);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [polling, session, check]);

  const cancelVerification = () => {
    setPolling(false);
    setSession(null);
  };

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

  /** Step 1 → step 2, once every field is valid (touching them all shows why not). */
  const goVerify = () => {
    setTouched({ name: true, email: true, phone: true });
    if (Object.keys(errors).length) return;
    setStep(1);
  };

  /** Turning gig driver off drops any proof already chosen. */
  const setIsGig = (v: boolean) => {
    setIsGigRaw(v);
    if (!v) setGigFiles([]);
  };

  const setValue = (k: InviteField, v: string) => setValues((p) => ({ ...p, [k]: v }));
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  return {
    phase,
    invalidReason,
    tenant,
    step,
    setStep,
    values,
    setValue,
    touched,
    touch,
    errors,
    isGig,
    setIsGig,
    gigFiles,
    setGigFiles,
    submitError,
    session,
    creating,
    remaining,
    polling,
    verified,
    docLabel,
    startVerification,
    cancelVerification,
    submit,
    goVerify,
  };
}
