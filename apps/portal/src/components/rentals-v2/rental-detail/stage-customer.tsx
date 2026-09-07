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
 * The question the stage has to answer, in one screenful, is:
 *
 *     who is this person, and are they safe to hand a car to?
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldAlert,
  IdCard,
  Sparkles,
  Send,
  Ban,
  ExternalLink,
  Image as ImageIcon,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { isAreaHidden } from "@/lib/lean-areas";
import { formatVerificationProvider } from "@/lib/verification-provider";
import { BlurredImage } from "@/components/ui/blurred-image";
import { Button } from "@/components/ui-v2/button";
import { Badge } from "@/components/ui-v2/badge";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { useCustomerReviewSummary } from "@/hooks/use-customer-review-summary";
// The two verification dialogs are v1 components, and they are reused as they
// stand rather than re-skinned. They are the ONLY working route to a Sumsub/AI
// session and to a CheckMyDriver link; a v2 copy would be a second call-site
// for `create-ai-verification-session` that has to be kept in step with the
// first. A modal in the v1 grammar over a v2 screen is the cheaper mismatch.
import { StartVerificationDialog } from "@/components/customers/start-verification-dialog";
import { StartCmdVerificationDialog } from "@/components/customers/start-cmd-verification-dialog";
import { useCmdVerification } from "@/hooks/use-cmd-verification";
import type { StageProps } from "./stages";
import {
  fmtDate,
  fmtDateTime,
  initials,
  insetCls,
  listCls,
  ActionButton,
  EmptyHint,
  Panel,
  Pill,
  Section,
  StatBlock,
  Surface,
  Timeline,
} from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Verification — reading the real rows
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The six states an identity check can be in.
 *
 * `manual` is not a shortcut — it is `customers.identity_verification_status =
 * 'manually_verified'`, which is what an operator who has held the licence in
 * their hand actually records, and which nothing else may overwrite.
 */
type VerificationState = "not_started" | "link_sent" | "in_review" | "verified" | "manual" | "failed";

/** How far down the verification timeline a state sits. */
const VERIFY_RANK: Record<VerificationState, number> = {
  not_started: 0,
  link_sent: 1,
  in_review: 2,
  verified: 3,
  manual: 3,
  failed: 3,
};

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
    queryKey: ["customer-identity-verification", customerId, customerEmail, tenant?.id],
    queryFn: async () => {
      if (!customerId) return null;

      const { data, error } = await supabase
        .from("identity_verifications")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) console.error("Error fetching identity verification:", error);
      if (data) return data as Record<string, any>;

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
 * The row(s) → one state.
 *
 * `manually_verified` on the customer wins outright: it is an operator's
 * explicit word, and it outranks a machine that has not finished or did not
 * agree. After that the verification row decides, and the order matters —
 * a RED result is a decision, a missing result is not.
 */
function deriveVerificationState(
  verification: Record<string, any> | null | undefined,
  customerStatus: string | null | undefined
): VerificationState {
  if (customerStatus === "manually_verified") return "manual";

  if (verification) {
    const result = String(verification.review_result ?? "").toUpperCase();
    if (result === "GREEN") return "verified";
    if (result === "RED") return "failed";

    // Documents are in but no verdict yet.
    if (verification.document_front_url || verification.selfie_image_url || verification.face_image_url) {
      return "in_review";
    }
    // A session exists and the customer has not opened it, or is mid-way.
    return "link_sent";
  }

  if (customerStatus === "verified") return "verified";
  if (customerStatus === "rejected") return "failed";
  if (customerStatus === "pending") return "in_review";
  return "not_started";
}

function VerifyChip({ state }: { state: VerificationState }) {
  if (state === "failed") {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <ShieldAlert />
        ID check failed
      </Badge>
    );
  }
  const map = {
    not_started: { tone: "neutral" as const, label: "ID not verified", icon: false },
    link_sent: { tone: "primary" as const, label: "ID link sent", icon: false },
    in_review: { tone: "primary" as const, label: "ID in review", icon: false },
    verified: { tone: "success" as const, label: "ID verified", icon: true },
    manual: { tone: "success" as const, label: "Verified in person", icon: true },
  }[state];
  return (
    <Pill tone={map.tone}>
      {map.icon && <ShieldCheck />}
      {map.label}
    </Pill>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   History
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * How many rentals this customer has had with this tenant.
 *
 * `head: true` — the number is the whole answer, so no row is transferred. The
 * count is deliberately of ALL their rentals including this one; "3 rentals"
 * next to a name means what an operator means by it.
 */
function useCustomerRentalCount(customerId: string | null) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-rental-count-v2", tenant?.id, customerId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("rentals")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId!)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!customerId && !!tenant?.id,
  });
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
  fair: { text: "text-primary", bar: "bg-primary", tile: "bg-primary-light text-primary" },
  poor: { text: "text-destructive", bar: "bg-destructive", tile: "bg-destructive-light text-destructive" },
} as const;

const ratingTone = (n: number) => (n >= 8 ? RATING_TONE.good : n >= 5 ? RATING_TONE.fair : RATING_TONE.poor);

/** Give a vendor's message a full stop so the sentence after it reads as one. */
const endStop = (s: string | null | undefined) => {
  const t = s?.trim();
  if (!t) return null;
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

export function StageCustomer({ detail }: StageProps) {
  const { tenantSlug } = useTenant();
  const customer = detail.customer;
  const customerId = customer?.id ?? null;

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  const { data: verification, isLoading: verificationLoading } = useCustomerVerification(
    customerId,
    customer?.email ?? null
  );
  const { data: rentalCount } = useCustomerRentalCount(customerId);
  const { data: reviews } = useCustomerReviews(customerId ?? undefined);
  const { data: reviewSummary } = useCustomerReviewSummary(customerId ?? undefined);

  // CheckMyDriver is hidden from lean tenants, and the hook gates its own query
  // on that — so an undefined row here means either "not offered" or "not
  // started", and only `cmdHidden` tells the two apart.
  const cmdHidden = isAreaHidden("cmd", tenantSlug);
  const { data: cmd } = useCmdVerification(customerId ?? undefined);

  const state = deriveVerificationState(verification, customer?.identity_verification_status);
  const rank = VERIFY_RANK[state];

  const average = useMemo(() => {
    if (reviewSummary?.average_rating != null) return Number(reviewSummary.average_rating);
    if (!reviews?.length) return null;
    const rated = reviews.filter((r) => r.rating != null);
    if (!rated.length) return null;
    return rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length;
  }, [reviewSummary, reviews]);

  const tone = average === null ? null : ratingTone(average);

  const tagCounts = useMemo(() => {
    const counted = new Map<string, number>();
    (reviews ?? []).forEach((r) => r.tags.forEach((t) => counted.set(t, (counted.get(t) ?? 0) + 1)));
    return [...counted.entries()].sort((a, b) => b[1] - a[1]);
  }, [reviews]);

  /* A rental with no customer row is a broken record, not an empty state — it
     should not happen (the FK is set on creation) but it is cheap to say so
     plainly rather than render a screen full of dashes. */
  if (!customer) {
    return (
      <Panel title="Customer" description="Who is renting.">
        <EmptyHint>
          This rental has no customer attached to it. Nothing on this screen can be addressed to anybody until one
          is — open it in the rentals list and set a customer.
        </EmptyHint>
      </Panel>
    );
  }

  const firstName = customer.name.split(" ")[0] || "the customer";

  const verifyTile =
    state === "failed"
      ? "bg-destructive-light text-destructive"
      : state === "verified" || state === "manual"
        ? "bg-success-light text-success"
        : state === "not_started"
          ? "bg-muted text-muted-foreground"
          : "bg-primary-light text-primary";

  const verifyHeadline = {
    not_started: "Not verified",
    link_sent: "Link sent, waiting on them",
    in_review: "Documents in, check running",
    verified: "Identity confirmed",
    manual: "Verified in person",
    failed: "The check did not pass",
  }[state];

  const completedAt = verification?.verification_completed_at
    ? fmtDateTime(verification.verification_completed_at)
    : null;
  const startedAt = verification?.created_at ? fmtDateTime(verification.created_at) : null;
  const provider = verification?.verification_provider ?? verification?.provider ?? null;

  const verifyBlurb = {
    not_started: `Nothing has been checked. Send ${firstName} a link and they photograph their licence and their own face.`,
    link_sent: `A check was started${startedAt ? ` ${startedAt}` : ""}${
      provider ? ` via ${formatVerificationProvider(provider)}` : ""
    }. Nothing to do until they submit their documents.`,
    in_review: `${firstName} submitted their documents. The result usually lands within a minute.`,
    verified: `Passed${completedAt ? ` ${completedAt}` : ""}${
      provider ? ` via ${formatVerificationProvider(provider)}` : ""
    }.`,
    manual: "An operator confirmed the licence face to face. No document is on file, so this one rests on your word.",
    // The reason is a provider's own string and arrives with or without a full
    // stop — "OCR extraction failed" as often as "The selfie did not match."
    // Without this the two sentences run into each other mid-line.
    failed: `${endStop(verification?.rejection_reason) ?? "The document did not match."} Nothing here blocks the rental — but it goes out with no verified identity behind it.`,
  }[state];

  const verifySteps =
    state === "manual"
      ? [{ label: "Confirmed in person by an operator", done: true }]
      : [
          { label: "Verification started", at: startedAt ?? undefined, done: rank >= 1 },
          { label: "Licence and selfie submitted", done: rank >= 2 },
          {
            label: state === "failed" ? "Check failed" : "Identity confirmed",
            at: completedAt ?? undefined,
            done: rank >= 3,
          },
        ];

  const images = [
    { url: verification?.document_front_url, label: "Licence front" },
    { url: verification?.document_back_url, label: "Licence back" },
    { url: verification?.selfie_image_url ?? verification?.face_image_url, label: "Selfie" },
  ].filter((i) => !!i.url) as { url: string; label: string }[];

  const faceScore = verification?.ai_face_match_score;

  const licenceValue = cmd?.cmd_license_status ?? (customer.license_number ? "On file" : "—");
  const licenceHint = customer.license_number
    ? [customer.license_number, customer.license_state].filter(Boolean).join(" · ")
    : verification?.document_expiry_date
      ? `Expires ${fmtDate(verification.document_expiry_date)}`
      : "No licence recorded";

  return (
    <Panel
      title="Customer"
      description="Who is renting. Everything else on this rental is addressed to them."
    >
      {/* ── who ─────────────────────────────────────────────────────────── */}
      <Surface>
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-3xl bg-primary-light font-heading text-sm font-semibold text-primary">
            {initials(customer.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-lg font-semibold tracking-tight">{customer.name}</h3>
              <VerifyChip state={state} />
              {customer.is_blocked && (
                <Badge variant="destructive" className="gap-1.5">
                  <Ban />
                  Blocked
                </Badge>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details on file"}
            </p>
            {customer.created_at && (
              <p className="mt-0.5 text-xs text-muted-foreground">Customer since {fmtDate(customer.created_at)}</p>
            )}
          </div>
          {/* The one navigation off this stage. The customer's own page is where
              you edit them, block them, or read their whole file; this stage
              answers a question about THIS rental and hands off for the rest. */}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/customers/${customer.id}`}>
              <ExternalLink />
              Open profile
            </Link>
          </Button>
        </div>

        {customer.is_blocked && (
          <div className="mt-5 rounded-3xl bg-destructive-light px-5 py-4 ring-1 ring-destructive/20">
            <p className="text-sm font-medium text-destructive">This customer is blocked.</p>
            <p className="mt-1 text-xs text-destructive/80">
              {customer.blocked_reason || "No reason was recorded."} Unblocking is done from their profile.
            </p>
          </div>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <StatBlock
            label="Rentals"
            value={rentalCount === undefined ? "—" : String(rentalCount)}
            hint={rentalCount === 1 ? "This one is their first" : "With you, including this one"}
          />
          <StatBlock
            label="Staff rating"
            value={average === null ? "—" : `${average.toFixed(1)} / 10`}
            hint={
              !reviews?.length
                ? "No reviews yet"
                : `${reviews.length} review${reviews.length === 1 ? "" : "s"}`
            }
            tone={tone?.text}
          />
          <StatBlock label="Licence" value={licenceValue} hint={licenceHint} />
        </div>
      </Surface>

      {/* ── verification ────────────────────────────────────────────────── */}
      <Section
        title="Verification"
        description="Whether the person collecting the car is who they say they are."
        right={<VerifyChip state={state} />}
      >
        <div className="flex items-start gap-4">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-3xl", verifyTile)}>
            {state === "failed" ? <ShieldAlert className="size-5" /> : <ShieldCheck className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-semibold">{verifyHeadline}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {verificationLoading ? "Reading the latest check…" : verifyBlurb}
            </p>
          </div>
        </div>

        {images.length > 0 && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {images.map((img) => (
                <div key={img.label} className={cn(insetCls, "p-3")}>
                  {/* Blurred by default and revealed on click — the same
                      component v1 uses. These are somebody's licence and face;
                      they should not be readable over a shoulder by default. */}
                  <BlurredImage
                    src={img.url}
                    alt={img.label}
                    containerClassName="h-16 overflow-hidden rounded-2xl bg-muted"
                  />
                  <p className="mt-2 text-[11px] text-muted-foreground">{img.label}</p>
                </div>
              ))}
            </div>
            {faceScore != null && (
              <p
                className={cn(
                  "mt-3 flex items-center gap-1.5 text-xs",
                  state === "verified" ? "text-success" : state === "failed" ? "text-destructive" : "text-muted-foreground"
                )}
              >
                <IdCard className="size-3.5" />
                Face match {Math.round(Number(faceScore) * (Number(faceScore) <= 1 ? 100 : 1))}% against the licence
                photo.
              </p>
            )}
          </>
        )}

        {/* An empty state that is honest about being empty, rather than three
            grey rectangles pretending documents exist. */}
        {images.length === 0 && rank >= 2 && (
          <div className={cn(insetCls, "mt-5 flex items-center gap-3 px-5 py-4")}>
            <ImageIcon className="size-4 shrink-0 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              No document images have been fetched for this check yet.
            </p>
          </div>
        )}

        <div className="mt-6">
          <Timeline steps={verifySteps} />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {/* LIVE. Creates a `create-ai-verification-session` and shows the QR
              plus a copyable link — the same dialog the customers page uses. */}
          <ActionButton onClick={() => setVerifyOpen(true)}>
            <Send className="size-4" />
            {rank === 0 ? "Send verification link" : "Start a new check"}
          </ActionButton>

          {/* LIVE, and only where CheckMyDriver is offered. The dialog collects
              the US address CMD requires and sends the magic link by the
              channels chosen. */}
          {!cmdHidden && (
            <ActionButton variant="outline" onClick={() => setCmdOpen(true)}>
              <IdCard className="size-4" />
              {cmd ? "Resend licence check" : "Check their licence"}
            </ActionButton>
          )}

          {/* NOT WIRED, and deliberately shown as such rather than hidden.
              `GenerateInviteDialog` exists and works, but the edge function
              behind it (`create-customer-invite`) takes only `{ tenantId,
              tenantSlug }` — there is no customer parameter, so the link it
              mints is a blank registration link for anybody, not one addressed
              to this rental's customer. Offering it here would produce a link
              that creates a SECOND customer record. Enabling it is an edge
              function change, not a UI one. */}
          <ActionButton
            variant="outline"
            disabled
            title="The registration link is tenant-wide — create-customer-invite takes no customer, so it cannot be addressed to this rental's customer yet."
          >
            <Link2 className="size-4" />
            Send a details link
          </ActionButton>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          &ldquo;Verified in person&rdquo; is recorded on the customer&rsquo;s own profile, so that it carries the
          name of whoever vouched.
        </p>
      </Section>

      {/* ── reviews ─────────────────────────────────────────────────────── */}
      {!reviews?.length ? (
        <Section title="Reviews" description="What your own staff said after each rental. Never shown to the customer.">
          <EmptyHint>
            Nobody has rated {firstName} yet. This rental would be the first — and the one that starts the average.
          </EmptyHint>
        </Section>
      ) : (
        <>
          <Section
            title="Reviews"
            description="What your own staff said after each rental. Never shown to the customer, never on the booking site."
            right={
              <Pill tone="neutral">
                {reviews.length} review{reviews.length === 1 ? "" : "s"}
              </Pill>
            }
          >
            <div className="flex items-end gap-4">
              <p className={cn("font-heading text-4xl font-semibold leading-none tracking-tight", tone?.text)}>
                {average?.toFixed(1) ?? "—"}
              </p>
              <div className="min-w-0 flex-1 pb-1">
                <p className="text-xs text-muted-foreground">
                  out of 10, across {reviews.length} rental{reviews.length === 1 ? "" : "s"}
                </p>
                <span className="mt-2 flex gap-1">
                  {Array.from({ length: 10 }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full",
                        average !== null && i < Math.round(average) ? tone?.bar : "bg-foreground/10"
                      )}
                    />
                  ))}
                </span>
              </div>
            </div>

            {tagCounts.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {tagCounts.map(([tag, n]) => (
                  <Pill key={tag} tone="neutral">
                    {tag}
                    {n > 1 ? ` ×${n}` : ""}
                  </Pill>
                ))}
              </div>
            )}

            {reviewSummary?.summary ? (
              <div className={cn(insetCls, "mt-5 px-5 py-4")}>
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="text-xs font-medium">Summary</span>
                  <Pill tone="primary">Written for you</Pill>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{reviewSummary.summary}</p>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  From all {reviewSummary.total_reviews} reviews · {fmtDate(reviewSummary.generated_at)}
                </p>
              </div>
            ) : (
              <p className="mt-5 text-xs text-muted-foreground">
                Too few reviews to summarise yet — read them below.
              </p>
            )}
          </Section>

          <Section title="Every review">
            <div className={listCls}>
              {reviews.map((r) => (
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
                      {[r.reviewer?.name, fmtDate(r.created_at), r.rental?.rental_number]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      {/* ── the reused v1 dialogs ───────────────────────────────────────── */}
      <StartVerificationDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        customerId={customer.id}
        customerName={customer.name}
      />
      {!cmdHidden && (
        <StartCmdVerificationDialog
          open={cmdOpen}
          onOpenChange={setCmdOpen}
          customerId={customer.id}
          customer={{
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            date_of_birth: customer.date_of_birth,
          }}
        />
      )}
    </Panel>
  );
}
