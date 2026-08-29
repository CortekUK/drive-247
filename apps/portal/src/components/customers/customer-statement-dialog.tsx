"use client";

import { useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, AlertCircle } from "lucide-react";
import { useReactToPrint } from "react-to-print";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { formatCurrency } from "@/lib/format-utils";
import { useCustomerStatement, type StatementData, type StatementGroup } from "@/hooks/use-customer-statement";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string | null;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "PP");
  } catch {
    return value;
  }
}

interface ContentProps {
  data: StatementData;
  companyName: string;
  logoUrl: string | null | undefined;
  accentColor: string;
  currencyCode: string;
  statementNumber: string;
  generatedAt: Date;
  printable: boolean;
}

function StatementContent({
  data,
  companyName,
  logoUrl,
  accentColor,
  currencyCode,
  statementNumber,
  generatedAt,
  printable,
}: ContentProps) {
  const fmt = (n: number) => formatCurrency(round2(n), currencyCode);
  const { customer, groups, grand } = data;

  const containerStyle = printable
    ? { background: "#ffffff", color: "#111827", padding: "32px" }
    : undefined;

  const th = { textAlign: "left" as const, padding: "8px 12px", fontWeight: 600, borderBottom: "1px solid #d1d5db" };
  const thR = { ...th, textAlign: "right" as const };

  return (
    <div style={containerStyle} className={printable ? "" : "space-y-6"}>
      {/* Company header */}
      <div
        className={printable ? "" : "border-b pb-6 flex items-start justify-between gap-4"}
        style={printable ? { borderBottom: "1px solid #d1d5db", paddingBottom: 24, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start" } : undefined}
      >
        <div>
          {logoUrl ? (
            <img src={logoUrl} alt={companyName} style={{ height: 48, objectFit: "contain" }} />
          ) : (
            <h1
              className={printable ? "" : "text-2xl font-bold"}
              style={printable ? { fontSize: 26, fontWeight: 700, color: accentColor, margin: 0 } : { color: accentColor }}
            >
              {companyName}
            </h1>
          )}
        </div>
        <div className={printable ? "" : "text-right"} style={printable ? { textAlign: "right" } : undefined}>
          <div style={{ fontSize: printable ? 18 : undefined, fontWeight: 700, letterSpacing: 0.5 }} className={printable ? "" : "text-lg font-bold tracking-wide"}>
            STATEMENT OF ACCOUNT
          </div>
          <div className={printable ? "" : "text-sm text-muted-foreground"} style={printable ? { fontSize: 13, color: "#6b7280" } : undefined}>
            <div>#: <strong>{statementNumber}</strong></div>
            <div>Issued: {format(generatedAt, "PP")}</div>
          </div>
        </div>
      </div>

      {/* Statement for */}
      <div className={printable ? "" : "text-sm"} style={printable ? { fontSize: 14, marginBottom: 24 } : undefined}>
        <h3 className={printable ? "" : "font-semibold mb-1"} style={printable ? { fontWeight: 600, margin: "0 0 4px" } : undefined}>Statement For:</h3>
        <p className={printable ? "" : "font-medium"} style={printable ? { fontWeight: 500, margin: 0 } : undefined}>{customer.name || "—"}</p>
        {customer.email && <p style={printable ? { margin: 0 } : undefined}>{customer.email}</p>}
        {customer.phone && <p style={printable ? { margin: 0 } : undefined}>{customer.phone}</p>}
      </div>

      {/* Per-rental grouped sections */}
      {groups.length === 0 ? (
        <div
          className={printable ? "" : "border border-dashed rounded-md py-10 text-center text-sm text-muted-foreground"}
          style={printable ? { border: "1px dashed #d1d5db", borderRadius: 8, padding: 32, textAlign: "center", fontSize: 14, color: "#6b7280" } : undefined}
        >
          No account activity yet.
        </div>
      ) : (
        groups.map((g: StatementGroup) => {
          const vehicleName = g.vehicle.make && g.vehicle.model ? `${g.vehicle.make} ${g.vehicle.model}` : (g.vehicle.reg ?? "");
          return (
            <div
              key={g.rentalId ?? "account"}
              className={printable ? "" : "border rounded-lg overflow-hidden"}
              style={printable ? { border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden", marginBottom: 20, breakInside: "avoid" } : { breakInside: "avoid" }}
            >
              <div style={{ padding: "10px 12px", background: "#f3f4f6", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {g.rentalId ? `Rental ${g.rentalNumber}` : g.rentalNumber}
                  {vehicleName ? ` · ${vehicleName}` : ""}
                  {g.vehicle.reg ? ` (${g.vehicle.reg})` : ""}
                </div>
                {(g.startDate || g.endDate) && (
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {fmtDate(g.startDate)} → {fmtDate(g.endDate)}
                  </div>
                )}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={th}>Category</th>
                    <th style={thR}>Charged</th>
                    <th style={thR}>Paid</th>
                    <th style={thR}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {g.categories.map((c) => {
                    // baseCategory, not category: a fine line now reads its own type
                    // ("Smoking/ Cleaning Violation"), so matching the label would
                    // silently drop the amber highlight and the warning marker that
                    // tell a guest this charge is a penalty.
                    const isFine = (c.baseCategory ?? c.category) === "Fine";
                    return (
                      <tr key={c.category} style={{ borderTop: "1px solid #e5e7eb" }}>
                        <td style={{ padding: "8px 12px", color: isFine ? "#b45309" : undefined, fontWeight: isFine ? 600 : undefined }}>
                          {c.category}{isFine ? "" : ""}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(c.charged)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#16a34a" }}>{fmt(c.paid)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: c.outstanding > 0 ? "#dc2626" : "#9ca3af" }}>{fmt(c.outstanding)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "1px solid #d1d5db", background: "#f9fafb" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>Rental subtotal</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(g.charged)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#16a34a" }}>{fmt(g.paid)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: g.outstanding > 0 ? "#dc2626" : "#6b7280" }}>{fmt(g.outstanding)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })
      )}

      {/* Grand summary */}
      <div
        className={printable ? "" : "border rounded-lg overflow-hidden"}
        style={printable ? { border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden", marginTop: 8 } : undefined}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            <tr>
              <td style={{ padding: "10px 14px" }}>Total Charged</td>
              <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{fmt(grand.charged)}</td>
            </tr>
            <tr style={{ borderTop: "1px solid #e5e7eb" }}>
              <td style={{ padding: "10px 14px" }}>Total Paid</td>
              <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500, color: "#16a34a" }}>{fmt(grand.paid)}</td>
            </tr>
            {grand.refunds > 0 && (
              <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{ padding: "10px 14px" }}>Total Refunded</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500, color: "#dc2626" }}>-{fmt(grand.refunds)}</td>
              </tr>
            )}
            {grand.fines > 0 && (
              <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{ padding: "10px 14px", color: "#b45309" }}>of which Fines &amp; penalties</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#b45309" }}>{fmt(grand.fines)}</td>
              </tr>
            )}
            {grand.tax > 0 && (
              <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{ padding: "10px 14px", color: "#6b7280" }}>of which Tax</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{fmt(grand.tax)}</td>
              </tr>
            )}
            <tr style={{ borderTop: "2px solid #d1d5db", background: "#f3f4f6" }}>
              <td style={{ padding: "12px 14px", fontWeight: 700 }}>
                {grand.outstanding > 0 ? "Total Outstanding" : "Settled"}
              </td>
              <td
                style={{
                  padding: "12px 14px",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 18,
                  fontWeight: 700,
                  color: grand.outstanding > 0 ? "#dc2626" : accentColor,
                }}
              >
                {fmt(grand.outstanding)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        className={printable ? "" : "text-center text-sm text-muted-foreground border-t pt-4"}
        style={printable ? { textAlign: "center", fontSize: 12, color: "#6b7280", borderTop: "1px solid #e5e7eb", paddingTop: 16, marginTop: 24 } : undefined}
      >
        <p style={printable ? { margin: 0 } : undefined}>
          This is a statement of account, not a tax invoice — see the individual rental invoices for itemised tax.
        </p>
        <p style={printable ? { margin: "4px 0 0", fontSize: 11, color: "#9ca3af" } : { fontSize: 11 }} className={printable ? "" : "mt-1"}>
          Computer-generated · {companyName} · {format(generatedAt, "PP, HH:mm")}
        </p>
      </div>
    </div>
  );
}

export function CustomerStatementDialog({ open, onOpenChange, customerId }: Props) {
  const { tenant } = useTenant();
  const { branding } = useTenantBranding();
  const { data, isLoading, error } = useCustomerStatement(customerId, open);

  const companyName = branding?.app_name || tenant?.company_name || "Statement";
  const logoUrl = branding?.logo_url;
  const accentColor = branding?.accent_color || "#C5A572";
  const currencyCode = tenant?.currency_code || "USD";

  const generatedAt = useMemo(() => new Date(), [open]);
  const statementNumber = useMemo(() => {
    const token = (customerId ?? "").replace(/-/g, "").slice(0, 6).toUpperCase() || "ACCT";
    return `STMT-${format(generatedAt, "yyyyMMdd")}-${token}`;
  }, [customerId, generatedAt]);

  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: statementNumber,
    pageStyle: `
      @page { size: A4; margin: 0.5in; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        table { page-break-inside: auto; }
        thead { display: table-header-group; }
      }
    `,
  });

  const hasData = !!data && data.groups.length > 0;

  return (
    <>
      {hasData && (
        <div style={{ display: "none" }}>
          <div ref={printRef}>
            <StatementContent
              data={data!}
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
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Statement of Account
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
              <AlertCircle className="h-6 w-6 text-destructive" />
              Could not load the statement. Please try again.
            </div>
          ) : data ? (
            <StatementContent
              data={data}
              companyName={companyName}
              logoUrl={logoUrl}
              accentColor={accentColor}
              currencyCode={currencyCode}
              statementNumber={statementNumber}
              generatedAt={generatedAt}
              printable={false}
            />
          ) : null}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={handlePrint} disabled={!hasData}>
              <Download className="h-4 w-4 mr-2" />
              Print / Save PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
