/**
 * Raw rows in, the whole Finances model out. Pure — the loader
 * (hooks/use-finances-data.ts) reads, this builds, and ./filters selects.
 */

import { buildAttention } from "./attention";
import { buildBills } from "./bills";
import { buildLookups } from "./lookups";
import { buildReceipts } from "./receipts";
import { buildUpcoming, planSeqLabels } from "./upcoming";
import type { FinanceContext, FinanceModel, FinanceRawData } from "./types";

export function buildFinanceModel(raw: FinanceRawData, ctx: FinanceContext): FinanceModel {
  const lk = buildLookups(raw);
  const labels = planSeqLabels(raw.occurrences);
  const bills = buildBills(raw, lk, ctx);
  const receipts = buildReceipts(raw, lk, labels, ctx);
  const upcoming = buildUpcoming(raw, lk, labels, ctx);
  const attention = buildAttention(raw, lk, receipts, labels, ctx);
  return { bills, receipts, upcoming, attention };
}

export const EMPTY_RAW: FinanceRawData = {
  rentals: [],
  charges: [],
  applications: [],
  payments: [],
  invoices: [],
  extensions: [],
  accruals: [],
  customers: [],
  vehicles: [],
  plans: [],
  occurrences: [],
  attempts: [],
};
