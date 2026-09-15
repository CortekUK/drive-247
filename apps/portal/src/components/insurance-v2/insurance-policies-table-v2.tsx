"use client";

/**
 * v2 (northwind): the /insurances Policies tab's table, built from the rentals
 * list's kit (`components/shared/list-table-v2`). No pager: rows arrive 25 at a
 * time as the table scrolls, with one line under the card saying how much is
 * shown.
 *
 * The progressive-rows hook lives HERE, not on the page, because the table sits
 * inside a Radix `TabsContent` that unmounts while AI Verifications is open.
 * Mounting the hook with its table mounts it with its sentinel.
 *
 * A row opens only the destination v1 already offers on it: a Bonzah or INSHUR
 * policy with a rental opens that rental (v1's View Rental button). An uploaded
 * document opens nothing, as in v1 and as on the Agreements list: downloading a
 * file and opening it in a new tab stay actions, in the ⋯ menu. View Rental is
 * in the menu too, so it stays reachable from the keyboard.
 *
 * Every action is v1's, with v1's conditions and the page's own handlers, in
 * v1's precedence: a file first, then INSHUR, then Bonzah.
 */

import { AlertTriangle, DollarSign, Download, ExternalLink, Loader2, MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LIST_CLASSES,
  LIST_ROW_ACTION,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListMetaChip,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
  type ListTone,
} from "@/components/shared/list-table-v2";
import { InshurIdCardButton, getInshurStatusInfo } from "@/components/rentals/inshur-coverage-block";
import type { InshurCoverage } from "@/hooks/use-inshur-coverage";
import { cn } from "@/lib/utils";

/** The fields this table reads. The page's own `InsuranceDoc` satisfies it. */
export interface InsurancePolicyRowV2 {
  id: string;
  document_name: string;
  file_name?: string;
  file_url?: string | null;
  created_at: string;
  document_type?: string;
  customers?: { name: string } | null;
  provider: "bonzah" | "inshur" | "uploaded";
  rental_id?: string | null;
  status?: string;
  bonzah_pdf_ids?: Record<string, number> | null;
  premium_amount?: number | null;
  payment_status?: "paid" | "partial" | "unpaid" | null;
  inshur?: InshurCoverage;
}

/**
 * Bonzah statuses as coloured text. v1's badge variants, by meaning: active is
 * success; quoted and awaiting payment are warning; cancelled and failed are
 * danger, and so is insufficient_balance, which is a policy Bonzah refused to
 * issue (v1 left it neutral). Anything else recedes.
 */
const BONZAH_STATUS_TONE_V2: Record<string, ListTone> = {
  active: "success",
  quoted: "warning",
  payment_pending: "warning",
  pending: "warning",
  cancelled: "danger",
  failed: "danger",
  insufficient_balance: "danger",
};

/** INSHUR's own tones (inshur-coverage-block), with its `pending` as in progress. */
const INSHUR_TONE_V2: Record<ReturnType<typeof getInshurStatusInfo>["tone"], ListTone> = {
  success: "success",
  pending: "info",
  warning: "warning",
  danger: "danger",
  muted: "muted",
};

const PAYMENT_V2: Record<"paid" | "partial" | "unpaid", { label: string; tone: ListTone }> = {
  paid: { label: "Paid", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  unpaid: { label: "Unpaid", tone: "danger" },
};

const Blank = () => <span className="text-muted-foreground">—</span>;

export function InsurancePoliciesTableV2<T extends InsurancePolicyRowV2>({
  rows,
  resetKey,
  downloadingBonzahPdf,
  onDownload,
  onView,
  onBonzahDownload,
  onAddPayment,
  onViewRental,
}: {
  /** Every filtered document, already in memory and in v1's order. */
  rows: T[];
  /** Changes with the result set (tenant, search, provider) and never on a refetch. */
  resetKey: string;
  downloadingBonzahPdf: string | null;
  onDownload: (fileUrl: string, fileName: string) => void;
  onView: (fileUrl: string) => void;
  onBonzahDownload: (doc: T) => void;
  onAddPayment: (doc: T) => void;
  onViewRental: (doc: T) => void;
}) {
  const policyRows = useProgressiveRows(rows, resetKey);

  return (
    <>
      <ListTable rows={policyRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          {/* Widths, measured in Manrope on a 944px card. Premium, Policy status,
              Payment and Created hold their longest values in full: "$1234.56",
              "Insurance Certificate" / "Insufficient Balance", "Unpaid",
              "May 28, 2026 20:48". Two action buttons fit. Document holds
              "Bonzah Insurance - Policy #" plus ten characters; a longer name
              truncates with the whole name in its title, and Customer truncates. */}
          <ListHead className="w-[30.5%]">Document</ListHead>
          <ListHead className="w-[10%]">Customer</ListHead>
          <ListHead className="w-[9.5%] text-right">Premium</ListHead>
          <ListHead className="w-[17.5%]">Policy status</ListHead>
          <ListHead className="w-[8%]">Payment</ListHead>
          <ListHead className="w-[16.5%]">Created</ListHead>
          <ListHead className="w-[8%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {policyRows.visible.map((doc) => {
            const hasFile = !!doc.file_url;
            const isInshur = !hasFile && doc.provider === "inshur";
            const isBonzah = !hasFile && doc.provider === "bonzah";
            const canAddPayment =
              (isInshur || isBonzah) &&
              (doc.payment_status === "unpaid" || doc.payment_status === "partial") &&
              !!doc.rental_id;
            const hasPdf = isBonzah && !!doc.bonzah_pdf_ids && Object.keys(doc.bonzah_pdf_ids).length > 0;
            const canViewRental = (isInshur || isBonzah) && !!doc.rental_id;
            const showIdCard =
              isInshur && !!doc.inshur && (doc.inshur.status === "active" || doc.inshur.status === "ended");
            const pdfBusy = downloadingBonzahPdf === doc.id;
            const hasMenu = hasFile || canAddPayment || hasPdf || canViewRental;

            // v1's rail condition and InshurModeChip's: anything not proven live.
            const notLive = doc.provider === "inshur" && doc.inshur?.source_mode !== "live";
            const testAccount = doc.inshur?.source_mode === "test";

            // v1's brand pill, as a quiet chip. Left off when the name already
            // says it ("Bonzah Insurance - Policy #…", "INSHUR Period Z — …"), so
            // the chip does not squeeze the policy number out of the column.
            const providerChip =
              doc.provider !== "uploaded" && !doc.document_name.toLowerCase().includes(doc.provider)
                ? doc.provider === "bonzah"
                  ? "Bonzah"
                  : "INSHUR"
                : null;

            const inshurStatus = doc.provider === "inshur" ? getInshurStatusInfo(doc.status) : null;
            const payment = doc.payment_status ? PAYMENT_V2[doc.payment_status] : null;

            return (
              <ListRow
                key={doc.id}
                // The rentals list's flag treatment: a faint tint and a 2px rail,
                // in place of v1's 4px amber border on a non-live INSHUR row.
                className={cn(notLive && "bg-amber-500/5 border-l-2 border-l-amber-500")}
                onOpen={canViewRental ? () => onViewRental(doc) : undefined}
              >
                <ListCell>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={cn("truncate", LIST_CLASSES.identifier)} title={doc.document_name}>
                        {doc.document_name}
                      </span>
                      {providerChip && (
                        // Held to the text's line height: as a flex item the chip's
                        // padding would make this row taller than a rentals row.
                        <span className="flex h-5 shrink-0 items-center">
                          <ListMetaChip>{providerChip}</ListMetaChip>
                        </span>
                      )}
                    </div>
                    {/* v1 puts InshurModeChip next to the name, never only in the
                        status column, because status columns get scanned past.
                        Here it is the rentals list's flag line under the name,
                        with the chip's own warning as its tooltip. */}
                    {notLive && (
                      <span
                        className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                        title={
                          testAccount
                            ? "Written against ABI’s test account. Nobody is insured by this record."
                            : "Generated by the Drive247 simulator. No insurance exists behind this record."
                        }
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {testAccount ? "Test account · not real cover" : "Simulated · not real cover"}
                      </span>
                    )}
                  </div>
                </ListCell>
                <ListCell>
                  {doc.customers?.name ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={doc.customers.name}>
                      {doc.customers.name}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                {/* v1's exact text: a hard-coded "$" and two decimals. Never
                    truncated, an ellipsis here hides money. */}
                <ListCell className="text-right tabular-nums">
                  {doc.premium_amount != null ? (
                    <span className={LIST_CLASSES.text}>{`$${doc.premium_amount.toFixed(2)}`}</span>
                  ) : doc.provider === "inshur" ? (
                    // No renter charge means the operator absorbs it. "$0.00" would lie.
                    <span
                      className="text-muted-foreground"
                      title="Cover is included in the rental. INSHUR invoices you monthly per VIN — the renter isn't charged a separate line."
                    >
                      Included
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {inshurStatus ? (
                    <ListStatusText tone={INSHUR_TONE_V2[inshurStatus.tone] ?? "muted"}>
                      {inshurStatus.label}
                    </ListStatusText>
                  ) : doc.provider === "bonzah" ? (
                    doc.status ? (
                      <ListStatusText tone={BONZAH_STATUS_TONE_V2[doc.status.toLowerCase()] ?? "muted"}>
                        {doc.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </ListStatusText>
                    ) : (
                      <Blank />
                    )
                  ) : doc.document_type ? (
                    // An uploaded document has no policy status; v1 shows its
                    // document type here, quietly.
                    <span className="block truncate" title={doc.document_type}>
                      <ListStatusText tone="muted">{doc.document_type}</ListStatusText>
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {payment ? <ListStatusText tone={payment.tone}>{payment.label}</ListStatusText> : <Blank />}
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={LIST_CLASSES.text}>{format(new Date(doc.created_at), "MMM dd, yyyy HH:mm")}</span>
                </ListCell>
                {/* No control here may open the row: clicks on the buttons, the
                    menu's items and the ID card's confirmation (portalled, but
                    still React children of this cell) stop here. */}
                <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                  {!hasFile && !isInshur && !isBonzah ? (
                    // v1's "—" for an uploaded document with no file, centred
                    // under the other rows' ⋯ buttons.
                    <span className="pr-3">
                      <Blank />
                    </span>
                  ) : (
                    <div className="flex items-center justify-end">
                      {showIdCard && (
                        // Inline, never inside the menu: the button owns the
                        // simulated-card confirmation, which would unmount with a
                        // closing menu. Icon-sized to fit the column; its label
                        // stays in the button for assistive tech, and here.
                        <span
                          className="flex"
                          title={doc.inshur!.source_mode !== "live" ? "ID card (simulated)" : "Download ID card"}
                        >
                          <InshurIdCardButton
                            coverage={doc.inshur!}
                            variant="ghost"
                            size="sm"
                            className={cn(
                              LIST_ROW_ACTION,
                              "justify-start gap-0 overflow-hidden px-2 text-transparent hover:text-transparent [&_svg]:mr-0 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground",
                            )}
                          />
                        </span>
                      )}
                      {hasMenu && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className={LIST_ROW_ACTION}
                              aria-label={`Actions for ${doc.document_name}`}
                            >
                              {/* v1's PDF button spins while its download runs; the
                                  menu closes on click, so the trigger carries it. */}
                              {pdfBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-4 w-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {hasFile ? (
                              <>
                                <DropdownMenuItem
                                  onClick={() => onDownload(doc.file_url!, doc.file_name || doc.document_name)}
                                >
                                  <Download className="h-4 w-4 mr-2" />
                                  Download
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onView(doc.file_url!)}>
                                  <ExternalLink className="h-4 w-4 mr-2" />
                                  Open in new tab
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <>
                                {canAddPayment && (
                                  <DropdownMenuItem onClick={() => onAddPayment(doc)}>
                                    <DollarSign className="h-4 w-4 mr-2" />
                                    Add Payment
                                  </DropdownMenuItem>
                                )}
                                {hasPdf && (
                                  <DropdownMenuItem onClick={() => onBonzahDownload(doc)} disabled={pdfBusy}>
                                    {pdfBusy ? (
                                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                      <Download className="h-4 w-4 mr-2" />
                                    )}
                                    Download PDF
                                  </DropdownMenuItem>
                                )}
                                {canViewRental && (
                                  <DropdownMenuItem onClick={() => onViewRental(doc)}>
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    View Rental
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  )}
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      {/* No `serverTotal`: none of the page's queries counts, so there is no
          honest figure to set against the rows. */}
      <ListFooter rows={policyRows} one="insurance document" many="insurance documents" />
    </>
  );
}
