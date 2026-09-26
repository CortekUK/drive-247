"use client";

/**
 * Where the balance work sits — canary only.
 *
 *   CustomerBalanceSection   the v2 customer record's Money section: "Owes you
 *                            $X" first (spec §8, "how much does this customer
 *                            owe me"), Adjust balance, Request a payment, and
 *                            every manual change with who/when/why and Undo.
 *   RentalBalanceSection     the v2 rental's Payments stage: Adjust balance for
 *                            this rental, and its changes.
 *
 * Both are mounted only when `useV2("finances")` is on (the placements check it
 * — section-money.tsx and stage-payments.tsx), so every other tenant renders
 * exactly what it did before. The header's figure is the SHARED reducer's
 * answer (lib/finances/balance.ts via useCustomerBalanceWithStatus), so this
 * screen, the v1 customer page and Finances cannot disagree about it.
 */

import { useMemo, useState } from "react";
import { Banknote, Scale, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useCustomerBalanceWithStatus } from "@/hooks/use-customer-balance";
import { useBalanceAdjustments } from "@/hooks/use-balance-adjustments";
import { CollectPaymentDialog } from "@/components/customers/collect-payment-dialog";
import { AdjustBalanceDialog, type BalanceRentalOption } from "./adjust-balance-dialog";
import { AdjustmentHistory } from "./adjustment-history";
import { RequestPaymentDialog } from "./request-payment-dialog";
import { balanceWords, centsOf, formatCents, netCentsFromStatus } from "./balance-words";
import { Callout, surfaceCls } from "./balance-kit";

const NOT_APPLIED =
  "Balance adjustments switch on once the database update for them is applied. Nothing can be changed from here yet.";

/* ══════════════════════════════════════════════════════════════════════════
   The header — the shared reducer's number, in words
   ══════════════════════════════════════════════════════════════════════════ */

export function CustomerBalanceHeader({
  customerId,
  currency,
  actions,
}: {
  customerId: string;
  currency: string;
  actions?: React.ReactNode;
}) {
  const { data, isLoading, error } = useCustomerBalanceWithStatus(customerId);
  const net = netCentsFromStatus(data as any);
  const words = net === null ? null : balanceWords(net, currency);
  const outstanding = data ? centsOf((data as any).outstandingDebt) : 0;
  const credit = data ? centsOf((data as any).availableCredit) : 0;

  return (
    <div
      className={cn(surfaceCls, "p-6", words?.tone === "owes" && "bg-primary-light/50 ring-primary/30")}
      data-testid="balance-header"
      data-net-cents={net ?? ""}
      data-tour="customer-balance-header"
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Balance</p>
      <p
        className={cn(
          "mt-1 font-heading text-3xl font-semibold tracking-tight tabular-nums",
          words?.tone === "owes" ? "text-primary" : words?.tone === "credit" ? "text-success" : "text-foreground",
        )}
      >
        {error ? "Could not read the balance" : isLoading || !words ? "…" : words.headline}
      </p>
      {words && words.tone !== "settled" && (outstanding !== 0 || credit !== 0) && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {formatCents(outstanding, currency)} on charges
          {credit > 0 ? ` · ${formatCents(credit, currency)} paid in and not yet applied` : ""}
        </p>
      )}
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The customer
   ══════════════════════════════════════════════════════════════════════════ */

export interface CustomerRentalLite {
  id: string;
  ref: string;
  vehicle?: string | null;
  reg?: string | null;
  status?: string | null;
}

export function rentalOptionsFor(rentals: CustomerRentalLite[]): BalanceRentalOption[] {
  return rentals.map((r) => ({
    id: r.id,
    label: [r.ref, r.vehicle || r.reg].filter(Boolean).join(" · "),
    refusal:
      r.status === "Cancelled"
        ? "This rental is cancelled, so its charges no longer count toward the balance. Use the customer account."
        : null,
  }));
}

export function CustomerBalanceSection({
  customerId,
  customerName,
  rentals,
  currency,
}: {
  customerId: string;
  customerName?: string | null;
  rentals: CustomerRentalLite[];
  currency: string;
}) {
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const mayEdit = canEdit("payments");
  const history = useBalanceAdjustments({ customerId });
  const options = useMemo(() => rentalOptionsFor(rentals), [rentals]);
  const labelOf = useMemo(() => {
    const m = new Map(options.map((o) => [o.id, o.label]));
    return (id: string) => m.get(id) ?? null;
  }, [options]);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [collect, setCollect] = useState<{ amountCents: number; forWhat?: string } | null>(null);
  const live = history.available === true;
  // The same query the header draws from (one fetch, one cache entry).
  const { data: position } = useCustomerBalanceWithStatus(customerId);
  const owedCents = Math.max(0, netCentsFromStatus(position as any) ?? 0);

  return (
    <div className="space-y-4" data-testid="customer-balance-section">
      <CustomerBalanceHeader
        customerId={customerId}
        currency={currency}
        actions={
          mayEdit ? (
            <>
              <Button size="sm" onClick={() => setAdjustOpen(true)} disabled={!live} data-tour="customer-adjust-balance">
                <Scale className="size-4" />
                Adjust balance
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)} disabled={!live}>
                <Send className="size-4" />
                Request a payment
              </Button>
              {/* What the classic Money section offered: collect what is already
                  owed, with no new charge. Works before the migration too. */}
              {owedCents > 0 && (
                <Button size="sm" variant="outline" data-tour="customer-money-collect" onClick={() => setCollect({ amountCents: owedCents })}>
                  <Banknote className="size-4" />
                  Collect {formatCents(owedCents, currency)}
                </Button>
              )}
            </>
          ) : null
        }
      />

      {history.available === false && <Callout>{NOT_APPLIED}</Callout>}

      {live && (
        <div className={cn(surfaceCls, "p-6")}>
          <h3 className="font-heading text-sm font-semibold">Changes to the balance</h3>
          <p className="mt-1 mb-4 text-xs leading-relaxed text-muted-foreground">
            Every manual change, with who made it, when and why. Undo adds an opposite entry; nothing is removed.
          </p>
          <AdjustmentHistory
            customerId={customerId}
            entries={history.entries}
            unrecorded={history.unrecorded}
            currency={currency}
            canEdit={mayEdit}
            rentalLabel={labelOf}
          />
        </div>
      )}
      {history.error && <Callout tone="destructive">The history would not load. {history.error.message}</Callout>}

      <AdjustBalanceDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        customerId={customerId}
        customerName={customerName}
        rentals={options}
        currency={currency}
        timeZone={(tenant as any)?.timezone ?? null}
      />
      <RequestPaymentDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        customerId={customerId}
        customerName={customerName}
        rentals={options}
        currency={currency}
        onRequested={(req) => setCollect(req)}
      />
      {/* The existing link flow, opened for the amount just charged. */}
      <CollectPaymentDialog
        open={!!collect}
        onOpenChange={(o) => {
          if (!o) setCollect(null);
        }}
        customerId={customerId}
        defaultAmount={collect ? collect.amountCents / 100 : undefined}
        description={collect?.forWhat}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The rental
   ══════════════════════════════════════════════════════════════════════════ */

/** Why a correction or goodwill cannot go on this rental — the same rule the SQL function enforces. */
export function rentalRefusalFor(r: { status?: string | null; approval_status?: string | null; is_pay_as_you_go?: boolean | null }): string | null {
  if (r.status === "Cancelled" || r.approval_status === "rejected") {
    return "This rental is cancelled, so its charges no longer count toward the balance. Adjust the customer account instead.";
  }
  if (r.is_pay_as_you_go === true) {
    return "This rental is billed day by day, so its balance comes from the daily bills. Adjust the customer account instead.";
  }
  return null;
}

export function RentalBalanceSection({
  rental,
  customerName,
  currency: currencyProp,
  onChanged,
}: {
  rental: {
    id: string;
    customer_id?: string | null;
    vehicle_id?: string | null;
    status?: string | null;
    approval_status?: string | null;
    is_pay_as_you_go?: boolean | null;
    rental_number?: string | null;
  };
  customerName?: string | null;
  /** Defaults to the tenant's currency. */
  currency?: string;
  onChanged?: () => void;
}) {
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const mayEdit = canEdit("payments");
  const currency = currencyProp || (tenant as any)?.currency_code || "USD";
  const customerId = rental.customer_id ?? "";
  const history = useBalanceAdjustments(customerId ? { customerId, rentalId: rental.id } : null);
  const [open, setOpen] = useState(false);
  const live = history.available === true;

  const option: BalanceRentalOption = {
    id: rental.id,
    label: rental.rental_number ? `rental ${rental.rental_number}` : "this rental",
    vehicleId: rental.vehicle_id ?? null,
    refusal: rentalRefusalFor(rental),
  };

  if (!customerId) return null;

  return (
    <div className={cn(surfaceCls, "p-6")} data-testid="rental-balance-section">
      <div className="mb-4 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-sm font-semibold">Balance adjustments</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A charge that was wrong, money received outside the platform, or goodwill — each kept with who, when and why.
          </p>
        </div>
        {mayEdit && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!live} data-tour="rental-adjust-balance">
            <Scale className="size-4" />
            Adjust balance
          </Button>
        )}
      </div>

      {history.available === false ? (
        <Callout>{NOT_APPLIED}</Callout>
      ) : history.error ? (
        <Callout tone="destructive">The history would not load. {history.error.message}</Callout>
      ) : (
        <AdjustmentHistory
          customerId={customerId}
          entries={history.entries}
          unrecorded={history.unrecorded}
          currency={currency}
          canEdit={mayEdit}
        />
      )}

      <AdjustBalanceDialog
        open={open}
        onOpenChange={setOpen}
        customerId={customerId}
        customerName={customerName}
        rental={option}
        currency={currency}
        timeZone={(tenant as any)?.timezone ?? null}
        onDone={onChanged}
      />
    </div>
  );
}
