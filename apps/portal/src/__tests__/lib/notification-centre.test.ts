/**
 * The notification centre's logic, tested where it can go wrong silently.
 *
 * Three of these tests exist because of a specific bug that shipped:
 *
 *  - the pill counts and the list came from different code, so "Rentals 17"
 *    sat above a table holding 32. The counts are a database query now, and
 *    `filter agrees with taxonomy` is what stops the query and the labelling
 *    drifting apart again.
 *  - `created_at` is nullable and `formatDistanceToNow` throws on an Invalid
 *    Date, which is a blank panel rather than a blank date.
 *  - `is_read` is nullable, and `.eq("is_read", false)` misses NULL — a badge
 *    that "mark all as read" could not clear.
 */

import { describe, expect, it } from "vitest";
import {
  CATEGORISED_TYPES,
  CHAT_TYPE,
  CRITICAL_NAME_FRAGMENTS,
  CRITICAL_TYPES,
  CUSTOMER_TYPES,
  PAYMENT_TYPES,
  RENTAL_TYPES,
  categoryOf,
  dayBucket,
  isNotificationCentreType,
  parseDate,
  severityOf,
} from "@/components/notifications/taxonomy";
import {
  NOTIFICATION_FILTERS,
  applyFilter,
  applyScope,
  applyUnread,
} from "@/components/notifications/notification-filters";
import { collapse } from "@/components/notifications/collapse";

/* A PostgrestFilterBuilder stand-in that records what was asked of it. The
   point is not to test PostgREST — it is to pin the exact predicate strings, so
   a type added to `CRITICAL_TYPES` cannot start showing a red pill in the list
   while the Critical COUNT quietly keeps ignoring it. */
function fakeQuery() {
  const calls: string[] = [];
  const q: any = {
    calls,
    eq: (c: string, v: unknown) => (calls.push(`eq:${c}=${v}`), q),
    neq: (c: string, v: unknown) => (calls.push(`neq:${c}=${v}`), q),
    or: (s: string) => (calls.push(`or:${s}`), q),
    in: (c: string, v: readonly string[]) => (calls.push(`in:${c}=${v.join("|")}`), q),
    not: (c: string, op: string, v: string) => (calls.push(`not:${c}.${op}.${v}`), q),
  };
  return q;
}

const ALL_KNOWN = [...PAYMENT_TYPES, ...RENTAL_TYPES, ...CUSTOMER_TYPES, ...CRITICAL_TYPES];

describe("taxonomy: every declared type lands where its array says", () => {
  it.each(PAYMENT_TYPES)("%s is a payment", (t) => {
    expect(categoryOf(t)).toBe("payments");
  });
  it.each(RENTAL_TYPES)("%s is a rental", (t) => {
    expect(categoryOf(t)).toBe("rentals");
  });
  it.each(CUSTOMER_TYPES)("%s is a customer notification", (t) => {
    expect(categoryOf(t)).toBe("customers");
  });
  it.each(CRITICAL_TYPES)("%s is critical", (t) => {
    expect(severityOf(t)).toBe("critical");
  });

  it("has no type in two categories at once", () => {
    const seen = new Set<string>();
    for (const t of CATEGORISED_TYPES) {
      expect(seen.has(t), `${t} appears in more than one category`).toBe(false);
      seen.add(t);
    }
  });

  it("sends anything uncategorised to System rather than nowhere", () => {
    expect(categoryOf("some_type_invented_next_week")).toBe("system");
    expect(categoryOf("reminder_warning")).toBe("system");
    expect(categoryOf(null)).toBe("system");
    expect(categoryOf(undefined)).toBe("system");
    expect(categoryOf("")).toBe("system");
  });
});

describe("taxonomy: severity", () => {
  it("treats a type that SAYS it failed as critical, even unseen", () => {
    expect(severityOf("payment_failed")).toBe("critical");
    expect(severityOf("webhook_error")).toBe("critical");
    expect(severityOf("card_declined")).toBe("critical");
    expect(severityOf("URGENT_ACTION")).toBe("critical"); // case-insensitive
  });

  it("does not over-match the everyday types", () => {
    /* The whole reason the fragments are narrow: a pattern that catches
       `payment_received` makes every row shout, and then none of them do. */
    for (const t of ["payment_received", "webhook_received", "booking_new", "rental_started"]) {
      expect(severityOf(t)).toBe("normal");
    }
  });

  it("is normal for an absent type", () => {
    expect(severityOf(null)).toBe("normal");
    expect(severityOf(undefined)).toBe("normal");
  });

  it("keeps critical rare — the whole point of the pill", () => {
    const criticalShare = CATEGORISED_TYPES.filter((t) => severityOf(t) === "critical").length;
    expect(criticalShare).toBeLessThan(CATEGORISED_TYPES.length / 2);
  });
});

describe("chat is not a notification", () => {
  it("excludes chat_message and nothing else", () => {
    expect(isNotificationCentreType(CHAT_TYPE)).toBe(false);
    expect(isNotificationCentreType("booking_new")).toBe(true);
  });

  it("keeps a row with no type — nullable column, and it is not a chat message", () => {
    expect(isNotificationCentreType(null)).toBe(true);
    expect(isNotificationCentreType(undefined)).toBe(true);
  });
});

describe("dates: a bad timestamp costs its own row and nothing else", () => {
  it("refuses to parse what is not a date", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });

  it("parses a real timestamp", () => {
    expect(parseDate("2026-09-05T18:00:00Z")).toBeInstanceOf(Date);
  });

  it("buckets by day, and puts undated rows where they already sort", () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 26 * 3600 * 1000);
    const lastWeek = new Date(now.getTime() - 8 * 86400 * 1000);
    expect(dayBucket(now.toISOString())).toBe("today");
    expect(dayBucket(yesterday.toISOString())).toBe("yesterday");
    expect(dayBucket(lastWeek.toISOString())).toBe("earlier");
    expect(dayBucket(null)).toBe("earlier");
    expect(dayBucket("nonsense")).toBe("earlier");
  });
});

describe("the query says the same thing the labels do", () => {
  it("scopes every request to tenant, audience and not-chat", () => {
    const q = fakeQuery();
    applyScope(q, "tenant-1", "user-1");
    expect(q.calls).toContain("eq:tenant_id=tenant-1");
    /* A broadcast (user_id NULL) belongs to everyone on the tenant, so it is an
       explicit is.null rather than an omission. */
    expect(q.calls).toContain("or:user_id.eq.user-1,user_id.is.null");
    /* NOT `neq`: in SQL `NULL <> 'chat_message'` is NULL, which is not TRUE,
       which means a row with no type would silently vanish. */
    expect(q.calls).toContain(`or:type.is.null,type.neq.${CHAT_TYPE}`);
    expect(q.calls.some((c: string) => c.startsWith("neq:type"))).toBe(false);
  });

  it("filters each category by exactly the array the labels come from", () => {
    for (const [filter, types] of [
      ["payments", PAYMENT_TYPES],
      ["rentals", RENTAL_TYPES],
      ["customers", CUSTOMER_TYPES],
    ] as const) {
      const q = fakeQuery();
      applyFilter(q, filter);
      expect(q.calls).toEqual([`in:type=${types.join("|")}`]);
    }
  });

  it("asks for Critical with the same list AND the same fragments as severityOf", () => {
    const q = fakeQuery();
    applyFilter(q, "critical");
    const clause = q.calls[0] as string;
    expect(clause.startsWith("or:")).toBe(true);
    /* Every named critical type is in the predicate... */
    expect(clause).toContain(`type.in.(${CRITICAL_TYPES.join(",")})`);
    /* ...and so is every fragment, which is how a failure type invented after
       this file was written still lands in the Critical count. */
    for (const f of CRITICAL_NAME_FRAGMENTS) {
      expect(clause).toContain(`type.ilike.*${f}*`);
    }
    /* One `or`, not two queries: `deposit_hold_failure` matches the list AND
       "fail", and a union of two counts would have counted it twice. */
    expect(q.calls).toHaveLength(1);
  });

  it("defines System as the complement, including a NULL type", () => {
    const q = fakeQuery();
    applyFilter(q, "system");
    expect(q.calls).toEqual([`or:type.is.null,type.not.in.(${CATEGORISED_TYPES.join(",")})`]);
  });

  it("adds nothing for All", () => {
    const q = fakeQuery();
    applyFilter(q, "all");
    expect(q.calls).toEqual([]);
  });

  it("treats NULL as unread", () => {
    const q = fakeQuery();
    applyUnread(q);
    /* `.eq("is_read", false)` matched FALSE and nothing else, so a NULL-read
       row was never counted as unread and "mark all as read" never updated it —
       a badge the button offered for clearing it could not clear. */
    expect(q.calls).toEqual(["or:is_read.is.null,is_read.eq.false"]);
  });

  it("offers one pill per filter and no filter without a pill", () => {
    expect(NOTIFICATION_FILTERS.map((f) => f.key)).toEqual([
      "all", "payments", "rentals", "customers", "system", "critical",
    ]);
  });

  it("every type the query can match is a type the row can label", () => {
    /* The invariant that keeps a count and its rows honest: if the database
       returns it under a pill, `categoryOf`/`severityOf` must put it there too. */
    for (const t of ALL_KNOWN) {
      const cat = categoryOf(t);
      expect(["payments", "rentals", "customers", "system"]).toContain(cat);
      if ((CRITICAL_TYPES as readonly string[]).includes(t)) {
        expect(severityOf(t)).toBe("critical");
      }
    }
  });
});

describe("duplicates", () => {
  const row = (over: Partial<Parameters<typeof collapse>[0][number]> = {}) => ({
    id: Math.random().toString(36).slice(2),
    title: "Payment received",
    message: "Payment of $203.40 received for booking 9E34371A",
    is_read: true,
    created_at: "2026-09-05T18:14:00.000Z",
    ...over,
  });

  it("collapses the same notification written twice at the same instant", () => {
    /* The real pair from Northwind: identical title, message and created_at to
       the microsecond — one event inserted twice, not a retry. */
    const out = collapse([row(), row()]);
    expect(out).toHaveLength(1);
    expect(out[0].duplicates).toBe(2);
  });

  it("does NOT collapse the same text at a different time", () => {
    const out = collapse([row(), row({ created_at: "2026-09-05T18:15:00.000Z" })]);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.duplicates === 1)).toBe(true);
  });

  it("keeps the survivor unread if any copy was unread", () => {
    /* Otherwise collapsing would be a way of marking something read. */
    const out = collapse([row({ is_read: true }), row({ is_read: false })]);
    expect(out[0].notification.is_read).toBe(false);
  });

  it("drops a row repeated by id, which offset pagination will do", () => {
    const same = row();
    const out = collapse([same, { ...same }]);
    expect(out).toHaveLength(1);
    /* By id, so it is NOT counted as a duplicate sighting — the same row twice
       is a paging artefact, not a notification sent twice. */
    expect(out[0].duplicates).toBe(1);
  });

  it("preserves order and handles an empty list", () => {
    expect(collapse([])).toEqual([]);
    const a = row({ title: "A" }), b = row({ title: "B" }), c = row({ title: "C" });
    expect(collapse([a, b, c]).map((r) => r.notification.title)).toEqual(["A", "B", "C"]);
  });

  it("treats a null timestamp as its own key rather than throwing", () => {
    const out = collapse([row({ created_at: null }), row({ created_at: null })]);
    expect(out).toHaveLength(1);
    expect(out[0].duplicates).toBe(2);
  });
});
