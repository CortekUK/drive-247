"use client";

/**
 * v2: the Agreements tables, built from the rentals list's kit
 * (`components/shared/list-table-v2`). No pager: rows arrive 25 at a time as
 * the table scrolls, with one line under the card saying how much is shown.
 *
 * TWO TABLES, ON PURPOSE.
 *
 * `AgreementsListTableV2` is the Agreements v2 list (`useV2("agreements")`,
 * mounted by `agreements-page-v2.tsx`): one row per agreement sent, rental or
 * individual, with the four columns the team lead asked for (D16): Customer,
 * Email, Sent (with AM/PM) and Status (Signed, Pending signature, Failed).
 * There is no Signed column any more, because Status says it, and no
 * Agreement column, because the customer is what an operator looks for.
 *
 * `AgreementsTableV2` below it is the older table the v1 page still mounts
 * inside its own `useV2("chrome")` branch (`app/(dashboard)/agreements/page.tsx`),
 * over that page's three merged sources. It stays exactly as it was so a tenant
 * on the v2 chrome but not yet on Agreements v2 sees no change. Retiring it is
 * deleting it together with that branch.
 */

import { Ban, Download, ExternalLink, Eye, Loader2, MoreHorizontal, PenLine, RotateCw, Send } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
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
import type { AgreementRowV2, AgreementStatusV2 } from "@/lib/agreements-v2/types";

const Blank = () => <span className="text-muted-foreground">—</span>;

/* ══════════════════════════════════════════════════════════════════════════
   The Agreements v2 list
   ══════════════════════════════════════════════════════════════════════════ */

/** The three statuses as the list prints them (D16), and their hue. */
export const AGREEMENT_STATUS_LABEL_V2: Record<AgreementStatusV2, string> = {
  signed: "Signed",
  pending: "Pending signature",
  failed: "Failed",
};

export const AGREEMENT_STATUS_TONE_LIST_V2: Record<AgreementStatusV2, ListTone> = {
  signed: "success",
  pending: "warning",
  failed: "danger",
};

/**
 * "Sep 21, 3:04 PM", with the year only when it is not this one: the date and
 * time format the v2 records use (`vehicles-v2/kit.tsx` fmtDateTime), in the
 * operator's own zone. A 12-hour clock with AM/PM, as the team lead asked.
 */
export function formatAgreementSentAtV2(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * What a row's menu offers, by status (D17).
 *
 *   View      always: the document that was sent, or for one that never went
 *             out, the reason it did not (never "No document").
 *   Download  once signed: the signed PDF.
 *   Resend    while it is waiting or after it failed, for someone allowed to
 *             send. A signed agreement is done; re-issuing a signed rental's
 *             terms is the rental's own "Send an updated agreement".
 *
 * Resend needs a name and an email to address the new copy to, exactly as the
 * rental's Agreement stage does.
 */
export function agreementRowActionsV2(
  row: Pick<AgreementRowV2, "status" | "customerEmail" | "customerName">,
  canResend: boolean,
): { view: true; download: boolean; resend: boolean } {
  return {
    view: true,
    download: row.status === "signed",
    resend: canResend && row.status !== "signed" && !!row.customerEmail && !!row.customerName,
  };
}

/**
 * One action, in the row, as an icon.
 *
 * `title` AND `aria-label` carry the same sentence: the tooltip is the only
 * thing a sighted operator has to tell Resend from Download, since the icons
 * lost their menu labels, and the label is what assistive tech reads. They say
 * who the row is about ("Resend the agreement to Haseeb") because a column of
 * identical icons is otherwise ambiguous once it is read out of context.
 *
 * Busy swaps the icon for a spinner and disables the button, which is what the
 * menu items did — the difference is that the spinner is now on the action that
 * is actually running rather than on a shared trigger, so two rows resending at
 * once are distinguishable.
 */
function RowIconAction({
  label,
  icon: Icon,
  busy,
  onClick,
}: {
  label: string;
  icon: typeof Eye;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={LIST_ROW_ACTION}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
    </Button>
  );
}

export function AgreementsListTableV2({
  rows,
  resetKey,
  canResend,
  viewingId,
  downloadingId,
  resendingId,
  onView,
  onDownload,
  onResend,
}: {
  /** Every filtered agreement, newest first, already in memory. */
  rows: AgreementRowV2[];
  /** Changes with the result set (tenant, search, filters), never on a refetch. */
  resetKey: string;
  /** False for a view-only viewer: no Resend anywhere. */
  canResend: boolean;
  viewingId: string | null;
  downloadingId: string | null;
  resendingId: string | null;
  onView: (row: AgreementRowV2) => void;
  onDownload: (row: AgreementRowV2) => void;
  /** Asks first: the page confirms before a resend spends a credit. */
  onResend: (row: AgreementRowV2) => void;
}) {
  const agreementRows = useProgressiveRows(rows, resetKey);
  const now = new Date();

  return (
    <>
      {/* Not `fillViewport`: this list sits under the templates section, so
          the room left in the window beneath its top is usually none, and the
          fill would clamp it to its 320px floor. The kit's 520px box it is.
          Customer takes the most room and truncates with a title; the email
          truncates too. Sent holds "Sep 21, 2025, 12:45 PM" whole and Status
          "Pending signature" whole. */}
      <ListTable rows={agreementRows} minWidth="min-w-[760px]">
        <ListTableHeader>
          <ListHead className="w-[30%]">Customer</ListHead>
          <ListHead className="w-[30%]">Email</ListHead>
          <ListHead className="w-[19%]">Sent</ListHead>
          <ListHead className="w-[13%]">Status</ListHead>
          {/* 10%, not 6%: the actions are two icon buttons in the row now, not
              one ⋯ trigger, and two 32px buttons do not fit 6% of the 760px
              floor (~46px). Taken from Status, which holds its longest value
              ("Pending signature") in 13%. */}
          <ListHead className="w-[10%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {agreementRows.visible.map((row) => {
            const actions = agreementRowActionsV2(row, canResend);
            const isViewing = viewingId === row.id;
            const isDownloading = downloadingId === row.id;
            const isResending = resendingId === row.id;
            const who = row.customerName || row.customerEmail || "this agreement";

            return (
              <ListRow key={row.id} data-agreement-kind={row.kind} data-agreement-status={row.status}>
                <ListCell>
                  <span
                    className={`block truncate ${LIST_CLASSES.identifier}`}
                    title={row.title ? `${row.customerName} · ${row.title}` : row.customerName}
                  >
                    {row.customerName || <Blank />}
                  </span>
                  {/* A rental row names its rental; an individual one says so. */}
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.kind === "rental" ? row.rentalRef || "Rental" : "Individual"}
                  </span>
                </ListCell>
                <ListCell>
                  {row.customerEmail ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={row.customerEmail}>
                      {row.customerEmail}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={LIST_CLASSES.text}>{formatAgreementSentAtV2(row.sentAt, now)}</span>
                </ListCell>
                {/* Never truncated: a cut status is a different status. */}
                <ListCell>
                  <ListStatusText tone={AGREEMENT_STATUS_TONE_LIST_V2[row.status]}>
                    {AGREEMENT_STATUS_LABEL_V2[row.status]}
                  </ListStatusText>
                </ListCell>
                {/* The actions are IN the row, not behind a ⋯ menu.
                    A row never has more than two: View is always there, and
                    Download and Resend are mutually exclusive by status
                    (`agreementRowActionsV2` — Download once signed, Resend only
                    while it is not). So the whole menu was one click standing
                    between the operator and a choice of at most two, in a
                    column with room for both. */}
                <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-0.5">
                    <RowIconAction
                      label={`View the agreement for ${who}`}
                      icon={Eye}
                      busy={isViewing}
                      onClick={() => onView(row)}
                    />
                    {actions.download && (
                      <RowIconAction
                        label={`Download the signed PDF for ${who}`}
                        icon={Download}
                        busy={isDownloading}
                        onClick={() => onDownload(row)}
                      />
                    )}
                    {actions.resend && (
                      <RowIconAction
                        label={`Resend the agreement to ${who}`}
                        icon={RotateCw}
                        busy={isResending}
                        onClick={() => onResend(row)}
                      />
                    )}
                  </div>
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      {/* No `serverTotal`: the list hook reads every row for the tenant. */}
      <ListFooter rows={agreementRows} one="agreement" many="agreements" />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The older table (v1 page, useV2("chrome") branch)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The fields the older chrome-branch table reads. The v1 page's own
 * `AgreementDoc` satisfies it. Named apart from the Agreements v2 row
 * (`AgreementRowV2` in lib/agreements-v2/types.ts), which is a different shape.
 */
export interface AgreementDocRowV2 {
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
const agreementStatusLabelV2 = (doc: AgreementDocRowV2, justSigned: boolean): string =>
  justSigned || doc.status === "completed" || doc.status === "signed"
    ? "Signed"
    : doc.isRentalAgreement
    ? "Pending signature"
    : "Signed";

const AGREEMENT_STATUS_TONE_V2: Record<string, ListTone> = {
  signed: "success",
  "pending signature": "warning",
};

/**
 * The older table, for the v1 page's `useV2("chrome")` branch only. See the
 * file header. Every action is v1's, calling the page's own handlers under
 * v1's own conditions. v1 can put five buttons in a row (Sign, View, Download,
 * Resend, Void), so Sign stays inline and the rest move into the row's "⋯"
 * menu. While any of a row's menu actions is in flight the trigger itself
 * spins. The progressive-rows hook lives HERE, not on the page, because the
 * page returns early while its three queries load.
 */
export function AgreementsTableV2<T extends AgreementDocRowV2>({
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
                        <DropdownMenuContent align="end" className="w-auto">
                          <DropdownMenuItem
                            onClick={() => onDownloadFile(doc.file_url!, doc.file_name || doc.document_name)}
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onOpenFile(doc.file_url!)}>
                            <ExternalLink className="h-4 w-4" />
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
                          <DropdownMenuContent align="end" className="w-auto">
                            <DropdownMenuItem onClick={() => onView(doc)} disabled={isViewing}>
                              {isViewing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                              View document
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onDownload(doc)} disabled={isDownloading}>
                              {isDownloading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                              Download document
                            </DropdownMenuItem>
                            {canResendOrVoid && (
                              <>
                                <DropdownMenuItem onClick={() => onResend(doc)} disabled={isResending}>
                                  {isResending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Send className="h-4 w-4" />
                                  )}
                                  Resend signing notification
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => onRequestVoid(doc)}
                                  disabled={isVoiding}
                                  className="text-destructive focus:text-destructive"
                                >
                                  {isVoiding ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Ban className="h-4 w-4" />
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
