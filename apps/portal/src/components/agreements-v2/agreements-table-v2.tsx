"use client";

/**
 * v2 (northwind): the Agreements table, built from the rentals list's kit
 * (`components/shared/list-table-v2`). No pager: rows arrive 25 at a time as
 * the table scrolls, with one line under the card saying how much is shown.
 *
 * Rows do not open anything. There is no agreement record route and the v1 row
 * opens nothing either; its "open" affordances are buttons (View document for
 * e-sign rows, Open in new tab for uploaded files), and both are kept here.
 *
 * Every action is v1's, calling the page's own handlers under v1's own
 * conditions. v1 can put five buttons in a row (Sign, View, Download, Resend,
 * Void), which cannot fit a column that keeps the table inside the card, so
 * Sign stays inline and the rest move into the row's "⋯" menu, as Fines and
 * Invoices did. A menu item's spinner is out of sight once the menu closes, so
 * while any of this row's menu actions is in flight the trigger itself spins:
 * the per-row "something is happening here" signal v1 gives is still on screen.
 *
 * The progressive-rows hook lives HERE, not on the page, because the page
 * returns early while its three queries load. Mounting the hook with its table
 * mounts it with its sentinel.
 */

import { Ban, Download, ExternalLink, Eye, Loader2, MoreHorizontal, PenLine, Send } from "lucide-react";
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
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
  type ListTone,
} from "@/components/shared/list-table-v2";

/** The fields this table reads. The page's own `AgreementDoc` satisfies it. */
export interface AgreementRowV2 {
  id: string;
  document_name: string;
  file_name?: string;
  file_url?: string | null;
  document_id?: string | null;
  created_at: string;
  signed_at?: string | null;
  customers?: { name: string };
  isRentalAgreement?: boolean;
  status?: string;
}

/** v1's date format, year and time included: a cut date is a wrong date. */
const DATE_FORMAT = "MMM dd, yyyy HH:mm";

/**
 * The label v1's Status cell prints, derived exactly as v1 derives it (the
 * same exact-match comparisons, so no row reads differently here). Only the
 * hue is new, keyed on the lower-cased label.
 */
const agreementStatusLabelV2 = (doc: AgreementRowV2, justSigned: boolean): string =>
  justSigned || doc.status === "completed" || doc.status === "signed"
    ? "Signed"
    : doc.isRentalAgreement
    ? "Pending signature"
    : "Signed";

const AGREEMENT_STATUS_TONE_V2: Record<string, ListTone> = {
  signed: "success",
  "pending signature": "warning",
};

const Blank = () => <span className="text-muted-foreground">—</span>;

export function AgreementsTableV2<T extends AgreementRowV2>({
  rows,
  resetKey,
  justSignedIds,
  signingDocId,
  viewingDocId,
  downloadingDocId,
  resendingId,
  voidingId,
  onSign,
  onView,
  onDownload,
  onResend,
  onRequestVoid,
  onDownloadFile,
  onOpenFile,
}: {
  /** Every filtered agreement, already in memory: growing the list is a bigger slice. */
  rows: T[];
  /** Changes with the result set (tenant, search) and never on a refetch. */
  resetKey: string;
  /** Rows the page has optimistically marked signed after the signing dialog. */
  justSignedIds: Set<string>;
  signingDocId: string | null;
  /** The row whose View document request is loading (v1: viewDialogLoading && viewDialogDoc.id). */
  viewingDocId: string | null;
  downloadingDocId: string | null;
  resendingId: string | null;
  voidingId: string | null;
  onSign: (doc: T) => void;
  onView: (doc: T) => void;
  onDownload: (doc: T) => void;
  onResend: (doc: T) => void;
  /** Opens the page's existing void confirmation; the confirm there voids. */
  onRequestVoid: (doc: T) => void;
  onDownloadFile: (fileUrl: string, fileName: string) => void;
  onOpenFile: (fileUrl: string) => void;
}) {
  const agreementRows = useProgressiveRows(rows, resetKey);

  return (
    <>
      <ListTable rows={agreementRows} minWidth="min-w-[880px]">
        {/* Widths measured at the 944px card in Manrope. Only Customer may
            truncate (with a title), so it takes what is left. The rest hold
            their longest values whole: "Extension Agreement - MMWW8888" (230px),
            "Pending signature" (120px), "May 28, 2026 20:48" (130px), and
            Sign + the menu (111px). */}
        <ListTableHeader>
          <ListHead className="w-[27.5%]">Agreement</ListHead>
          <ListHead className="w-[10%]">Customer</ListHead>
          <ListHead className="w-[16%]">Status</ListHead>
          <ListHead className="w-[16.75%]">Sent</ListHead>
          <ListHead className="w-[16.75%]">Signed</ListHead>
          <ListHead className="w-[13%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {agreementRows.visible.map((doc) => {
            const justSigned = justSignedIds.has(doc.id);
            const statusLabel = agreementStatusLabelV2(doc, justSigned);
            // v1's conditions, verbatim: Sign at its line 824, Resend and Void at 866.
            const canSign = !justSigned && doc.status !== "completed" && doc.status !== "signed";
            const canResendOrVoid =
              !justSigned && doc.status !== "completed" && doc.status !== "signed" && doc.status !== "voided";
            const isViewing = viewingDocId === doc.id;
            const isDownloading = downloadingDocId === doc.id;
            const isResending = resendingId === doc.id;
            const isVoiding = voidingId === doc.id;
            const menuBusy = isViewing || isDownloading || isResending || isVoiding;

            return (
              <ListRow key={doc.id}>
                <ListCell>
                  <span className={`block truncate ${LIST_CLASSES.identifier}`} title={doc.document_name}>
                    {doc.document_name}
                  </span>
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
                {/* Never truncated: a cut status is a different status. */}
                <ListCell>
                  <ListStatusText tone={AGREEMENT_STATUS_TONE_V2[statusLabel.toLowerCase()] ?? "muted"}>
                    {statusLabel}
                  </ListStatusText>
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={LIST_CLASSES.text}>{format(new Date(doc.created_at), DATE_FORMAT)}</span>
                </ListCell>
                <ListCell className="tabular-nums">
                  {doc.signed_at ? (
                    <span className={LIST_CLASSES.text}>{format(new Date(doc.signed_at), DATE_FORMAT)}</span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                {/* Clicks on the buttons and on the menu's items (portalled, but
                    still React children of this cell) stop here, so nothing a
                    row is ever given can fire from them. */}
                <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {doc.file_url ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className={LIST_ROW_ACTION}
                            aria-label={`Actions for ${doc.document_name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => onDownloadFile(doc.file_url!, doc.file_name || doc.document_name)}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onOpenFile(doc.file_url!)}>
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open in new tab
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : doc.document_id ? (
                      <>
                        {canSign && (
                          <Button
                            size="sm"
                            onClick={() => onSign(doc)}
                            disabled={signingDocId === doc.id}
                            title="Sign agreement"
                            className="-my-1.5"
                          >
                            {signingDocId === doc.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <PenLine className="h-4 w-4" />
                            )}
                            Sign
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className={LIST_ROW_ACTION}
                              aria-label={`Actions for ${doc.document_name}`}
                              aria-busy={menuBusy || undefined}
                            >
                              {menuBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-4 w-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onView(doc)} disabled={isViewing}>
                              {isViewing ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Eye className="h-4 w-4 mr-2" />
                              )}
                              View document
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onDownload(doc)} disabled={isDownloading}>
                              {isDownloading ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4 mr-2" />
                              )}
                              Download document
                            </DropdownMenuItem>
                            {canResendOrVoid && (
                              <>
                                <DropdownMenuItem onClick={() => onResend(doc)} disabled={isResending}>
                                  {isResending ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <Send className="h-4 w-4 mr-2" />
                                  )}
                                  Resend signing notification
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => onRequestVoid(doc)}
                                  disabled={isVoiding}
                                  className="text-destructive focus:text-destructive"
                                >
                                  {isVoiding ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <Ban className="h-4 w-4 mr-2" />
                                  )}
                                  Void agreement
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">No document</span>
                    )}
                  </div>
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      {/* No `serverTotal`: none of the page's three queries takes a count. */}
      <ListFooter rows={agreementRows} one="agreement" many="agreements" />
    </>
  );
}
