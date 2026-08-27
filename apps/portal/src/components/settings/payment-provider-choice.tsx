/**
 * PaymentProviderChoice — the tenant's one-time choice of payment processor.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE ADMIN PICKER
 *
 * The super admin's picker (admin app) sets a DEFAULT at company creation. This
 * one lets the operator who actually takes the money confirm or change it, once.
 * They are different audiences answering the same question, so the copy differs:
 * the admin is told what they are provisioning, the operator is told what they
 * will and will not be able to do with their own customers' cards.
 *
 * THE ONE-SHOT RULE IS ENFORCED IN THE DATABASE, NOT HERE.
 *
 * tenants_payment_provider_immutable() allows a change only while
 * payment_provider_locked_at IS NULL and the tenant holds no payments, and it
 * stamps the lock itself. This component cannot grant a second attempt even if
 * it wanted to, and a stale browser tab cannot re-open a decision that has
 * already been made. What is rendered here is a mirror of that rule, not the
 * rule.
 *
 * WHY "no payments yet" IS PART OF THE RULE
 *
 * A refund must be issued on the processor that took the charge — that is why
 * refunds route on the payment row rather than on the tenant. A tenant that
 * switched rails after collecting money would own refunds it could no longer
 * reach. The database refuses; this screen explains why before they try.
 */
"use client";

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Globe,
  Loader2,
  Lock,
  Store,
} from "lucide-react";

import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ProviderId = "stripe" | "square";

/**
 * Square's supported markets, and the reason this list is duplicated rather
 * than imported: the admin app and the portal do not share code, and
 * tenants_square_country_supported_check is the actual authority. If this list
 * drifts, the database refuses the write — the UI cannot create a tenant the
 * schema would reject.
 */
const SQUARE_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "FR", name: "France" },
  { code: "IE", name: "Ireland" },
  { code: "JP", name: "Japan" },
  { code: "ES", name: "Spain" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

const SQUARE_LIMITS = [
  "Instalment plans — a card cannot be stored for later charges",
  "Auto-extend auto-charge — renters must open a link each time",
  "Charging a saved card from the portal",
  "Deposit authorisation holds — deposits are taken as a real charge and refunded",
];

interface TenantRow {
  id: string;
  payment_provider: ProviderId;
  payment_provider_locked_at: string | null;
  country: string | null;
  currency_code: string | null;
}

export function PaymentProviderChoice({ canEdit = true }: { canEdit?: boolean }) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const [choice, setChoice] = useState<ProviderId | null>(null);
  const [country, setCountry] = useState<string>("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: row, isLoading } = useQuery({
    queryKey: ["tenant-provider-choice", tenant?.id],
    queryFn: async (): Promise<TenantRow> => {
      // Untyped for the same reason as stripe-connect-settings: the generated
      // types do not carry payment_provider_locked_at until they are regenerated.
      const { data, error } = await supabaseUntyped
        .from("tenants")
        .select("id, payment_provider, payment_provider_locked_at, country, currency_code")
        .eq("id", tenant!.id)
        .single();
      if (error) throw error;
      return data as unknown as TenantRow;
    },
    enabled: !!tenant?.id,
  });

  const { data: paymentCount } = useQuery({
    queryKey: ["tenant-provider-payment-count", tenant?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!tenant?.id,
  });

  // Seed the form from what is already stored, once.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (row && !seeded.current) {
      seeded.current = true;
      setChoice(row.payment_provider);
      setCountry(row.country ?? "");
    }
  }, [row]);

  const countrySupportsSquare = useMemo(
    () => SQUARE_COUNTRIES.some((c) => c.code === country),
    [country],
  );

  const hasPayments = (paymentCount ?? 0) > 0;

  if (isLoading || !row) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading payment settings…</span>
        </CardContent>
      </Card>
    );
  }

  // Already decided — this component's job is done. The caller renders the real
  // Stripe or Square panel underneath.
  if (row.payment_provider_locked_at) return null;

  const squareBlockedReason = hasPayments
    ? `You already have ${paymentCount} payment${paymentCount === 1 ? "" : "s"} recorded. The processor is fixed once money has been taken, because refunds must go back through the processor that took them.`
    : !country
      ? "Choose the country your business is registered in first."
      : !countrySupportsSquare
        ? `Square cannot process payments for a business registered in ${country}. It is available in ${SQUARE_COUNTRIES.map((c) => c.code).join(", ")}.`
        : null;

  const canConfirm =
    canEdit &&
    !!choice &&
    !!country &&
    !hasPayments &&
    (choice === "stripe" || (countrySupportsSquare && acknowledged));

  async function confirm() {
    if (!choice || !tenant?.id) return;
    setSaving(true);
    try {
      // locked_at is sent explicitly so that CONFIRMING THE DEFAULT also locks.
      // The trigger only fires on a change of provider, so a tenant who keeps
      // Stripe would otherwise stay unlocked forever and keep being asked.
      const { error } = await supabaseUntyped
        .from("tenants")
        .update({
          payment_provider: choice,
          country,
          payment_provider_locked_at: new Date().toISOString(),
          // ---- SQUARE INVARIANTS -------------------------------------------
          //
          // The admin's create-company path forces these four at birth. This
          // path did not, and the gap was not theoretical: a tenant who switched
          // here kept deposit_charge_enabled = false, which means "hold the
          // deposit as an authorisation". Square cannot hold. So
          // create-checkout-session computed requiresStoredCredential = true and
          // returned 409 — "this payment needs a saved card" — on EVERY booking,
          // for a tenant that had done nothing wrong.
          //
          // Square cannot vault a card from a hosted payment link, so anything
          // that charges later with nobody present is switched off, and the
          // deposit becomes an ordinary charge that is refunded afterwards.
          //
          // Applied only when choosing Square: a tenant confirming Stripe keeps
          // whatever they already had.
          ...(choice === "square"
            ? {
                deposit_charge_enabled: true,
                installments_enabled: false,
                auto_extend_enabled: false,
                payg_auto_reminders_enabled: false,
              }
            : {}),
        })
        .eq("id", tenant.id);

      if (error) throw error;

      toast.success(
        choice === "square"
          ? "Square is now your payment processor. Connect your Square account to start taking payments."
          : "Stripe is now your payment processor.",
      );
      await queryClient.invalidateQueries();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Surface the database's own words: they name the real reason (locked,
      // payments exist, unsupported country) far better than a generic string.
      toast.error(`Could not save your choice: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-amber-500" />
          Choose how you take payments
        </CardTitle>
        <CardDescription>
          This decides where your customers&apos; money goes. You can set it once — after
          you confirm, it cannot be changed.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {hasPayments && (
          <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p>{squareBlockedReason}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Country your business is registered in
          </Label>
          <Select value={country} onValueChange={setCountry} disabled={!canEdit || hasPayments}>
            <SelectTrigger>
              <SelectValue placeholder="Select a country" />
            </SelectTrigger>
            <SelectContent>
              {SQUARE_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </SelectItem>
              ))}
              <SelectItem value="OTHER">Somewhere else</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Square only operates in {SQUARE_COUNTRIES.map((c) => c.code).join(", ")}.
            Everywhere else uses Stripe.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Stripe */}
          <button
            type="button"
            disabled={!canEdit || hasPayments}
            onClick={() => { setChoice("stripe"); setAcknowledged(false); }}
            className={cn(
              "rounded-lg border p-4 text-left transition disabled:opacity-50",
              choice === "stripe" ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50",
            )}
          >
            <div className="flex items-center gap-2 font-medium">
              <CreditCard className="h-4 w-4" />
              Stripe
              {choice === "stripe" && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Every feature is available: instalments, saved cards, auto-extend and
              deposit holds.
            </p>
          </button>

          {/* Square */}
          <button
            type="button"
            disabled={!canEdit || hasPayments || !countrySupportsSquare}
            onClick={() => setChoice("square")}
            className={cn(
              "rounded-lg border p-4 text-left transition disabled:opacity-50",
              choice === "square" ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50",
            )}
          >
            <div className="flex items-center gap-2 font-medium">
              <Store className="h-4 w-4" />
              Square
              {choice === "square" && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Payment links only. Choose this if you already run your business on
              Square.
            </p>
          </button>
        </div>

        {!countrySupportsSquare && country && !hasPayments && (
          <p className="text-xs text-muted-foreground">{squareBlockedReason}</p>
        )}

        {choice === "square" && countrySupportsSquare && !hasPayments && (
          <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-sm font-medium">With Square you will not be able to:</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {SQUARE_LIMITS.map((l) => (
                <li key={l} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
            {/*
              A <label> wrapping the control, not an htmlFor pointing at it.

              The default Checkbox is `border-primary` with no fill, which on this
              amber panel rendered as an invisible 16px box: the acknowledgement
              looked like plain text, so Confirm stayed disabled with nothing on
              screen explaining why. Wrapping makes the whole row the hit target
              and the border is forced to a colour that reads against this panel.
            */}
            <label className="flex cursor-pointer items-start gap-3 pt-1">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                className="mt-0.5 h-5 w-5 border-2 border-amber-500 data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500 data-[state=checked]:text-black"
              />
              <span className="text-sm leading-snug">
                I understand these features will not be available, and that this choice
                is permanent.
              </span>
            </label>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 border-t pt-4">
          {/* A disabled button with no reason next to it is the same dead end as
              the invisible checkbox was. Name the missing step. */}
          <p className="text-xs text-muted-foreground">
            {!country
              ? "Choose your country to continue."
              : choice === "square" && !acknowledged
                ? "Tick the box above to continue."
                : "You will not be asked again."}
          </p>
          <Button onClick={confirm} disabled={!canConfirm || saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>Confirm {choice === "square" ? "Square" : "Stripe"}</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default PaymentProviderChoice;
