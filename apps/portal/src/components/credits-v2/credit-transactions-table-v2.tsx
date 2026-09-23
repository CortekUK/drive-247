"use client";

/**
 * v2 (northwind): the Transaction History table in `CreditsPanel`, built from
 * the rentals list's kit (`components/shared/list-table-v2`). No pager and no
 * inner scroll box of its own: rows arrive 25 at a time as the table scrolls,
 * with one line under the card saying how much is shown.
 *
 * The progressive-rows hook lives here, not in the panel, because the panel
 * returns a skeleton early while the wallet loads, and the table sits inside a
 * folded `<details>`. Mounting the hook with its table mounts it with its
 * sentinel.
 *
 * Rows open nothing, as in v1: a transaction has no record page.
 * Amounts and balances are credits, not money, and print as v1 prints them.
 */

import type { CreditTransaction } from "@/hooks/use-credit-wallet";
import {
  LIST_CLASSES,
  LIST_TONES,
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

const Blank = () => <span className="text-muted-foreground">—</span>;

/**
 * `TransactionTypeBadge`'s labels, keyed on the lower-cased type. Tones keep
 * v1's hues where the kit has them: green Purchase, red Usage, blue Refund,
 * amber Auto-refill, muted Adjustment. v1's purple Gift has no kit tone; it
 * adds credits, as a purchase does, so it reads as success. Anything unknown
 * prints its raw type, muted, as v1 does.
 */
const TRANSACTION_TYPE_V2: Record<string, { label: string; tone: ListTone }> = {
  purchase: { label: "Purchase", tone: "success" },
  usage: { label: "Usage", tone: "danger" },
  refund: { label: "Refund", tone: "info" },
  gift: { label: "Gift", tone: "success" },
  auto_refill: { label: "Auto-refill", tone: "warning" },
  adjustment: { label: "Adjustment", tone: "muted" },
};

/**
 * v1's `formatDateTime` ("Sep 15, 02:30 PM"), with the year added when it is
 * not this year: up to 1,000 rows can reach back past January.
 */
const TX_DATE_V2: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
const formatTransactionDateV2 = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(
    "en-US",
    d.getFullYear() === new Date().getFullYear() ? TX_DATE_V2 : { ...TX_DATE_V2, year: "numeric" },
  );
};

export function CreditTransactionsTableV2({
  transactions,
  resetKey,
  serverTotal,
}: {
  /** Every row the panel holds, newest first. Not a page slice. */
  transactions: CreditTransaction[];
  /** Changes with the result set only: see `useProgressiveRows`. */
  resetKey: string;
  /** The tenant's full count, only when the 1,000-row fetch was capped. */
  serverTotal?: number;
}) {
  const transactionRows = useProgressiveRows(transactions, resetKey);

  return (
    <>
      <ListTable rows={transactionRows} minWidth="min-w-[720px]">
        <ListTableHeader>
          <ListHead className="w-[22%]">Date</ListHead>
          <ListHead className="w-[13%]">Type</ListHead>
          <ListHead className="w-[31%]">Description</ListHead>
          <ListHead className="w-[14%]">Category</ListHead>
          {/* Amount and Balance are the wallet's ledger: right-aligned so the
              digits stack under each other and a run of them can be scanned
              down the column. Their headings follow the numbers. */}
          <ListHead className="w-[10%] text-right">Amount</ListHead>
          <ListHead className="w-[10%] text-right">Balance</ListHead>
        </ListTableHeader>
        <ListBody>
          {transactionRows.visible.map((tx) => {
            const type = TRANSACTION_TYPE_V2[String(tx.type).toLowerCase()];
            const date = formatTransactionDateV2(tx.created_at);
            const amountTone: ListTone = tx.amount > 0 ? "success" : tx.amount < 0 ? "danger" : "muted";
            return (
              <ListRow key={tx.id}>
                <ListCell className="tabular-nums">
                  {date ? <span className={LIST_CLASSES.text}>{date}</span> : <Blank />}
                </ListCell>
                <ListCell>
                  <ListStatusText tone={type?.tone ?? "muted"}>{type?.label ?? tx.type}</ListStatusText>
                </ListCell>
                <ListCell>
                  {tx.description ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={tx.description}>
                      {tx.description}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {tx.category ? (
                    // `leading-none` only stops the 10px chip, baseline-aligned
                    // in a 14px line, from making its row 1px taller than a row
                    // with no category. The pill itself looks the same.
                    <span className="leading-none">
                      <ListMetaChip>{tx.category}</ListMetaChip>
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className={`text-right font-medium tabular-nums ${LIST_TONES[amountTone]}`}>
                  {tx.amount > 0 ? "+" : ""}
                  {tx.amount}
                </ListCell>
                <ListCell className="text-right tabular-nums">
                  <span className={LIST_CLASSES.text}>{tx.balance_after}</span>
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter rows={transactionRows} one="transaction" many="transactions" serverTotal={serverTotal} />
    </>
  );
}
