"use client";

/**
 * The Agreements list table, shared by both portals: the operator's
 * Agreements tab (agreements-table-v2.tsx `AgreementsListTableV2` draws this)
 * and the customer portal's Agreements page. On the shared list kit, so the
 * card, sticky heading row, micro-type, row height, hairlines and hover tint
 * are the operator lists' own.
 *
 * Six columns: who · Email · Linked to · Reference · Sent · Status. The first
 * two name the other party: the customer and their email on the operator's
 * side, the company and its main email on the customer's (`party`); the other
 * four are the same everywhere. The whole row opens the agreement, by click or
 * by Enter / Space.
 */

import type { HTMLAttributes, KeyboardEvent } from "react";
import { ListBody, ListCell, ListHead, ListRow, ListStatusText, ListTable, ListTableHeader, type ProgressiveRows } from "../list-table";
import { V2_LIST_CLASSES } from "../list-styles";
import {
  AGREEMENT_LINK_LABEL,
  AGREEMENT_STATUS_LABEL,
  AGREEMENT_STATUS_TONE,
  agreementReference,
  formatAgreementSentAt,
  type AgreementListRow,
} from "./list";

const Blank = () => <span className="text-v2-muted-fg">—</span>;

export interface AgreementPartyColumns<T> {
  /** The first heading: "Customer" (operator) or "Company" (customer). */
  label: string;
  name: (row: T) => string;
  email: (row: T) => string | null;
  /** The name cell's tooltip. */
  title?: (row: T) => string | undefined;
}

export function AgreementsTable<T extends AgreementListRow>({
  rows,
  party,
  onOpen,
  rowProps,
}: {
  /** The page's progressive rows over every filtered agreement. */
  rows: ProgressiveRows<T>;
  party: AgreementPartyColumns<T>;
  onOpen: (row: T) => void;
  /** Extra attributes per row (the operator's data markers and busy state). */
  rowProps?: (row: T) => HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | undefined>;
}) {
  const now = new Date();
  return (
    // Not `fillViewport`: the kit's 520px box, as on the operator's list. The
    // first column takes the most room and truncates with a title; the email
    // truncates too. Sent holds "Sep 21, 2025, 12:45 PM" whole.
    <ListTable rows={rows} minWidth="min-w-[920px]">
      <ListTableHeader>
        <ListHead className="w-[20%]">{party.label}</ListHead>
        <ListHead className="w-[25%]">Email</ListHead>
        <ListHead className="w-[12%]">Linked to</ListHead>
        <ListHead className="w-[12%]">Reference</ListHead>
        <ListHead className="w-[19%]">Sent</ListHead>
        <ListHead className="w-[12%]">Status</ListHead>
      </ListTableHeader>
      <ListBody>
        {rows.visible.map((row) => {
          const name = party.name(row);
          const email = party.email(row);
          const reference = agreementReference(row);
          const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onOpen(row);
            }
          };
          return (
            <ListRow
              key={row.id}
              onOpen={() => onOpen(row)}
              tabIndex={0}
              aria-label={`Open the agreement ${reference ?? ""}`.trim()}
              onKeyDown={onKeyDown}
              className="focus-visible:bg-v2-muted/60 focus-visible:outline-none"
              {...rowProps?.(row)}
            >
              <ListCell>
                <span className={`block truncate ${V2_LIST_CLASSES.identifier}`} title={party.title?.(row) ?? name}>
                  {name || <Blank />}
                </span>
              </ListCell>
              <ListCell>
                {email ? (
                  <span className={`block truncate ${V2_LIST_CLASSES.text}`} title={email}>
                    {email}
                  </span>
                ) : (
                  <Blank />
                )}
              </ListCell>
              <ListCell>
                <span className={V2_LIST_CLASSES.text}>{AGREEMENT_LINK_LABEL[row.kind]}</span>
              </ListCell>
              <ListCell className="tabular-nums">
                {reference ? (
                  <span className={`block truncate ${V2_LIST_CLASSES.text}`} title={row.kind === "individual" ? row.customerId ?? undefined : undefined}>
                    {reference}
                  </span>
                ) : (
                  <Blank />
                )}
              </ListCell>
              <ListCell className="tabular-nums">
                <span className={V2_LIST_CLASSES.text}>{formatAgreementSentAt(row.sentAt, now)}</span>
              </ListCell>
              {/* Never truncated: a cut status is a different status. */}
              <ListCell>
                <ListStatusText tone={AGREEMENT_STATUS_TONE[row.status]}>{AGREEMENT_STATUS_LABEL[row.status]}</ListStatusText>
              </ListCell>
            </ListRow>
          );
        })}
      </ListBody>
    </ListTable>
  );
}
