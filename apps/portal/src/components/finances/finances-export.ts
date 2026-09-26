/**
 * Export — the rows the current view is showing, filters applied, as CSV.
 *
 * Money leaves as plain numbers in the tenant's currency (cents / 100, two
 * places) with the currency code in its own column, so a spreadsheet can add
 * the column up and get the figure on screen. Pure builders; the page hands
 * the result to `downloadCsv`.
 *
 * An invoice-only row exports as it reads on screen: its invoice's total under
 * Total, and blank Paid / Credited / Balance (it claims no math). Every
 * invoice of a rental is named in "All invoices". A payment taken outside the
 * platform says so in "Off-platform".
 */
import type { CsvCell } from "@/lib/csv-export";
import type { EnhancedFine } from "@/hooks/use-fines-data";
import type { BillRow, FinanceView, ReceiptRow, UpcomingRow } from "@/lib/finances/types";
import { billStatusText } from "@/lib/finances/bills";
import { toCents } from "@/lib/finances/balance";
import { RECEIPT_STATUS_LABEL, UPCOMING_METHOD_LABEL, fineStatusWords, receiptMethodWords, upcomingStatusWords } from "./finance-words";

const dollars = (cents: number) => Math.round(cents) / 100;

export interface FinanceCsv {
  base: string;
  header: string[];
  rows: CsvCell[][];
}

export function financesCsv(
  view: FinanceView,
  currency: string,
  rows: { bills?: BillRow[]; receipts?: ReceiptRow[]; upcoming?: UpcomingRow[]; fines?: EnhancedFine[] },
): FinanceCsv {
  switch (view) {
    case "billed":
      return {
        base: "finances-billed",
        header: ["Rental", "Bill", "Customer", "Vehicle", "Invoice #", "Issued", "Due", "Total", "Paid", "Credited", "Balance", "Status", "Adds up", "Currency", "All invoices"],
        rows: (rows.bills ?? []).map((b) => {
          const only = b.invoiceOnly === true;
          return [
            b.onRental ? b.rentalRef : "",
            b.label,
            b.customerName,
            b.vehicleReg ?? "",
            b.invoiceNumber ?? "",
            b.issuedOn,
            b.dueOn ?? "",
            only ? dollars(b.invoiceTotalCents ?? 0) : dollars(b.totalCents),
            only ? "" : dollars(b.paidCents),
            only ? "" : dollars(b.creditedCents),
            only ? "" : dollars(b.balanceCents),
            billStatusText(b, currency),
            only ? "Invoice only" : b.tiesOut ? "Yes" : `No, by ${dollars(Math.abs(b.mismatchCents))}`,
            currency,
            (b.invoices ?? []).map((i) => i.number).join("; "),
          ];
        }),
      };
    case "received":
      return {
        base: "finances-received",
        header: ["Date", "Customer", "Rental", "Vehicle", "Amount", "Refunded", "Not applied", "Method", "Reference", "Status", "Payment plan", "Currency", "Off-platform"],
        rows: (rows.receipts ?? []).map((r) => [
          r.date,
          r.customerName,
          r.rentalRef ?? "",
          r.vehicleReg ?? "",
          dollars(r.amountCents),
          dollars(r.refundedCents),
          dollars(r.unappliedCents),
          receiptMethodWords(r),
          r.providerRef ?? "",
          RECEIPT_STATUS_LABEL[r.status],
          r.planLabel ?? "",
          currency,
          r.isOffPlatform ? "Yes" : "",
        ]),
      };
    case "upcoming":
      return {
        base: "finances-upcoming",
        header: ["Due", "Customer", "Rental", "Payment", "Amount", "How", "Status", "Currency"],
        rows: (rows.upcoming ?? []).map((u) => [
          u.effectiveOn ?? u.dueDate,
          u.customerName,
          u.rentalRef,
          u.seqLabel,
          dollars(u.amountCents),
          UPCOMING_METHOD_LABEL[u.method] ?? u.method,
          upcomingStatusWords(u).label,
          currency,
        ]),
      };
    case "fines":
      return {
        base: "finances-fines",
        header: ["Reference", "Type", "Rental", "Vehicle", "Customer", "Issued", "Due", "Status", "Amount", "Currency"],
        rows: (rows.fines ?? []).map((f) => [
          f.reference_no || f.id.slice(0, 8),
          f.type ?? "",
          f.rentals?.rental_number ?? "",
          f.vehicles?.reg ?? "",
          f.customers?.name ?? "",
          f.issue_date,
          f.due_date,
          fineStatusWords(f.status, f.isOverdue).label,
          dollars(toCents(f.amount)),
          currency,
        ]),
      };
  }
}
