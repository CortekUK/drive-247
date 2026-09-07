/**
 * ONE definition of "which notifications", used by the list and by its count.
 *
 * ── why this file exists ────────────────────────────────────────────────────
 *
 * The panel used to load 50 rows and then filter and count them in the browser.
 * That is wrong in two ways at once, and both were visible on screen:
 *
 *   - "All 50" was the LIMIT, not a total. The tenant had 65. Rentals said 17
 *     when the table held 32.
 *   - a browser-side filter over a paginated list shows "Critical 5" above the
 *     two criticals that happened to land on the loaded page.
 *
 * So the filter moved into the query, and the count became a real
 * `count: "exact"` over the SAME filter. `applyScope` + `applyFilter` are used
 * verbatim by both, which is what makes a pill's number a promise about the
 * rows underneath it rather than a second, quieter guess.
 *
 * ── the nullable columns are the whole difficulty ───────────────────────────
 *
 * `type`, `is_read`, `created_at` and `user_id` are ALL nullable on this table,
 * and SQL three-valued logic drops NULLs silently from `neq`, `not.in` and
 * `eq false`. Every predicate below therefore says what it wants NULL to do,
 * out loud. Getting this wrong does not error — it makes rows disappear, or
 * makes "Mark all as read" leave a badge that never clears.
 */

import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import {
  CATEGORISED_TYPES,
  CHAT_TYPE,
  CRITICAL_NAME_FRAGMENTS,
  CRITICAL_TYPES,
  CUSTOMER_TYPES,
  PAYMENT_TYPES,
  RENTAL_TYPES,
} from "@/components/notifications/taxonomy";

/** The pills, and the only values the panel may filter by. */
export type NotificationFilter =
  | "all"
  | "payments"
  | "rentals"
  | "customers"
  | "system"
  | "critical";

export const NOTIFICATION_FILTERS: { key: NotificationFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "payments", label: "Payments" },
  { key: "rentals", label: "Rentals" },
  { key: "customers", label: "Customers" },
  { key: "system", label: "System" },
  { key: "critical", label: "Critical" },
];

/* `any` on the builder generic: this file composes filters for one table and
   never reads a row, and the fully-typed PostgrestFilterBuilder generics would
   have to be threaded through every caller for no safety this file can use. */
type Q = PostgrestFilterBuilder<any, any, any, any, any>;

const list = (values: readonly string[]) => `(${values.join(",")})`;

/**
 * Tenant, audience, and "not a chat message" — the rules that hold for every
 * query the panel makes, including the counts and the two mutations.
 *
 * `user_id` is nullable and a NULL means BROADCAST — everybody on the tenant
 * sees it — so it is an explicit `is.null`, not an omission.
 *
 * `type` is nullable too, and `type.neq.chat_message` would drop a NULL-typed
 * row on the floor: in SQL, `NULL <> 'x'` is NULL, which is not TRUE, which
 * means "not returned". A row with no type is not a chat message and must stay.
 */
export function applyScope<T extends Q>(query: T, tenantId: string, userId: string): T {
  return query
    .eq("tenant_id", tenantId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .or(`type.is.null,type.neq.${CHAT_TYPE}`) as T;
}

/**
 * The pill, as a database predicate. Each branch is the exact counterpart of
 * `categoryOf` / `severityOf`, and the test file asserts that pairing for every
 * known type rather than leaving it to reviewers to spot.
 */
export function applyFilter<T extends Q>(query: T, filter: NotificationFilter): T {
  switch (filter) {
    case "payments":
      return query.in("type", PAYMENT_TYPES as unknown as string[]) as T;
    case "rentals":
      return query.in("type", RENTAL_TYPES as unknown as string[]) as T;
    case "customers":
      return query.in("type", CUSTOMER_TYPES as unknown as string[]) as T;
    case "system":
      /* System is the COMPLEMENT of the three categories — including a NULL
         type, which `not.in` alone would silently exclude. `categoryOf` sends
         both an unknown type and a NULL one here, so the query must too, or
         the pill would count rows the list cannot show. */
      return query.or(`type.is.null,type.not.in.${list(CATEGORISED_TYPES)}`) as T;
    case "critical":
      /* Named criticals OR anything whose type SAYS it failed. One `or`, not a
         union of two queries, so a type that is both (`deposit_hold_failure`
         contains "fail") is matched once and counted once. */
      return query.or(
        [
          `type.in.${list(CRITICAL_TYPES)}`,
          ...CRITICAL_NAME_FRAGMENTS.map((f) => `type.ilike.*${f}*`),
        ].join(","),
      ) as T;
    case "all":
    default:
      return query;
  }
}

/**
 * Unread, said in a way that survives a NULL.
 *
 * `is_read` is nullable, and the old code asked for `.eq("is_read", false)`.
 * That matches FALSE and nothing else, so a NULL-read row was never counted as
 * unread — and, worse, "Mark all as read" never updated it, which is a badge
 * that cannot be cleared by the button offered for clearing it.
 */
export function applyUnread<T extends Q>(query: T): T {
  return query.or("is_read.is.null,is_read.eq.false") as T;
}
