"use client";

/**
 * The Extras stage of the rental control centre — real data, real actions.
 *
 * Everything that rides along on top of the hire itself. Two things qualify on a
 * rental that already exists, and v1's detail page is the arbiter of which:
 *
 *   add-ons            `rental_extras_selections` — the child seat, the toll
 *                      pass, the prepaid fuel; a tenant-authored catalogue, not
 *                      a fixed list
 *   additional drivers `rental_additional_drivers` — a second name on the
 *                      agreement and on the insurance, each with their own ID
 *                      check and their own signature
 *
 * Deliberately NOT here, because each is another stage's whole answer: the
 * insurance policy (Insurance), the security deposit and the discount
 * (Payments), the agreement the extras get written into (Agreement). The
 * prototype's Extras tab also carried the daily rate, the deposit and an
 * internal-notes box — the first two are Payments' and the third does not exist
 * (there is no notes column on `rentals`).
 *
 * ── the two axes that make extras awkward, and are real ────────────────────
 *
 *   billing_type   per_trip | per_day    how OFTEN it is charged
 *   max_quantity   null | n              null means a toggle, not a count
 *
 * A toll pass is one flat charge you either have or you don't; a child seat is
 * $12 a day and you can have three. Both are stored per SELECTION as
 * `price_at_booking` and `billing_type_at_booking` — snapshots, so re-pricing
 * the catalogue later cannot rewrite what a signed rental was charged. This
 * screen reads the snapshot, never the live catalogue.
 *
 * ── why nothing here is editable ───────────────────────────────────────────
 *
 * `rental_extras_selections` has exactly two writers in the whole portal —
 * `rentals/new` and `rental-create-v2` — and both write once, at creation. There
 * is no path that adds an extra to a rental that already exists, because adding
 * one is not an insert: it is money owed, so it needs a ledger charge and a
 * re-issued agreement alongside. v1 shows the same list read-only, in a dialog.
 * So the button here says that plainly rather than doing nothing.
 */

import { useState } from "react";
import { differenceInDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  FileSignature,
  Loader2,
  Mail,
  Package,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UserX,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import {
  useRentalAdditionalDrivers,
  type RentalAdditionalDriver,
} from "@/hooks/use-rental-additional-drivers";
import { Button } from "@/components/ui-v2/button";
import type { StageProps } from "./stages";
import {
  insetCls,
  listCls,
  ActionButton,
  EmptyHint,
  Panel,
  Pill,
  Section,
} from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Add-ons
   ══════════════════════════════════════════════════════════════════════════ */

type ExtraSelection = {
  id: string;
  quantity: number;
  price_at_booking: number;
  billing_type_at_booking: "per_trip" | "per_day" | null;
  extra_id: string | null;
  rental_extras: { name: string | null; description: string | null } | null;
};

/**
 * The extras on THIS rental, as v1 reads them
 * (`rentals/[id]/page.tsx:1352`) — same table, same join, same
 * `.eq("rental_id", …)` and nothing else.
 *
 * There is deliberately no tenant filter, and it is not an oversight:
 * `rental_extras_selections` carries no `tenant_id` column. The rental id is the
 * scope, and the screen only ever holds a rental id it has already read under a
 * tenant-scoped query — see `use-rental-detail-v2`, which will not return
 * another tenant's rental at all.
 */
function useRentalExtraSelections(rentalId: string | null) {
  return useQuery({
    queryKey: ["rental-extra-selections-v2", rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_extras_selections")
        .select(
          "id, quantity, price_at_booking, billing_type_at_booking, extra_id, rental_extras(name, description)"
        )
        .eq("rental_id", rentalId!);

      if (error) throw error;
      return (data ?? []) as unknown as ExtraSelection[];
    },
    enabled: !!rentalId,
  });
}

/** What one line comes to across the whole hire. Mirrors v1's reducer exactly. */
const lineTotal = (s: ExtraSelection, days: number) =>
  s.quantity * Number(s.price_at_booking) * (s.billing_type_at_booking === "per_day" ? days : 1);

/* ══════════════════════════════════════════════════════════════════════════
   Additional drivers
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The two statuses a second driver carries, and they are genuinely independent:
 * a driver can be identity-verified and still not have signed, or have signed
 * and never been checked. Showing one chip for both would hide whichever is
 * behind.
 *
 * A rejected check is `destructive` — it is a real fault, not drift. `sent` and
 * `pending` are primary, not amber: on this screen amber means "out of date" and
 * nothing else, and a driver who has simply not got round to it yet is not that.
 */
function verifyPill(status: RentalAdditionalDriver["verification_status"]) {
  switch (status) {
    case "verified":
      return (
        <Pill tone="success">
          <ShieldCheck />
          ID verified
        </Pill>
      );
    case "pending":
      return (
        <Pill tone="primary">
          <Clock />
          ID in review
        </Pill>
      );
    case "rejected":
      return (
        <Pill tone="warning">
          <UserX />
          ID rejected
        </Pill>
      );
    default:
      return <Pill tone="neutral">ID not started</Pill>;
  }
}

function signPill(status: RentalAdditionalDriver["signing_status"]) {
  switch (status) {
    case "signed":
      return (
        <Pill tone="success">
          <CheckCircle2 />
          Signed
        </Pill>
      );
    case "sent":
      return (
        <Pill tone="primary">
          <Mail />
          Awaiting signature
        </Pill>
      );
    case "declined":
      return (
        <Pill tone="warning">
          <XCircle />
          Declined
        </Pill>
      );
    default:
      return (
        <Pill tone="neutral">
          <FileSignature />
          Not sent
        </Pill>
      );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

export function StageExtras({ detail }: StageProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const currency = tenant?.currency_code || "USD";

  const rental = detail.rental;
  const { data: selections, isLoading: extrasLoading } = useRentalExtraSelections(rental.id);
  const { data: drivers, isLoading: driversLoading } = useRentalAdditionalDrivers(rental.id);

  const [resending, setResending] = useState<string | null>(null);

  /**
   * The day count `per_day` extras are multiplied by.
   *
   * v1's comment on this is load-bearing and carried over: it MUST be the same
   * algorithm the charge used (`differenceInDays` on local-midnight dates),
   * because a DST spring-forward crossing makes any other day count drift from
   * what was actually stored. `detail.days` rounds instead of truncating and
   * has no floor of 1, so it is deliberately NOT used here.
   */
  const days = rental.end_date
    ? Math.max(1, differenceInDays(parseLocalDate(rental.end_date), parseLocalDate(rental.start_date)))
    : 1;

  const extras = selections ?? [];
  const extrasTotal = extras.reduce((sum, s) => sum + lineTotal(s, days), 0);

  /**
   * Resend a second driver's verification link — the same
   * `send-additional-driver-invite` call, with the same guards and the same
   * failure handling, as `components/rentals/additional-drivers-card.tsx`. The
   * v1 CARD is not embedded because it paints itself in hardcoded light-mode
   * hexes (`#f8fafc`, `bg-green-100`) that do not survive a dark theme; the
   * plumbing behind its one button is reused verbatim.
   */
  const resend = async (driver: RentalAdditionalDriver) => {
    if (!driver.email) {
      toast({
        title: "Cannot resend",
        description: "This driver has no email address on file.",
        variant: "destructive",
      });
      return;
    }
    setResending(driver.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-additional-driver-invite", {
        body: { driver_id: driver.id },
      });
      if (error) throw error;
      if (data && (data as any).success === false) {
        throw new Error((data as any).error || "Failed to send invite");
      }
      toast({ title: "Verification link sent", description: `Resent to ${driver.email}.` });
    } catch (err) {
      toast({
        title: "Couldn't send verification link",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResending(null);
    }
  };

  return (
    <Panel
      title="Extras"
      description="What rides along on top of the car — add-ons, and anyone else driving it."
      footer={
        <div className="flex flex-wrap items-center gap-3">
          {/* NOT WIRED, and shown as such rather than hidden. Adding an extra to
              a live rental is money owed: it needs a ledger charge and a
              re-issued agreement, not an INSERT. Nothing in the portal does
              that, so the affordance says so. */}
          <ActionButton
            variant="outline"
            disabled
            title="Extras are chosen when the rental is created. Adding one later is a ledger charge and a re-issued agreement, and nothing raises either yet."
          >
            <Package className="size-4" />
            Add an extra
          </ActionButton>
          <p className="text-xs text-muted-foreground">
            Extras and second drivers are set when the rental is created.
          </p>
        </div>
      }
    >
      {/* ── add-ons ──────────────────────────────────────────────────────── */}
      <Section
        title="Add-ons"
        description="Priced as they were on the day, not as the catalogue prices them today."
        right={
          extras.length > 0 ? (
            <Pill tone="neutral">
              {extras.length} item{extras.length === 1 ? "" : "s"}
            </Pill>
          ) : undefined
        }
      >
        {extrasLoading ? (
          <p className="text-sm text-muted-foreground">Reading what was added…</p>
        ) : extras.length === 0 ? (
          <EmptyHint>
            Nothing was added to this rental. Just the car, on the terms on the other stages.
          </EmptyHint>
        ) : (
          <>
            <div className={listCls}>
              {extras.map((s) => {
                const perDay = s.billing_type_at_booking === "per_day";
                return (
                  <div key={s.id} className="flex items-start gap-4 px-5 py-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary-light text-primary">
                      <Package className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {s.rental_extras?.name ?? "An extra that has since been deleted"}
                        {s.quantity > 1 && (
                          <span className="ml-1.5 text-muted-foreground">&times;{s.quantity}</span>
                        )}
                      </p>
                      {s.rental_extras?.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {s.rental_extras.description}
                        </p>
                      )}
                      {/* Written so it multiplies out left to right to the
                          figure on the right of the row — "2 × $12.00 a day ×
                          2 days" is 48, and an operator can check it without
                          knowing which factor the quantity was. */}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {s.quantity > 1 ? `${s.quantity} × ` : ""}
                        {formatCurrency(Number(s.price_at_booking), currency)}
                        {perDay ? ` a day × ${days} day${days === 1 ? "" : "s"}` : " one-off"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold">
                      {formatCurrency(lineTotal(s, days), currency)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className={cn(insetCls, "mt-3 flex items-center justify-between px-5 py-3.5")}>
              <p className="text-xs text-muted-foreground">Extras across the hire</p>
              <p className="text-sm font-semibold">{formatCurrency(extrasTotal, currency)}</p>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Extras are non-refundable. What has actually been paid against them is on the Payments stage.
            </p>
          </>
        )}
      </Section>

      {/* ── additional drivers ───────────────────────────────────────────── */}
      <Section
        title="Additional drivers"
        description="A second name on the agreement and on the cover. Each one needs their own ID check and their own signature."
        right={
          drivers && drivers.length > 0 ? (
            <Pill tone="neutral">
              {drivers.length} driver{drivers.length === 1 ? "" : "s"}
            </Pill>
          ) : undefined
        }
      >
        {driversLoading ? (
          <p className="text-sm text-muted-foreground">Reading the drivers on this rental…</p>
        ) : !drivers || drivers.length === 0 ? (
          <EmptyHint>
            {detail.customerName ?? "The customer"} is the only driver on this rental. Anyone else at the wheel
            is outside the agreement and outside the cover.
          </EmptyHint>
        ) : (
          <div className={listCls}>
            {drivers.map((d) => (
              <div key={d.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <UserPlus className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{d.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[d.email, d.phone].filter(Boolean).join(" · ") || "No contact details on file"}
                    </p>
                    {d.license_number && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Licence <span className="font-mono">{d.license_number}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {verifyPill(d.verification_status)}
                    {signPill(d.signing_status)}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 pl-[3.25rem]">
                  {/* LIVE. Mints and emails a fresh verification link through
                      `send-additional-driver-invite`. Disabled without an email
                      to send it to, and once they are already verified. */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resend(d)}
                    disabled={!d.email || resending === d.id || d.verification_status === "verified"}
                    title={
                      !d.email
                        ? "No email address on file for this driver."
                        : d.verification_status === "verified"
                          ? "Already verified."
                          : undefined
                    }
                  >
                    {resending === d.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {d.verification_status === "unverified" || d.verification_status === "rejected"
                      ? "Send ID link"
                      : "Resend ID link"}
                  </Button>
                  {d.verification_url && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={d.verification_url} target="_blank" rel="noopener noreferrer">
                        Open their link
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </Panel>
  );
}
