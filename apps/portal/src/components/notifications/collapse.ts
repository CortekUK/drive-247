/**
 * Collapsing a notification that was written twice.
 *
 * ── the finding this exists for ─────────────────────────────────────────────
 *
 * Northwind's 65 notifications contain 5 pairs whose title, message AND
 * `created_at` are identical TO THE MICROSECOND. That is not a retry seconds
 * later — it is one event inserted twice in a single operation. Showing both
 * shows the operator a duplicate and leaves them to work out that it is one.
 *
 * Two rows a minute apart are NOT collapsed. The same text at two different
 * times is two events, and hiding the second would be hiding news.
 *
 * ── why it lives here and not in the hook ───────────────────────────────────
 *
 * So it can be tested without a Supabase client, an auth store and a tenant
 * context coming along with it. The hook re-exports it.
 */

/** Just enough of a notification to collapse one. */
export interface CollapsibleNotification {
  id: string;
  title: string;
  message: string;
  is_read: boolean | null;
  created_at: string | null;
}

/** A row, plus how many identical notifications it stands for. */
export interface CollapsedRow<T extends CollapsibleNotification> {
  notification: T;
  duplicates: number;
}

export function collapse<T extends CollapsibleNotification>(rows: T[]): CollapsedRow<T>[] {
  const seenIds = new Set<string>();
  const byContent = new Map<string, CollapsedRow<T>>();
  const out: CollapsedRow<T>[] = [];

  for (const n of rows) {
    /* By id first, and for a reason unrelated to duplicates: offset pagination
       over a table that is still receiving inserts can hand the same row back
       on two different pages. */
    if (seenIds.has(n.id)) continue;
    seenIds.add(n.id);

    const key = `${n.created_at ?? ""}|${n.title}|${n.message}`;
    const existing = byContent.get(key);
    if (existing) {
      existing.duplicates += 1;
      /* An unread copy makes the survivor unread. The operator has not read
         this text, and collapsing must not be a way of marking it read. */
      if (!n.is_read && existing.notification.is_read) {
        existing.notification = { ...existing.notification, is_read: false };
      }
      continue;
    }

    const row: CollapsedRow<T> = { notification: n, duplicates: 1 };
    byContent.set(key, row);
    out.push(row);
  }

  return out;
}
