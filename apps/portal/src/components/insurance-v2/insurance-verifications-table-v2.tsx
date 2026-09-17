"use client";

/**
 * v2 (northwind): the /insurances AI Verifications tab's table, built from the
 * rentals list's kit (`components/shared/list-table-v2`). No pager (v1 had none
 * either): rows arrive 25 at a time as the table scrolls, with one line under
 * the card saying how much is shown.
 *
 * The progressive-rows hook lives HERE, with its table, which only mounts once
 * the verifications have loaded and at least one matches the search.
 *
 * The whole row opens the verification's detail sheet, as the v1 row does. The
 * rental link, the Attach button, the open-file link and Delete are v1's, with
 * the tab's own handlers (Delete still asks for confirmation first).
 *
 * v1's two-line "Insurer / Policy" cell is two one-line columns here, so rows
 * stay the height of a rentals row and a policy number is never cut off.
 */

import Link from "next/link";
import { format } from "date-fns";
import { ExternalLink, Link2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
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
import type { InsuranceVerification } from "@/hooks/use-insurance-verifications";

/**
 * VerificationStatusChip's words, as coloured text. Queued and Analyzing are
 * the AI still working (info); verified, flagged and rejected carry the score
 * as v1 does; a failed run reads "Error", as in v1, in the danger hue.
 */
function aiResultV2(status: string, score: number | null | undefined): { label: string; tone: ListTone } {
  const scored = (word: string) => (typeof score === "number" ? `${word} (${score})` : word);
  switch (status) {
    case "pending":
      return { label: "Queued", tone: "info" };
    case "processing":
      return { label: "Analyzing", tone: "info" };
    case "verified":
      return { label: scored("Verified"), tone: "success" };
    case "flagged":
      return { label: scored("Flagged"), tone: "warning" };
    case "rejected":
      return { label: scored("Rejected"), tone: "danger" };
    case "failed":
      return { label: "Error", tone: "danger" };
    default:
      return { label: "Error", tone: "muted" };
  }
}

const Blank = () => <span className="text-muted-foreground">—</span>;

export function InsuranceVerificationsTableV2({
  verifications,
  resetKey,
  onOpen,
  onAttach,
  onDelete,
}: {
  /** Every verification the search matches, in the query's order. */
  verifications: InsuranceVerification[];
  /** Changes with the result set (tenant, search) and never on a refetch. */
  resetKey: string;
  /** v1's row click: the detail sheet. */
  onOpen: (verification: InsuranceVerification) => void;
  /** v1's Attach button. */
  onAttach: (verificationId: string) => void;
  /** v1's Delete button, which confirms before deleting. */
  onDelete: (verificationId: string) => void;
}) {
  const verificationRows = useProgressiveRows(verifications, resetKey);

  return (
    <>
      <ListTable rows={verificationRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          {/* Widths, measured in Manrope on a 944px card. Policy number, AI
              result, Rental and Uploaded hold their longest values in full:
              "AGCS-2026-UK-00481234" (21 characters), "Flagged (100)",
              "R-WMWMWM", "May 28, 2026". Two action buttons fit. File and
              Insurer truncate, each with its full value in a title. */}
          <ListHead className="w-[17.5%]">File</ListHead>
          <ListHead className="w-[15.5%]">Insurer</ListHead>
          <ListHead className="w-[21.5%]">Policy number</ListHead>
          <ListHead className="w-[12.5%]">AI result</ListHead>
          <ListHead className="w-[12.5%]">Rental</ListHead>
          <ListHead className="w-[12%]">Uploaded</ListHead>
          <ListHead className="w-[8.5%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {verificationRows.visible.map((v) => {
            const ex = v.extracted_fields;
            const result = aiResultV2(v.status, v.ai_score);
            const rentalLabel = v.rental_id ? v.rentals?.rental_number || v.rental_id.slice(0, 8) : null;

            return (
              <ListRow key={v.id} onOpen={() => onOpen(v)}>
                <ListCell>
                  <span className={`block truncate ${LIST_CLASSES.identifier}`} title={v.file_name}>
                    {v.file_name}
                  </span>
                </ListCell>
                <ListCell>
                  {ex?.insurer ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={ex.insurer}>
                      {ex.insurer}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {ex?.policy_number ? (
                    <span className={`block truncate tabular-nums ${LIST_CLASSES.text}`} title={ex.policy_number}>
                      {ex.policy_number}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  <ListStatusText tone={result.tone}>{result.label}</ListStatusText>
                </ListCell>
                {/* The link and the Attach button must not also open the sheet. */}
                <ListCell onClick={(e) => e.stopPropagation()}>
                  {v.rental_id ? (
                    <Link
                      href={`/rentals/${v.rental_id}`}
                      className={`block truncate tabular-nums ${LIST_CLASSES.text} hover:underline`}
                      title={rentalLabel ?? undefined}
                    >
                      {rentalLabel}
                    </Link>
                  ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="-my-1.5 text-muted-foreground"
                      onClick={() => onAttach(v.id)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Attach
                    </Button>
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={LIST_CLASSES.text}>{format(new Date(v.created_at), "MMM dd, yyyy")}</span>
                </ListCell>
                {/* Opening the file and deleting must not also open the sheet. */}
                <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {v.file_url && (
                      <Button size="icon-sm" variant="ghost" className={LIST_ROW_ACTION} asChild>
                        <a href={v.file_url} target="_blank" rel="noreferrer" aria-label={`Open ${v.file_name}`}>
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="-my-1.5 h-8 w-8 text-red-600 hover:text-red-700"
                      aria-label={`Delete verification ${v.file_name}`}
                      onClick={() => onDelete(v.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter rows={verificationRows} one="verification" many="verifications" />
    </>
  );
}
