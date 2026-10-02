"use client";

/**
 * The Customer stage of the rental control centre — real data, real actions.
 *
 * The design is the playground's `rental-create-fake/_customer-tab.tsx`; the
 * data is not. Every figure on this screen comes from a row, and anything that
 * cannot be sourced yet says so instead of showing a plausible number. On a
 * real rental an invented figure is a lie, and this is the screen an operator
 * reads before handing over a car.
 *
 * ONE thing from the prototype did not survive contact: the roster. The sandbox
 * was a CREATE screen, so its Customer tab was a search box over every customer
 * plus an invite flow for people who are not in the list yet. A rental detail
 * page already has a customer — `rentals.customer_id` is set and the whole
 * screen is addressed to them — so a picker here would be an invitation to
 * reassign a live rental to somebody else, which is not a thing this stage is
 * for. What survives is the sandbox's SELECTED view, which was always the
 * interesting half: who is this person, and are they safe to hand a car to?
 *
 * Three things answer that, in this order — identity (verification), history
 * (rentals), and what your own staff said afterwards (reviews).
 *
 * LAYOUT (Oct 2026, island UI): the main pane never scrolls and never leaves
 * dead space. A slim identity strip on top (the full file is "Open profile"),
 * then Verification and Reviews as two full-width rows sharing the height 3:2.
 * Each row lays out left-to-right (state | documents, score | latest reviews);
 * the full review list opens in a dialog instead of growing the pane.
 *
 * The question the stage has to answer, in one screenful, is:
 *
 *     who is this person, and are they safe to hand a car to?
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Ban,
  ExternalLink,
  Image as ImageIcon,
  MessageSquareText,
  RotateCw,
  Undo2,
  X,
  Link2,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { BlurredImage } from "@/components/ui/blurred-image";
import { TraxMark } from "@/components/trax/trax-greeting";
import { useToast } from "@/hooks/use-toast";
// v1's dialog, reused as it stands: it is the one working route to a new
// `create-ai-verification-session` (QR + copyable link for the customer).
import { StartVerificationDialog } from "@/components/customers/start-verification-dialog";
import { Button } from "@/components/ui-v2/button";
import { Badge } from "@/components/ui-v2/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui-v2/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { useCustomerReviewSummary } from "@/hooks/use-customer-review-summary";
import type { StageProps } from "./stages";
import { CustomerPicker, useCustomerSwitchable } from "./customer-picker";
import {
  StageAction,
  cardCls,
  fmtDate,
  initials,
  insetCls,
  listCls,
  EmptyHint,
  Panel,
  Pill,
  Surface,
} from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Verification — reading the real rows
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The latest identity check for this customer.
 *
 * Carried across from `(dashboard)/rentals/[id]/page.tsx:1797` — including the
 * email fallback and its two writes, which look like a side effect in a read
 * and are not optional. A verification session started from the booking site
 * lands with `customer_id = null` and only an email on it; v1's page is what
 * links it to the customer and syncs `customers.identity_verification_status`.
 * For the canary, v1's page never mounts — so if this hook did not do it,
 * nothing would, and a customer who genuinely verified would read as unverified
 * here forever.
 *
 * Both guards on the customer write are v1's and both are load-bearing: the
 * `tenant_id` filter (without it, merely OPENING a rental could rewrite another
 * tenant's customer) and the `manually_verified` exclusion (a staff member's
 * in-person vouch must not be erased by a later row resolving pending).
 */
function useCustomerVerification(customerId: string | null, customerEmail: string | null) {
  const { tenant } = useTenant();

  return useQuery({
    // Its own key: v1 reads the latest row of ANY provider under
    // "customer-identity-verification"; this one skips CheckMyDriver rows,
    // which are a separate check with their own chip (see useCmdCheck).
    queryKey: ["customer-trax-id-v2", customerId, customerEmail, tenant?.id],
    queryFn: async () => {
      if (!customerId) return null;

      // The last few rows, not just the newest: sending a new link creates an
      // EMPTY row, and reading only the newest would hide a passed check behind
      // a link the customer has not opened yet. The card shows the latest row
      // that has a result or documents; a newer empty one is carried alongside
      // as `pendingLink` so the card can say a link is out.
      const { data: rows, error } = await supabase
        .from("identity_verifications")
        .select("*")
        .eq("customer_id", customerId)
        .neq("provider", "cmd")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) console.error("Error fetching identity verification:", error);
      if (rows?.length) {
        const hasOutcome = (r: any) =>
          !!(r.review_result || r.document_front_url || r.selfie_image_url || r.face_image_url);
        const current = rows.find(hasOutcome);
        if (!current) return rows[0] as Record<string, any>;
        const newest = rows[0] as any;
        const pendingLink = newest.id !== current.id && !hasOutcome(newest) ? newest : null;
        return { ...(current as any), pendingLink } as Record<string, any>;
      }

      if (customerEmail) {
        const email = customerEmail.toLowerCase().trim();
        const { data: byEmail, error: emailError } = await supabase
          .from("identity_verifications")
          .select("*")
          .eq("customer_email", email)
          .is("customer_id", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (emailError) {
          console.error("Error fetching identity verification by email:", emailError);
          return null;
        }

        if (byEmail) {
          await supabase
            .from("identity_verifications")
            .update({ customer_id: customerId, tenant_id: tenant?.id })
            .eq("id", (byEmail as any).id);

          // Skip entirely without a tenant rather than passing a placeholder:
          // tenant_id is uuid, and comparing it to '' fails with "invalid input
          // syntax for type uuid" — which supabase-js RETURNS rather than
          // throws, so it would have failed silently.
          if (tenant?.id) {
            const result = (byEmail as any).review_result;
            const status = result === "GREEN" ? "verified" : result === "RED" ? "rejected" : "pending";
            const { error: syncError } = await supabase
              .from("customers")
              .update({ identity_verification_status: status })
              .eq("id", customerId)
              .eq("tenant_id", tenant.id)
              .neq("identity_verification_status", "manually_verified");
            if (syncError) console.error("Failed to sync customer verification status:", syncError);
          }

          return { ...(byEmail as any), customer_id: customerId } as Record<string, any>;
        }
      }

      return null;
    },
    enabled: !!customerId,
  });
}

/**
 * The latest CheckMyDriver check for this customer.
 *
 * Read directly rather than through `useCmdVerification`, which is switched off
 * for lean tenants (they are not OFFERED CMD). Showing a check that already
 * exists is not offering it, and a chip for it costs one read.
 */
function useCmdCheck(customerId: string | null) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["customer-cmd-check-v2", customerId, tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("identity_verifications")
        .select("id, status, cmd_status, cmd_license_status, created_at, verification_completed_at")
        .eq("customer_id", customerId!)
        .eq("provider", "cmd")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Record<string, any> | null) ?? null;
    },
    enabled: !!customerId && !!tenant?.id,
  });
}

type Chip = {
  key: string;
  label: string;
  tone: "success" | "primary" | "neutral" | "destructive";
  /** Trax ran this check — the pill wears Trax's mark instead of a shield. */
  trax?: boolean;
  /** This customer's own figures, shown in the hover card ("Face match 100%"). */
  facts?: string[];
};

/**
 * One chip per kind of verification the customer has — Trax ID, CheckMyDriver,
 * In person. They are independent: a customer can carry all three, or one.
 *
 *  - Trax ID   the AI check Trax runs (licence scan + face match). A legacy
 *              Veriff row is shown under its own name, not as Trax's work.
 *  - CMD       CheckMyDriver's licence status.
 *  - In person `customers.identity_verification_status = 'manually_verified'`.
 */
function verificationChips(
  trax: Record<string, any> | null | undefined,
  cmd: Record<string, any> | null | undefined,
  customerStatus: string | null | undefined
): Chip[] {
  const chips: Chip[] = [];

  if (trax) {
    const byTrax = trax.verification_provider !== "veriff";
    const pct = (v: any) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * (Number(v) <= 1 ? 100 : 1)));
    const face = pct(trax.ai_face_match_score);
    const read = pct(trax.ai_ocr_data?.confidence);
    const facts = [
      trax.verification_completed_at ? `Checked ${fmtDate(trax.verification_completed_at)}` : null,
      face != null ? `Face match ${face}%` : null,
      read != null ? `Licence read ${read}%` : null,
    ].filter(Boolean) as string[];
    const name = byTrax ? "Trax ID" : "Veriff";
    const result = String(trax.review_result ?? "").toUpperCase();
    if (result === "GREEN") chips.push({ key: "trax", label: name, tone: "success", trax: byTrax, facts });
    else if (result === "RED") chips.push({ key: "trax", label: `${name} failed`, tone: "destructive", trax: byTrax, facts });
    else if (trax.document_front_url || trax.selfie_image_url || trax.face_image_url)
      chips.push({ key: "trax", label: `${name} in review`, tone: "primary", trax: byTrax, facts });
    else chips.push({ key: "trax", label: `${name} link sent`, tone: "neutral", trax: byTrax, facts });
  } else if (customerStatus === "verified") {
    // Verified with no check row on file (an older sync) — still a pass.
    chips.push({ key: "trax", label: "ID verified", tone: "success" });
  }

  if (cmd) {
    const lic = cmd.cmd_license_status;
    if (lic === "Valid") chips.push({ key: "cmd", label: "CMD", tone: "success" });
    else if (lic === "Invalid") chips.push({ key: "cmd", label: "CMD invalid", tone: "destructive" });
    else if (lic === "Expired") chips.push({ key: "cmd", label: "CMD expired", tone: "destructive" });
    else chips.push({ key: "cmd", label: "CMD pending", tone: "primary" });
  }

  // In person — hidden for now (Ghulam, 2026-10-02). The data is still read;
  // restoring the chip is uncommenting this line.
  // if (customerStatus === "manually_verified") chips.push({ key: "manual", label: "In person", tone: "success" });

  return chips;
}

type TraxActions = {
  /** Re-scan the documents already on file. Absent when there are none. */
  onRescan?: () => void;
  rescanning?: boolean;
  /** Send the customer a link to upload new photos (ends in a scan too). */
  onNewLink: () => void;
};

/**
 * What Trax ID is, on hover — the app's white explainer card (the same
 * HoverCard the empty states use), in Trax's own voice. Below the explanation,
 * this customer's own figures.
 */
function TraxIdHover({ facts, children }: { facts?: string[]; children: React.ReactNode }) {
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <span className="inline-flex cursor-default">{children}</span>
      </HoverCardTrigger>
      {/* To the RIGHT of the pill, top edges aligned: the pill is the
          Verification card's heading, top-left, and the card sits at the
          bottom of the pane — "below" has no room (Radix flipped it up over
          the Reviews card) and "left" runs off the pane. Right of it is the
          card's own image row: the explainer covers only what it explains. */}
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={16}
        className="w-72 rounded-2xl p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <TraxMark size="xs" />
          <p className="text-[13px] font-semibold text-foreground">Trax ID</p>
        </div>
        <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
          I read the licence, make sure it is real and in date, then match the face on it to a live selfie. If
          anything does not line up, you will see it here before the keys change hands.
        </p>
        {!!facts?.length && (
          <div className="mt-3 space-y-1 border-t border-foreground/5 pt-3">
            {facts.map((f) => (
              <p key={f} className="text-[12px] font-medium text-foreground/80">
                {f}
              </p>
            ))}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function VerificationChips({ chips }: { chips: Chip[] }) {
  if (!chips.length) return <Pill tone="neutral">Not verified</Pill>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) =>
        c.trax ? (
          // Trax's own pill: its mark, on the primary tint, whatever the
          // outcome — the label carries the result ("Trax ID failed").
          <TraxIdHover key={c.key} facts={c.facts}>
            <Pill tone={c.tone === "destructive" ? "neutral" : "primary"}>
              <TraxMark size="xs" className="-ml-1 size-4" />
              <span className={c.tone === "destructive" ? "text-destructive" : undefined}>{c.label}</span>
            </Pill>
          </TraxIdHover>
        ) : c.tone === "destructive" ? (
          <Badge key={c.key} variant="destructive" className="gap-1.5">
            <ShieldAlert />
            {c.label}
          </Badge>
        ) : (
          <Pill key={c.key} tone={c.tone}>
            {c.tone === "success" && <ShieldCheck />}
            {c.label}
          </Pill>
        )
      )}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Reviews
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A rating is the only thing here allowed to go red. Below 5 out of 10 is a
 * genuine "look at this before you hand over keys", not an out-of-date warning,
 * so it wears `destructive` rather than the amber reserved for drift.
 */
const RATING_TONE = {
  good: { text: "text-success", bar: "bg-success", tile: "bg-success-light text-success" },
  fair: { text: "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]", bar: "bg-primary", tile: "bg-primary-light text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" },
  poor: { text: "text-destructive", bar: "bg-destructive", tile: "bg-destructive-light text-destructive" },
} as const;

const ratingTone = (n: number) => (n >= 8 ? RATING_TONE.good : n >= 5 ? RATING_TONE.fair : RATING_TONE.poor);

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

export function StageCustomer({ detail, refetch }: StageProps) {
  const { tenantSlug } = useTenant();
  const customer = detail.customer;
  const customerId = customer?.id ?? null;

  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  /** Cleared: the stage shows the picker instead of the customer. Nothing is written until a pick. */
  const [picking, setPicking] = useState(false);
  const switchable = useCustomerSwitchable(detail.rental.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  /* Run Trax ID again — on the documents already on file, via
     trax-id-rescan-v2. The customer does nothing; the same row is updated. */
  const rescan = useMutation({
    mutationFn: async (verificationId: string) => {
      const { data, error } = await supabase.functions.invoke("trax-id-rescan-v2", { body: { verificationId } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "The scan did not run");
      return data.result as "verified" | "rejected" | "review_required";
    },
    onSuccess: (result) => {
      toast({
        title:
          result === "verified"
            ? "I scanned it again. It still checks out."
            : result === "review_required"
              ? "I scanned it again. The face match needs a human look."
              : "I scanned it again. It did not pass this time.",
      });
    },
    onError: (e: Error) => toast({ title: "I could not scan it again", description: e.message, variant: "destructive" }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["customer-trax-id-v2", customerId] }),
  });

  const { data: verification } = useCustomerVerification(
    customerId,
    customer?.email ?? null
  );
  const { data: reviews } = useCustomerReviews(customerId ?? undefined);
  const { data: reviewSummary } = useCustomerReviewSummary(customerId ?? undefined);

  const { data: cmdCheck } = useCmdCheck(customerId);
  const hasDocs = !!(verification?.document_front_url && (verification?.selfie_image_url || verification?.face_image_url));
  const traxActions: TraxActions = {
    onRescan: verification && hasDocs ? () => rescan.mutate(verification.id) : undefined,
    rescanning: rescan.isPending,
    onNewLink: () => setVerifyOpen(true),
  };
  const chips = verificationChips(verification, cmdCheck, customer?.identity_verification_status);

  const average = useMemo(() => {
    if (reviewSummary?.average_rating != null) return Number(reviewSummary.average_rating);
    if (!reviews?.length) return null;
    const rated = reviews.filter((r) => r.rating != null);
    if (!rated.length) return null;
    return rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length;
  }, [reviewSummary, reviews]);

  const tone = average === null ? null : ratingTone(average);

  /* No customer yet: a rental started from "New Rental" (a draft — Pending,
     no customer or car) is created empty and filled in here. The stage IS the
     picker until someone is chosen. */
  if (!customer) {
    return (
      <Panel fill title="Customer" description="Who is renting? Find them, or pick them from the list.">
        <CustomerPicker
          rentalId={detail.rental.id}
          currentCustomerId={null}
          onDone={(changed) => {
            if (changed) refetch();
          }}
        />
      </Panel>
    );
  }

  const firstName = customer.name.split(" ")[0] || "the customer";

  const faceScore = verification?.ai_face_match_score;

  /* The fields the check extracted. Columns first, `ai_ocr_data` as the
     fallback (the AI provider fills both; others fill only the columns). */
  const ocr = (verification?.ai_ocr_data ?? {}) as Record<string, any>;
  const docName = [verification?.first_name ?? ocr.firstName, verification?.last_name ?? ocr.lastName]
    .filter(Boolean)
    .join(" ");
  const dob = verification?.date_of_birth ?? ocr.dateOfBirth ?? null;
  const docType = verification?.document_type ?? ocr.documentType ?? null;
  const docCountry = verification?.document_country ?? ocr.documentCountry ?? null;
  const docNumber = verification?.document_number ?? ocr.documentNumber ?? null;
  const expiry = verification?.document_expiry_date ?? ocr.documentExpiry ?? null;
  const expired = expiry ? new Date(`${String(expiry).slice(0, 10)}T23:59:59`) < new Date() : false;
  const confidence = ocr.confidence != null ? Number(ocr.confidence) : null;
  const DOC_TYPES: Record<string, string> = {
    id_card: "ID card",
    driving_license: "Driving licence",
    drivers_license: "Driving licence",
    passport: "Passport",
    residence_permit: "Residence permit",
  };
  const extracted = [
    docName && { label: "Name on document", value: docName },
    dob && { label: "Date of birth", value: fmtDate(dob) },
    (docType || docCountry) && {
      label: "Document",
      value: [docType ? (DOC_TYPES[docType] ?? docType.replace(/_/g, " ")) : null, docCountry].filter(Boolean).join(" · "),
    },
    docNumber && { label: "Number", value: String(docNumber), secret: true },
    expiry && {
      label: expired ? "Expired" : "Expires",
      value: fmtDate(expiry),
      tone: expired ? "text-destructive" : undefined,
    },
    confidence != null &&
      Number.isFinite(confidence) && {
        label: "Read confidence",
        value: `${Math.round(confidence * (confidence <= 1 ? 100 : 1))}%`,
      },
  ].filter(Boolean) as { label: string; value: string; secret?: boolean; tone?: string }[];


  /* The three document slots are always drawn — each says plainly whether it is
     on file — so the verification card has a stable shape on every rental. */
  const docSlots = [
    { url: verification?.document_front_url, label: "Licence front" },
    { url: verification?.document_back_url, label: "Licence back" },
    { url: verification?.selfie_image_url ?? verification?.face_image_url, label: "Selfie" },
  ] as { url: string | null | undefined; label: string }[];

  return (
    <Panel
      fill
      title="Customer"
      action={
        picking ? (
          /* Back out: the rental still has its customer — clearing wrote nothing. */
          <StageAction icon={Undo2} label={`Keep ${customer.name.split(" ")[0]}`} onClick={() => setPicking(false)} />
        ) : (
          /* Clear who is renting — only while the rental is still in its first
             four stages; the database says when it is not, and why. */
          <StageAction
            icon={X}
            label="Clear customer"
            onClick={() => setPicking(true)}
            disabledReason={
              switchable.data?.ok ? null : (switchable.data?.reason ?? "Checking whether the customer can still change…")
            }
          />
        )
      }
      description="Who is renting. Everything else on this rental is addressed to them."
    >
      {/* Island layout: the pane never scrolls and never leaves dead space.
          A slim identity strip on top, then Verification and Reviews as two
          full-width rows (Reviews first) sharing the remaining height. */}
      {picking ? (
        <CustomerPicker
          rentalId={detail.rental.id}
          currentCustomerId={customer.id}
          onDone={(changed) => {
            setPicking(false);
            if (changed) refetch();
          }}
        />
      ) : (
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* ── who — brief; the full file is one click away ───────────────── */}
        <Surface className="shrink-0 px-5 py-4">
          <div className="flex items-center gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-3xl bg-primary-light font-heading text-sm font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
              {initials(customer.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-base font-semibold tracking-tight">{customer.name}</h3>
                {customer.is_blocked && (
                  <Badge variant="destructive" className="gap-1.5" title={customer.blocked_reason || "No reason was recorded."}>
                    <Ban />
                    Blocked
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                {customer.email || "No email on file"}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/customers/${customer.id}`}>
                <ExternalLink />
                Open profile
              </Link>
            </Button>
          </div>
          {customer.is_blocked && (
            <p className="mt-3 truncate rounded-2xl bg-destructive-light px-4 py-2 text-xs text-destructive ring-1 ring-destructive/20">
              Blocked — {customer.blocked_reason || "no reason was recorded."} Unblock from their profile.
            </p>
          )}
        </Surface>

        {/* ── Trax summary — a full-width row ──────────────────────────────
            The whole section is Trax's read of every staff review. The average
            and the count ride in the header for now (to be reworked); the full
            list opens from the count. */}
        <Surface className="flex flex-none flex-col p-5">
          <div className="flex items-center gap-2.5">
            <h3 className="flex-1 font-heading text-sm font-semibold">Reviews summary</h3>
            {!!reviews?.length && (
              <button
                type="button"
                onClick={() => setReviewsOpen(true)}
                className="flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 ring-1 ring-amber-400/25 transition-colors duration-200 ease-out hover:bg-amber-400/20 motion-reduce:transition-none"
              >
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                <span className={cn("font-heading text-sm font-semibold leading-none", tone?.text)}>
                  {average !== null ? (average / 2).toFixed(1) : "—"}
                </span>
              </button>
            )}
          </div>

          <div className={cn(insetCls, "mt-4 flex min-h-0 flex-1 flex-col justify-center px-6 py-5")}>
            {!reviews?.length ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                Nobody has rated {firstName} yet. When this rental closes and your team rates it, I will start keeping
                track here.
              </p>
            ) : (
              <>
                <p className="line-clamp-4 text-[15px] leading-relaxed text-foreground/80">
                  {reviewSummary?.summary ??
                    `I need a couple more reviews of ${firstName} before I can say anything worth reading.`}
                </p>
              </>
            )}
          </div>
        </Surface>

        {/* ── verification — a full-width row ──────────────────────────────
            Left: the state and its history. Right: the documents at their
            real proportions. Actions along the bottom. */}
        {/* The whole card opens the full check — except the images (a click
            there reveals them) and the chips (their hover card has its own
            button). Both stop the click; React bubbles portal events through
            the component tree, so the chips' wrapper also catches clicks from
            inside the hover card. */}
        <div
          role={verification ? "button" : undefined}
          tabIndex={verification ? 0 : undefined}
          aria-label={verification ? "Open the full identity check" : undefined}
          onClick={verification ? () => setCheckOpen(true) : undefined}
          onKeyDown={
            verification
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCheckOpen(true);
                  }
                }
              : undefined
          }
          className={cn(
            cardCls,
            "group flex min-h-0 flex-1 flex-col p-5 outline-none",
            verification &&
              "cursor-pointer transition-shadow duration-200 ease-out hover:ring-primary/25 focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
          )}
        >
          <div className="flex items-center gap-3">
            {/* The heading, with the chips beside it — Trax ID first. */}
            <h3 className="font-heading text-sm font-semibold">Verification</h3>
            <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
              <VerificationChips chips={chips} />
              {verification?.pendingLink && (
                <span className="text-[11px] text-muted-foreground">
                  New link sent {fmtDate(verification.pendingLink.created_at)}
                </span>
              )}
            </span>
            <span className="flex-1" />
            {/* Quick actions, quiet until hovered. They stop the click so the
                card's own "open the check" does not fire underneath them. */}
            <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5">
              {traxActions.onRescan && (
                <IconAction
                  label={traxActions.rescanning ? "Scanning again…" : "Run Trax ID again"}
                  onClick={traxActions.onRescan}
                  disabled={traxActions.rescanning}
                >
                  <RotateCw className={cn(traxActions.rescanning && "animate-spin motion-reduce:animate-none")} />
                </IconAction>
              )}
              <IconAction label="Send a new verification link" onClick={traxActions.onNewLink}>
                <Link2 />
              </IconAction>
            </span>
            {verification && (
              <ExternalLink
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-colors duration-200 ease-out group-hover:text-foreground motion-reduce:transition-none"
              />
            )}
          </div>

          {/* The documents ARE the card. Real proportions: a licence is an
              ID-1 card (85.6 × 54mm, so 1.586:1) and a selfie is square; the
              column fractions follow that ratio. The row takes exactly the
              height left in the card (the pane never scrolls), so the tiles
              track the ratio closely rather than exactly and the photos are
              cropped to cover. Blurred until clicked — these are somebody's
              licence and face. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-4 grid min-h-28 flex-1 cursor-default grid-cols-[1.586fr_1.586fr_1fr] gap-3"
          >
            {docSlots.map((d) => (
              <div key={d.label} className="flex min-h-0 min-w-0 flex-col">
                <div className={cn(insetCls, "relative min-h-0 flex-1 overflow-hidden")}>
                  {d.url ? (
                    <BlurredImage
                      src={d.url}
                      alt={d.label}
                      containerClassName="absolute inset-0"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/50">
                      <ImageIcon className="size-4" />
                      <span className="text-[10px]">Not on file</span>
                    </div>
                  )}
                  <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium text-foreground/80 backdrop-blur-sm">
                    {d.label}
                  </span>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
      )}

      {/* ── the check, in full ─────────────────────────────────────────────
          The card shows the documents at a glance; this is where they are read
          properly — larger, beside everything the check extracted. */}
      <Dialog open={checkOpen} onOpenChange={setCheckOpen}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto no-scrollbar sm:max-w-3xl"
          // Radix focuses the first focusable thing on open — here the masked
          // number, which drew a focus box round it as if it had been clicked.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // No ×: the two actions sit where it was; Esc and the backdrop close.
          showCloseButton={false}
        >
          <DialogHeader>
            <div className="flex items-center gap-3">
              <DialogTitle className="flex flex-1 items-center gap-2.5">
                Trax ID check
                <VerificationChips chips={chips} />
              </DialogTitle>
              <span className="-mt-1 flex items-center gap-1.5">
                {traxActions.onRescan && (
                  <Button size="sm" variant="outline" onClick={traxActions.onRescan} disabled={traxActions.rescanning}>
                    <RotateCw className={cn(traxActions.rescanning && "animate-spin motion-reduce:animate-none")} />
                    {traxActions.rescanning ? "Scanning…" : "Run again"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCheckOpen(false);
                    setVerifyOpen(true);
                  }}
                >
                  <Link2 />
                  New link
                </Button>
              </span>
            </div>
            <DialogDescription>
              {[
                verification?.verification_completed_at
                  ? `Completed ${fmtDate(verification.verification_completed_at)}`
                  : null,
                faceScore != null
                  ? `Face match ${Math.round(Number(faceScore) * (Number(faceScore) <= 1 ? 100 : 1))}%`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "What the customer submitted, and what was read from it."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[1.586fr_1.586fr_1fr] gap-3">
            {docSlots.map((d) => (
              <div key={d.label} className="min-w-0">
                <div
                  className={cn(
                    insetCls,
                    "relative overflow-hidden",
                    d.label === "Selfie" ? "aspect-square" : "aspect-[1.586/1]"
                  )}
                >
                  {d.url ? (
                    <BlurredImage
                      src={d.url}
                      alt={d.label}
                      containerClassName="absolute inset-0"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/50">
                      <ImageIcon className="size-4" />
                      <span className="text-[10px]">Not on file</span>
                    </div>
                  )}
                  <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium text-foreground/80 backdrop-blur-sm">
                    {d.label}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium">Read from the document</p>
            {extracted.length ? (
              <dl className={cn(listCls)}>
                {extracted.map((f) => (
                  <div key={f.label} className="flex items-center gap-4 px-5 py-3">
                    <dt className="w-40 shrink-0 text-xs text-muted-foreground">{f.label}</dt>
                    <dd className={cn("min-w-0 flex-1 truncate text-sm font-medium", f.tone)}>
                      {f.secret ? <MaskedValue value={f.value} /> : f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing was extracted from this document.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>


      {/* A new verification link for the customer. The dialog refreshes v1's
          own query key when the check lands, not this screen's — so the card
          re-reads on close. */}
      <StartVerificationDialog
        open={verifyOpen}
        onOpenChange={(open) => {
          setVerifyOpen(open);
          if (!open) void queryClient.invalidateQueries({ queryKey: ["customer-trax-id-v2", customerId] });
        }}
        customerId={customer.id}
        customerName={customer.name}
      />

      {/* ── reviews dialog ──────────────────────────────────────────────── */}
      <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto no-scrollbar sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Reviews of {customer.name}</DialogTitle>
            <DialogDescription>
              What your own staff said after each rental. Never shown to the customer, never on the booking site.
            </DialogDescription>
          </DialogHeader>
          {reviewSummary?.summary && (
            <div className={cn(insetCls, "px-5 py-4")}>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
                <span className="text-xs font-medium">Summary</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{reviewSummary.summary}</p>
              <p className="mt-3 text-[11px] text-muted-foreground">
                From all {reviewSummary.total_reviews} reviews · {fmtDate(reviewSummary.generated_at)}
              </p>
            </div>
          )}
          <div className={listCls}>
            {(reviews ?? []).map((r) => (
              <div key={r.id} className="flex gap-4 px-5 py-4">
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-2xl font-heading text-sm font-semibold",
                    ratingTone(r.rating ?? 0).tile
                  )}
                >
                  {r.rating ?? "—"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{r.comment || "No comment was left."}</p>
                  {r.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.tags.map((t) => (
                        <Pill key={t} tone="neutral">
                          {t}
                        </Pill>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {[r.reviewer?.name, fmtDate(r.created_at), r.rental?.rental_number].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

    </Panel>
  );
}

/** A sensitive value, masked to its last four characters until clicked. */
function MaskedValue({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setShown((v) => !v)}
      title={shown ? "Hide" : "Click to reveal"}
      className="block max-w-full truncate rounded-md text-left text-sm font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {shown ? value : `•••• ${value.slice(-4)}`}
    </button>
  );
}

/** A small icon button with its name in a tooltip. */
function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button fires no pointer events, so its tooltip — often
            the reason it is disabled — would never show. The span carries it. */}
        <span className="inline-flex">
          <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled} className="text-muted-foreground hover:text-foreground">
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{label}</TooltipContent>
    </Tooltip>
  );
}
