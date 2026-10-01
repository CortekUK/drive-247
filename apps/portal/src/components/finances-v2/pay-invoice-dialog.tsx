"use client";

/**
 * Pay an invoice — one white screen: WHAT to pay on top, HOW underneath.
 *
 *   What to pay     every unpaid line, ticked, with its full remaining amount
 *                   in "Paying". Untick to leave a line; type less to pay part
 *                   of it (never more than it has remaining).
 *   How             Charge card on file   · the saved card, charged now
 *                   Send a payment link   · by email and/or SMS; pending until paid
 *                   Record a manual payment · cash, transfer, Zelle… with a date
 *
 * The button says exactly what will happen: "Charge $208.00 to Visa •••• 4242",
 * "Send link for $208.00", "Record $208.00 cash". Every ticked line becomes an
 * allocation to that exact line.
 */

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ListStatusText } from "@/components/shared/list-table-v2";
import {
  EPS,
  billedOf,
  creditedOf,
  dueState,
  invoiceTotals,
  type FinanceIndex,
  type FinanceInvoice,
} from "./finance-data";
import { CUSTOMER_CONTACT, SAVED_CARDS, payLines } from "./finance-mock";
import { DateField } from "./date-field";

type Row = { chargeId: string; label: string; remaining: number; pending: number; checked: boolean; paying: string };
type How = "card" | "link" | "manual";

const MANUAL_METHODS = ["Cash", "Bank transfer", "Zelle", "Card (in person)", "Cheque", "Other"];
const TODAY = "2026-09-28";

export function PayInvoiceDialog({
  invoice,
  index,
  currencyCode,
  onlyChargeId,
  onOpenChange,
}: {
  invoice: FinanceInvoice | null;
  index: FinanceIndex;
  currencyCode: string;
  /** Open with only this line ticked (from a line's "+ Add payment"). */
  onlyChargeId?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const money = (n: number) => formatCurrency(n, currencyCode);
  const [rows, setRows] = useState<Row[]>([]);
  const [how, setHow] = useState<How>("manual");
  const [via, setVia] = useState<{ email: boolean; sms: boolean }>({ email: true, sms: false });
  const [manualMethod, setManualMethod] = useState("Cash");
  const [manualDate, setManualDate] = useState(TODAY);
  const [reference, setReference] = useState("");

  const card = invoice ? SAVED_CARDS[invoice.customer_id ?? ""] : undefined;
  const contact = invoice ? CUSTOMER_CONTACT[invoice.customer_id ?? ""] : undefined;

  // Fresh rows each time it opens: every line still owing money, ticked.
  useEffect(() => {
    if (!invoice) return;
    const { charges } = invoiceTotals(invoice, index);
    setRows(
      charges
        .map((c) => {
          const remaining = Math.max(0, Number(c.remaining_amount ?? billedOf(c, index) - creditedOf(c, index)));
          // Held by a payment link that has not been paid yet.
          const pending = (index.allocsByCharge.get(c.id) ?? []).reduce((s, a) => {
            const p = index.paymentById.get(a.payment_id);
            return s + (p?.status === "Pending" ? Number(a.amount_applied || 0) : 0);
          }, 0);
          const ticked = onlyChargeId ? c.id === onlyChargeId : true;
          return {
            chargeId: c.id,
            label: c.category ?? "Line",
            remaining,
            pending,
            checked: ticked && remaining > EPS,
            paying: remaining.toFixed(2),
          };
        })
        .filter((r) => r.remaining > EPS),
    );
    setHow(card ? "card" : "manual");
    setVia({ email: true, sms: false });
    setManualMethod("Cash");
    setManualDate(TODAY);
    setReference("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, onlyChargeId]);

  const chosen = useMemo(
    () =>
      rows
        .filter((r) => r.checked)
        .map((r) => ({ ...r, value: Math.min(Number(r.paying) || 0, r.remaining) }))
        .filter((r) => r.value > EPS),
    [rows],
  );
  const total = Math.round(chosen.reduce((s, r) => s + r.value, 0) * 100) / 100;

  if (!invoice) return <Dialog open={false} onOpenChange={onOpenChange} />;

  const { charges, owes } = invoiceTotals(invoice, index);
  const due = dueState(invoice, charges, owes);
  const allTicked = rows.length > 0 && rows.every((r) => r.checked);
  const canPay =
    total > EPS &&
    (how !== "card" || !!card) &&
    (how !== "link" || via.email || via.sms) &&
    (how !== "manual" || !!manualDate);

  const cta =
    how === "card" && card
      ? `Charge ${money(total)} to ${card.brand} •••• ${card.last4}`
      : how === "link"
        ? `Send link for ${money(total)}`
        : `Record ${money(total)} ${manualMethod.toLowerCase()}`;

  const pay = () => {
    payLines(
      invoice.id,
      chosen.map((r) => ({ chargeId: r.chargeId, amount: r.value })),
      how === "card"
        ? { kind: "card" }
        : how === "link"
          ? { kind: "link", via: [...(via.email ? ["email" as const] : []), ...(via.sms ? ["sms" as const] : [])] }
          : { kind: "manual", method: manualMethod, date: manualDate, reference: reference.trim() || undefined },
    );
    toast({
      title:
        how === "card" ? "Card charged" : how === "link" ? "Payment link sent" : "Payment recorded",
      description:
        how === "link"
          ? `${money(total)} · waiting for ${invoice.customers?.name ?? "the customer"} to pay.`
          : `${money(total)} on ${invoice.invoice_number}.`,
    });
    onOpenChange(false);
  };

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-2xl dark:bg-card">
        {/* Header */}
        <div className="px-8 pb-4 pt-7">
          <DialogTitle className="text-xl font-semibold">Pay {invoice.invoice_number}</DialogTitle>
          <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-2">
            <span>{invoice.customers?.name}</span>
            {invoice.entity_ref && <span>· {invoice.entity_ref}</span>}
            {due && (
              <>
                <span>·</span>
                <ListStatusText tone={due.tone}>{due.label}</ListStatusText>
              </>
            )}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 divide-y overflow-y-auto px-8">
          {/* What to pay */}
          <section className="py-5">
            <div className="grid grid-cols-[24px_minmax(0,1fr)_110px_130px] items-center gap-3 border-b pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <input
                type="checkbox"
                aria-label="Select all lines"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={allTicked}
                onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, checked: e.target.checked })))}
              />
              <span>What to pay</span>
              <span className="text-right">Remaining</span>
              <span className="text-right">Paying</span>
            </div>
            {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nothing left to pay on this invoice.</p>}
            {rows.map((r, i) => (
              <div
                key={r.chargeId}
                className={cn(
                  "grid grid-cols-[24px_minmax(0,1fr)_110px_130px] items-center gap-3 border-b py-2 text-sm",
                  !r.checked && "text-muted-foreground",
                )}
              >
                <input
                  type="checkbox"
                  aria-label={`Pay ${r.label}`}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={r.checked}
                  onChange={(e) => setRow(i, { checked: e.target.checked })}
                />
                <span className="min-w-0 truncate">
                  {r.label}
                  {r.pending > EPS && (
                    <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                      link out for {money(r.pending)}
                    </span>
                  )}
                </span>
                <span className="text-right tabular-nums text-muted-foreground">{money(r.remaining)}</span>
                <Input
                  className="h-8 text-right tabular-nums"
                  inputMode="decimal"
                  disabled={!r.checked}
                  value={r.paying}
                  onChange={(e) => setRow(i, { paying: e.target.value.replace(/[^0-9.]/g, "") })}
                  onBlur={() => {
                    const v = Math.min(Number(r.paying) || 0, r.remaining);
                    setRow(i, { paying: v.toFixed(2) });
                  }}
                />
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-3 text-sm">
              <span className="text-muted-foreground">
                {chosen.length} of {rows.length} {rows.length === 1 ? "line" : "lines"}
              </span>
              <span>
                <span className="mr-3 text-muted-foreground">Paying</span>
                <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
              </span>
            </div>
          </section>

          {/* How */}
          <section className="space-y-2 py-5">
            <div className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How</div>

            <Option
              selected={how === "card"}
              disabled={!card}
              onSelect={() => setHow("card")}
              title="Charge card on file"
              sub={card ? `${card.brand} •••• ${card.last4} · charged now` : "No saved card for this customer"}
            />

            <Option
              selected={how === "link"}
              onSelect={() => setHow("link")}
              title="Send a payment link"
              sub="The customer pays online — pending until they do"
            >
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-2 text-sm">
                {(
                  [
                    ["email", "Email", contact?.email],
                    ["sms", "SMS", contact?.phone],
                  ] as const
                ).map(([key, label, to]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                      checked={via[key]}
                      onChange={(e) => setVia((v) => ({ ...v, [key]: e.target.checked }))}
                    />
                    {label}
                    {to && <span className="text-muted-foreground">{to}</span>}
                  </label>
                ))}
              </div>
            </Option>

            <Option
              selected={how === "manual"}
              onSelect={() => setHow("manual")}
              title="Record a manual payment"
              sub="Money you took yourself — cash, transfer, Zelle…"
            >
              <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-2 pt-2">
                <select
                  className="h-9 cursor-pointer rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={manualMethod}
                  onChange={(e) => setManualMethod(e.target.value)}
                  aria-label="Method"
                >
                  {MANUAL_METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <DateField ariaLabel="Date" value={manualDate} onChange={setManualDate} />
                <Input placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            </Option>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t px-8 py-4">
          <span className="text-xs text-muted-foreground">
            {how === "manual" && manualDate ? `Dated ${format(new Date(manualDate), "MMM d, yyyy")}` : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={pay} disabled={!canPay}>
              {cta}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One way to pay: a radio row, its detail fields shown only when chosen. */
function Option({
  selected,
  disabled,
  onSelect,
  title,
  sub,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors duration-200 ease-out motion-reduce:transition-none",
        selected ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40",
        disabled && "opacity-50",
      )}
    >
      <label className={cn("flex items-start gap-2.5", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
        <input
          type="radio"
          name="pay-how"
          className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{sub}</span>
        </span>
      </label>
      {selected && children && <div className="pl-6">{children}</div>}
    </div>
  );
}
