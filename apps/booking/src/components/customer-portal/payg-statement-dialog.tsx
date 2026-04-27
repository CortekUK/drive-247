"use client";

import { useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";
import { useReactToPrint } from "react-to-print";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import type { PaygInvoiceData, PaygInvoiceRow, PaygPaymentRow } from "@/hooks/use-payg-invoices";

interface PaygStatementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: PaygInvoiceData;
  customer: { name: string; email?: string; phone?: string };
  vehicle: { reg?: string; make?: string; model?: string };
  rental: {
    rentalNumber: string;
    startDate?: string | null;
    endDate?: string | null;
    isClosed: boolean;
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "PP");
  } catch {
    return value;
  }
}
function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "PP, HH:mm");
  } catch {
    return value;
  }
}

interface StatementContentProps {
  data: PaygInvoiceData;
  customer: PaygStatementDialogProps["customer"];
  vehicle: PaygStatementDialogProps["vehicle"];
  rental: PaygStatementDialogProps["rental"];
  companyName: string;
  logoUrl: string | null;
  accentColor: string;
  currencyCode: string;
  statementNumber: string;
  generatedAt: Date;
  printable: boolean;
}

function StatementContent({
  data,
  customer,
  vehicle,
  rental,
  companyName,
  logoUrl,
  accentColor,
  currencyCode,
  statementNumber,
  generatedAt,
  printable,
}: StatementContentProps) {
  const fmt = (n: number) => formatCurrency(round2(n), currencyCode);
  const vehicleName = vehicle.make && vehicle.model
    ? `${vehicle.make} ${vehicle.model}`
    : (vehicle.reg ?? "—");

  // Sort by dayIndex ASC for the statement table (chronological)
  const sortedInvoices = useMemo(
    () => [...data.invoices].sort((a, b) => a.dayIndex - b.dayIndex),
    [data.invoices],
  );

  // Determine which optional columns to render — hide if no row has any value.
  const anyTax = sortedInvoices.some((i) => i.taxAmount > 0);
  const anyServiceFee = sortedInvoices.some((i) => i.serviceFeeAmount > 0);

  // Aggregates from raw per-day data (NOT from the rolling cumulativeAmount,
  // which resets on payment and would understate the lifetime total).
  const totals = useMemo(() => {
    let charged = 0;
    let chargedRate = 0;
    let chargedTax = 0;
    let chargedFee = 0;
    for (const inv of sortedInvoices) {
      charged = round2(charged + inv.dayTotal);
      chargedRate = round2(chargedRate + inv.dailyRate);
      chargedTax = round2(chargedTax + inv.taxAmount);
      chargedFee = round2(chargedFee + inv.serviceFeeAmount);
    }
    const collected = data.totals.collected;
    const refunded = data.totals.refunded;
    const netReceived = data.totals.netReceived;
    const outstanding = round2(charged - netReceived);
    return {
      charged,
      chargedRate,
      chargedTax,
      chargedFee,
      collected,
      refunded,
      netReceived,
      outstanding: outstanding < 0 ? 0 : outstanding,
      credit: outstanding < 0 ? round2(-outstanding) : 0,
    };
  }, [sortedInvoices, data.totals]);

  // Rental period — for open-ended PAYG, "as of {generatedAt}"
  const periodStart = rental.startDate
    ? fmtDate(rental.startDate)
    : sortedInvoices.length > 0
      ? fmtDate(sortedInvoices[0].createdAt)
      : "—";
  const periodEnd = rental.endDate
    ? fmtDate(rental.endDate)
    : rental.isClosed
      ? data.lastUpdatedAt ? fmtDateTime(data.lastUpdatedAt) : "—"
      : `Ongoing (as of ${format(generatedAt, "PP")})`;

  const containerStyle = printable
    ? { background: "#ffffff", color: "#111827", padding: "32px" }
    : undefined;

  return (
    <div style={containerStyle} className={printable ? "" : "space-y-6"}>
      {/* Company header */}
      <div className={printable ? "" : "border-b pb-6"} style={printable ? { borderBottom: "1px solid #d1d5db", paddingBottom: 24, marginBottom: 24 } : undefined}>
        {logoUrl ? (
          <img src={logoUrl} alt={companyName} style={{ height: 48, objectFit: "contain" }} />
        ) : (
          <h1
            className={printable ? "" : "text-3xl font-bold"}
            style={printable ? { fontSize: 28, fontWeight: 700, color: accentColor, margin: 0 } : { color: accentColor }}
          >
            {companyName}
          </h1>
        )}
      </div>

      {/* Bill-to + Statement details */}
      <div
        style={printable ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 } : undefined}
        className={printable ? "" : "grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6"}
      >
        <div>
          <h3 className={printable ? "" : "font-semibold mb-2"} style={printable ? { fontWeight: 600, marginBottom: 8 } : undefined}>
            Bill To:
          </h3>
          <div className={printable ? "" : "text-sm space-y-1"} style={printable ? { fontSize: 14 } : undefined}>
            <p className={printable ? "" : "font-medium"} style={printable ? { fontWeight: 500, margin: 0 } : undefined}>{customer.name}</p>
            {customer.email && <p style={printable ? { margin: 0 } : undefined}>{customer.email}</p>}
            {customer.phone && <p style={printable ? { margin: 0 } : undefined}>{customer.phone}</p>}
          </div>
        </div>
        <div className={printable ? "" : "sm:text-right"} style={printable ? { textAlign: "right" } : undefined}>
          <h3 className={printable ? "" : "font-semibold mb-2"} style={printable ? { fontWeight: 600, marginBottom: 8 } : undefined}>
            Statement Details:
          </h3>
          <div className={printable ? "" : "text-sm space-y-1"} style={printable ? { fontSize: 14 } : undefined}>
            <p style={printable ? { margin: 0 } : undefined}>
              <span className={printable ? "" : "text-muted-foreground"} style={printable ? { color: "#6b7280" } : undefined}>Statement #:</span>{" "}
              <strong>{statementNumber}</strong>
            </p>
            <p style={printable ? { margin: 0 } : undefined}>
              <span className={printable ? "" : "text-muted-foreground"} style={printable ? { color: "#6b7280" } : undefined}>Issued:</span>{" "}
              {format(generatedAt, "PP")}
            </p>
            <p style={printable ? { margin: 0 } : undefined}>
              <span className={printable ? "" : "text-muted-foreground"} style={printable ? { color: "#6b7280" } : undefined}>Rental Ref:</span>{" "}
              {rental.rentalNumber}
            </p>
          </div>
        </div>
      </div>

      {/* Vehicle & rental info */}
      <div
        className={printable ? "" : "border rounded-lg p-4 bg-muted/30"}
        style={printable ? { border: "1px solid #d1d5db", borderRadius: 8, padding: 16, background: "#f9fafb", marginBottom: 24 } : undefined}
      >
        <h3 className={printable ? "" : "font-semibold mb-3"} style={printable ? { fontWeight: 600, marginBottom: 12, marginTop: 0 } : undefined}>
          Rental Information
        </h3>
        <div
          className={printable ? "" : "grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-sm"}
          style={printable ? { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, fontSize: 14 } : undefined}
        >
          <div>
            <p className={printable ? "" : "text-muted-foreground"} style={printable ? { color: "#6b7280", margin: 0 } : undefined}>Vehicle</p>
            <p className={printable ? "" : "font-medium"} style={printable ? { fontWeight: 500, margin: 0 } : undefined}>{vehicleName}</p>
            {vehicle.reg && (
              <p className={printable ? "" : "text-muted-foreground text-xs"} style={printable ? { color: "#9ca3af", fontSize: 12, margin: 0 } : undefined}>
                Reg: {vehicle.reg}
              </p>
            )}
          </div>
          <div>
            <p className={printable ? "" : "text-muted-foreground"} style={printable ? { color: "#6b7280", margin: 0 } : undefined}>Rental Period</p>
            <p className={printable ? "" : "font-medium"} style={printable ? { fontWeight: 500, margin: 0 } : undefined}>
              {periodStart} → {periodEnd}
            </p>
          </div>
          <div>
            <p className={printable ? "" : "text-muted-foreground"} style={printable ? { color: "#6b7280", margin: 0 } : undefined}>Daily Rate</p>
            <p className={printable ? "" : "font-medium"} style={printable ? { fontWeight: 500, margin: 0 } : undefined}>
              {fmt(data.dailyRate)} / day
            </p>
          </div>
        </div>
      </div>

      {/* Daily charges table */}
      {sortedInvoices.length === 0 ? (
        <div
          className={printable ? "" : "border border-dashed rounded-md py-10 text-center text-sm text-muted-foreground"}
          style={printable ? { border: "1px dashed #d1d5db", borderRadius: 8, padding: 32, textAlign: "center", fontSize: 14, color: "#6b7280", marginBottom: 24 } : undefined}
        >
          No daily charges have accrued yet. This statement will populate once the rental is active.
        </div>
      ) : (
        <div
          className={printable ? "" : "border rounded-lg overflow-hidden"}
          style={printable ? { border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden", marginBottom: 24 } : undefined}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={printable ? { background: "#f3f4f6" } : undefined} className={printable ? "" : "bg-muted"}>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #d1d5db" }}>#</th>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #d1d5db" }}>Date / Time</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #d1d5db" }}>Daily Rate</th>
                {anyTax && (
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #d1d5db" }}>Tax</th>
                )}
                {anyServiceFee && (
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #d1d5db" }}>Service Fee</th>
                )}
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #d1d5db" }}>Day Total</th>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid #d1d5db" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.map((inv) => (
                <tr key={inv.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>{inv.invoiceRef}</td>
                  <td style={{ padding: "8px 12px" }}>{fmtDateTime(inv.createdAt)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(inv.dailyRate)}</td>
                  {anyTax && (
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(inv.taxAmount)}</td>
                  )}
                  {anyServiceFee && (
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(inv.serviceFeeAmount)}</td>
                  )}
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{fmt(inv.dayTotal)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12 }}>
                    <StatusLabel inv={inv} printable={printable} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "1px solid #d1d5db", background: "#f9fafb" }}>
                <td colSpan={2} style={{ padding: "10px 12px", fontWeight: 600 }}>
                  Subtotal — {sortedInvoices.length} day{sortedInvoices.length === 1 ? "" : "s"}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(totals.chargedRate)}</td>
                {anyTax && (
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(totals.chargedTax)}</td>
                )}
                {anyServiceFee && (
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(totals.chargedFee)}</td>
                )}
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(totals.charged)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Payment activity */}
      {data.payments.length > 0 && (
        <div
          className={printable ? "" : "border rounded-lg overflow-hidden"}
          style={printable ? { border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden", marginBottom: 24 } : undefined}
        >
          <div style={{ padding: "8px 12px", background: "#f3f4f6", fontWeight: 600, fontSize: 13 }}>Payment Activity</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, borderTop: "1px solid #e5e7eb" }}>Date</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, borderTop: "1px solid #e5e7eb" }}>Status</th>
                <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600, borderTop: "1px solid #e5e7eb" }}>Amount</th>
                <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600, borderTop: "1px solid #e5e7eb" }}>Refunded</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p: PaygPaymentRow) => (
                <tr key={p.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "8px 12px" }}>{fmtDate(p.paymentDate ?? p.createdAt)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: "#6b7280" }}>{p.status ?? "—"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(p.amount)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: p.refundAmount > 0 ? "#dc2626" : "#9ca3af" }}>
                    {p.refundAmount > 0 ? `-${fmt(p.refundAmount)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary box */}
      <div
        className={printable ? "" : "border rounded-lg overflow-hidden"}
        style={printable ? { border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden", marginBottom: 24 } : undefined}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            <tr>
              <td style={{ padding: "10px 14px" }}>Total Charged</td>
              <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{fmt(totals.charged)}</td>
            </tr>
            <tr style={{ borderTop: "1px solid #e5e7eb" }}>
              <td style={{ padding: "10px 14px" }}>Total Paid</td>
              <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500, color: "#16a34a" }}>
                {fmt(totals.collected)}
              </td>
            </tr>
            {totals.refunded > 0 && (
              <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{ padding: "10px 14px" }}>Total Refunded</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500, color: "#dc2626" }}>
                  -{fmt(totals.refunded)}
                </td>
              </tr>
            )}
            <tr style={{ borderTop: "2px solid #d1d5db", background: "#f3f4f6" }}>
              <td style={{ padding: "12px 14px", fontWeight: 700 }}>
                {totals.outstanding > 0 ? "Outstanding Balance" : totals.credit > 0 ? "Credit on Account" : "Settled"}
              </td>
              <td
                style={{
                  padding: "12px 14px",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 18,
                  fontWeight: 700,
                  color: totals.outstanding > 0 ? "#dc2626" : totals.credit > 0 ? "#16a34a" : accentColor,
                }}
              >
                {totals.outstanding > 0 ? fmt(totals.outstanding) : totals.credit > 0 ? `+${fmt(totals.credit)}` : fmt(0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        className={printable ? "" : "text-center text-sm text-muted-foreground border-t pt-4"}
        style={printable ? { textAlign: "center", fontSize: 12, color: "#6b7280", borderTop: "1px solid #e5e7eb", paddingTop: 16 } : undefined}
      >
        <p style={printable ? { margin: 0 } : undefined}>
          This is a Pay-As-You-Go statement showing all daily charges accrued under your active rental.
        </p>
        <p style={printable ? { margin: "4px 0 0", fontSize: 11, color: "#9ca3af" } : { fontSize: 11 }} className={printable ? "" : "mt-1"}>
          Computer-generated · {companyName}
        </p>
      </div>
    </div>
  );
}

function StatusLabel({ inv, printable }: { inv: PaygInvoiceRow; printable: boolean }) {
  if (inv.status === "paid") {
    const text = "Paid";
    return printable ? (
      <span style={{ color: "#16a34a", fontWeight: 500 }}>{text}</span>
    ) : (
      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{text}</span>
    );
  }
  if (inv.status === "superseded") {
    const text = `Rolled into ${inv.supersededBy ?? "later invoice"}`;
    return printable ? (
      <span style={{ color: "#6b7280" }}>{text}</span>
    ) : (
      <span className="text-muted-foreground">{text}</span>
    );
  }
  const text = "Open";
  return printable ? (
    <span style={{ color: "#d97706", fontWeight: 500 }}>{text}</span>
  ) : (
    <span className="text-amber-600 dark:text-amber-400 font-medium">{text}</span>
  );
}

export function PaygStatementDialog({
  open,
  onOpenChange,
  data,
  customer,
  vehicle,
  rental,
}: PaygStatementDialogProps) {
  const { tenant } = useTenant();
  const companyName = tenant?.app_name || tenant?.company_name || "Statement";
  const logoUrl = tenant?.logo_url ?? null;
  const accentColor = tenant?.accent_color || "#06b6d4";
  const currencyCode = tenant?.currency_code || "USD";

  const generatedAt = useMemo(() => new Date(), [open]);
  const statementNumber = useMemo(
    () => `STMT-${rental.rentalNumber}-${format(generatedAt, "yyyyMMdd")}`,
    [rental.rentalNumber, generatedAt],
  );

  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Statement-${rental.rentalNumber}-${format(generatedAt, "yyyyMMdd")}`,
    pageStyle: `
      @page { size: A4; margin: 0.5in; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `,
  });

  return (
    <>
      {/* Hidden printable copy — uses inline styles only so print fidelity isn't tied to Tailwind */}
      <div style={{ display: "none" }}>
        <div ref={printRef}>
          <StatementContent
            data={data}
            customer={customer}
            vehicle={vehicle}
            rental={rental}
            companyName={companyName}
            logoUrl={logoUrl}
            accentColor={accentColor}
            currencyCode={currencyCode}
            statementNumber={statementNumber}
            generatedAt={generatedAt}
            printable
          />
        </div>
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto scrollbar-hide [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Statement of Account
            </DialogTitle>
          </DialogHeader>

          <StatementContent
            data={data}
            customer={customer}
            vehicle={vehicle}
            rental={rental}
            companyName={companyName}
            logoUrl={logoUrl}
            accentColor={accentColor}
            currencyCode={currencyCode}
            statementNumber={statementNumber}
            generatedAt={generatedAt}
            printable={false}
          />

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={handlePrint} disabled={data.invoices.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Print / Save PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
