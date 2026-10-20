"use client";

/**
 * Agreements v2: the View dialog's activity log. Lives in
 * shared/portal-v2/agreements/activity.tsx (the customer portal's drawer shows
 * the same timeline); this binds it to the operator's `history` call.
 */

import { AgreementActivity } from "../../../../../shared/portal-v2/agreements/activity";
import { fetchAgreementHistoryV2 } from "@/lib/agreements-v2/api-client";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";

export function AgreementActivityV2({ row, className }: { row: AgreementRowV2; className?: string }) {
  return <AgreementActivity row={row} fetchHistory={fetchAgreementHistoryV2} className={className} />;
}
