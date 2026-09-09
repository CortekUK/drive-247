'use client';

import { useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import { isLeanTenant } from '@/lib/lean-areas';

/**
 * The operator's own notes and timed reminders — the third card of the v2
 * dashboard's "On your desk" band.
 *
 * Backed by `public.tenant_notes` (ops/tenant_notes.sql, NOT YET APPLIED).
 *
 * ── SCOPE, and what is deliberately missing ──────────────────────────────────
 * A note the operator typed, and a reminder with a time beside it. That is all.
 * The card was also discussed as a home for urgent system events — a failed
 * agreement, a declined card — and that was explicitly parked in the same
 * meeting ("abhi ke liye sirf notes add kare aur apne reminder ke saath time
 * laga ke yahan rakh sake. Bas aur kuch nahi"). So this hook reads ONE table and
 * joins nothing. Deferred, not forgotten.
 *
 * ── THE FALLBACK IS THE POINT ────────────────────────────────────────────────
 * `tenant_notes` does not exist in production yet, and this ships before it. Any
 * read failure — missing table, RLS refusal, an outage, a malformed row —
 * resolves to an EMPTY LIST. Never an error, never a thrown query, never a
 * dashboard that will not paint because a card could not load.
 *
 * Empty, and specifically NOT the mock. `TODOS` in
 * components/dashboard-v2/home/mock.ts is five invented tasks; handing those to
 * a real operator would put work on their desk that they did not write, cannot
 * complete and cannot delete. An operator who has written nothing down is
 * supposed to see an empty card — that is the normal state on day one, and the
 * card is written to read as calm rather than broken.
 *
 * ── TENANT ISOLATION (V2_PLAN §5) ────────────────────────────────────────────
 * RLS is off on the core tables of this platform and isolation is enforced only
 * by application code. `tenant_notes` DOES have RLS, and it still gets an
 * explicit `.eq('tenant_id', tenant.id)` on the select, the insert, the update
 * and the delete — because policies here have been found inert before, and
 * because a super admin bypasses them by design. The application filter is the
 * boundary; the policy is the second lock.
 */

/** One row, as the card renders it. */
export interface TenantNote {
  id: string;
  body: string;
  /** The time on a reminder. `null` means this is just a note. */
  remind_at: string | null;
  is_done: boolean;
  completed_at: string | null;
  created_at: string;
}

/**
 * How many rows a single dashboard mount will read.
 *
 * The fetch is ordered `is_done` ascending FIRST, so open notes always come back
 * before completed ones and this ceiling can only ever truncate history. An
 * operator with 300 ticked-off notes loses the oldest ticked ones from the card,
 * never a piece of work still to do.
 */
const MAX_ROWS = 200;

/** A note is a line, not a document. Longer input is refused, not silently cut. */
export const MAX_NOTE_LENGTH = 500;

const SELECT_COLUMNS = 'id,body,remind_at,is_done,completed_at,created_at';

function toNote(row: Record<string, unknown>): TenantNote | null {
  if (typeof row.id !== 'string') return null;
  if (typeof row.body !== 'string' || row.body.trim().length === 0) return null;
  return {
    id: row.id,
    body: row.body,
    remind_at: typeof row.remind_at === 'string' ? row.remind_at : null,
    is_done: row.is_done === true,
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

/**
 * The order the card reads in, applied here so every consumer gets the same one.
 *
 *   1. Still to do, soonest first — anything with a time, because a timed thing
 *      is the one that gets missed.
 *   2. Still to do, untimed — newest first. A plain note has no deadline to
 *      sort by, so recency is the only honest order.
 *   3. Done — most recently ticked first, so an accidental tick is the first
 *      thing in reach to undo.
 */
function sortNotes(notes: TenantNote[]): TenantNote[] {
  return [...notes].sort((a, b) => {
    if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;

    if (a.is_done && b.is_done) {
      return (b.completed_at || b.created_at).localeCompare(a.completed_at || a.created_at);
    }

    const aTimed = a.remind_at !== null;
    const bTimed = b.remind_at !== null;
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    if (aTimed && bTimed) return (a.remind_at as string).localeCompare(b.remind_at as string);

    return b.created_at.localeCompare(a.created_at);
  });
}

export interface AddNoteInput {
  body: string;
  /** ISO 8601, or null for a plain note. */
  remindAt?: string | null;
}

/**
 * Is this failure "the table is not there yet"?
 *
 * `ops/tenant_notes.sql` is UNAPPLIED — the Supabase MCP has been unreachable,
 * so the table does not exist in any environment today. The read path already
 * treats that as an empty list, which is right. The WRITE path did not, and the
 * result was the one thing worse than an error: a composer that says
 * "Couldn't save that — try again" for a condition that RETRYING CAN NEVER FIX.
 * The operator types the note again, loses it again, and concludes the product
 * is broken rather than unfinished.
 *
 * Codes before message text: `42P01` is Postgres's `undefined_table`, and
 * `PGRST205` is PostgREST failing to find it in its schema cache. The string
 * match is the fallback for older PostgREST builds that sent neither. Same
 * shape as `isMissingTable` in `lib/dev-actions.ts`, which is not exported.
 */
export function isNotesTableMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const m = (error.message ?? '').toLowerCase();
  return m.includes('could not find the table') || m.includes('does not exist');
}

/** Thrown by the mutations so the card can tell this apart from a real failure. */
export const NOTES_UNAVAILABLE = 'NOTES_TABLE_MISSING';

export function useTenantNotes() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  /**
   * Latched once anything reports that `tenant_notes` is not in this database.
   *
   * A ref rather than state on purpose: it is written from inside a queryFn and
   * a mutationFn, and setting state there would re-render mid-flight. It is only
   * ever read during the next render, which the query's own settle already
   * causes, so nothing is missed.
   */
  const missingRef = useRef(false);

  /**
   * The canary gate (V2_PLAN §2), keyed on the tenant SLUG and never its id.
   *
   * Ungated, this would fire on every dashboard mount for all 57 tenants against
   * a table that exists on none of them — 56 operators paying a failing round
   * trip and a console warning per load, for a card only the canary is shown.
   * That exact bug was found in `use-first-run-questions.ts` this week; the
   * fallback is what made it survive review, because nothing visibly broke.
   *
   * Slug, not id: the same tenant has a different primary key in every
   * environment, so an id-keyed gate resolves the wrong way on localhost with no
   * error and no failed build.
   *
   * Fails CLOSED — an unresolved tenant reads nothing and gets an empty card.
   */
  const isCanary = isLeanTenant(tenant?.slug);
  const tenantId = tenant?.id;
  const enabled = isCanary && !!tenantId;

  const query = useQuery({
    // `tenant?.id` in the key is the repo convention and it is doing real work
    // here: these rows are per-tenant, so one cache entry per tenant is what
    // stops a tenant switch from painting the previous operator's notes.
    queryKey: ['tenant-notes', tenantId],
    enabled,
    queryFn: async (): Promise<TenantNote[]> => {
      const { data, error } = await (supabase as any)
        .from('tenant_notes')
        .select(SELECT_COLUMNS)
        // §5 — the only thing standing between two operators' notes.
        .eq('tenant_id', tenantId)
        // Open rows first, so MAX_ROWS can only truncate completed history.
        .order('is_done', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS);

      if (error) {
        // Includes "relation does not exist" until ops/tenant_notes.sql is
        // applied. Warned, never thrown: an empty card is the correct thing to
        // show an operator whose notes could not be read, and a dashboard must
        // not fail to paint because one card's table is missing.
        console.warn('[tenant-notes] could not read tenant_notes — showing an empty list.', error.message);
        // Remembered so the composer can be honest BEFORE the operator types
        // rather than after. A read runs on mount; a write only runs once they
        // have already committed a thought to the box.
        missingRef.current = isNotesTableMissing(error);
        return [];
      }

      return (data ?? [])
        .map((r: Record<string, unknown>) => toNote(r))
        .filter((n: TenantNote | null): n is TenantNote => n !== null);
    },
    // Notes change only when this operator changes them, and every mutation
    // below invalidates the key. Nothing else writes this table.
    staleTime: 60 * 1000,
    retry: false,
  });

  const notes = useMemo(() => sortNotes(query.data ?? []), [query.data]);
  const openCount = useMemo(() => notes.filter((n) => !n.is_done).length, [notes]);

  /** Every mutation ends here: re-read this tenant's list, and only this one. */
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tenant-notes', tenantId] });
  };

  /**
   * Mutations THROW on failure, deliberately, where the read swallows.
   *
   * The asymmetry is the whole contract. A read that fails should show nothing;
   * a write that fails must not look like it worked. The operator typed that
   * note — losing it silently is the one outcome this card cannot have — so the
   * caller catches, tells them, and keeps the draft text in the box.
   *
   * That applies to ALL THREE writes, not just the add. A refused tick and a
   * refused delete roll the cache back and would otherwise say nothing at all,
   * which is why the card awaits every one of them with `mutateAsync`.
   */
  const addNote = useMutation({
    mutationFn: async ({ body, remindAt = null }: AddNoteInput): Promise<void> => {
      if (!enabled || !tenantId) throw new Error('No tenant');

      const trimmed = body.trim();
      if (!trimmed) throw new Error('A note needs some text.');
      if (trimmed.length > MAX_NOTE_LENGTH) {
        throw new Error(`Keep it under ${MAX_NOTE_LENGTH} characters.`);
      }

      const { error } = await (supabase as any)
        .from('tenant_notes')
        .insert({
          tenant_id: tenantId, // §5 — stamped, never inferred by the database.
          body: trimmed,
          remind_at: remindAt,
          // Provenance only. Any of this tenant's staff can tick off or delete
          // any of its notes; this records who wrote it, it does not own it.
          created_by: appUser?.id ?? null,
        });

      // `{ error }` NEVER THROWS on its own — supabase-js hands failures back as
      // a value, so an unchecked insert here would look like a save and drop the
      // note on the floor. This throw is what the composer catches to keep the
      // operator's text in the box.
      if (error) {
        if (isNotesTableMissing(error)) {
          missingRef.current = true;
          throw new Error(NOTES_UNAVAILABLE);
        }
        throw error;
      }
    },
    onSuccess: invalidate,
  });

  const toggleDone = useMutation({
    mutationFn: async (note: TenantNote): Promise<void> => {
      if (!enabled || !tenantId) throw new Error('No tenant');

      const next = !note.is_done;
      const { error } = await (supabase as any)
        .from('tenant_notes')
        .update({
          is_done: next,
          completed_at: next ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', note.id)
        // §5 on the WRITE path, where getting it wrong is worse than on a read:
        // without this an id from anywhere would update another operator's row.
        .eq('tenant_id', tenantId);

      if (error) throw error;
    },
    /**
     * Ticking a box has to feel instant, so the cache moves first and rolls back
     * if the write is refused. The snapshot is taken AFTER `cancelQueries` so an
     * in-flight refetch cannot land on top of the optimistic state.
     */
    onMutate: async (note: TenantNote) => {
      await queryClient.cancelQueries({ queryKey: ['tenant-notes', tenantId] });
      const previous = queryClient.getQueryData<TenantNote[]>(['tenant-notes', tenantId]);
      queryClient.setQueryData<TenantNote[]>(['tenant-notes', tenantId], (rows) =>
        (rows ?? []).map((r) =>
          r.id === note.id
            ? {
                ...r,
                is_done: !note.is_done,
                completed_at: !note.is_done ? new Date().toISOString() : null,
              }
            : r,
        ),
      );
      return { previous };
    },
    /**
     * ROLLBACK IS HALF THE JOB. Putting the cache back is what stops the card
     * lying about the row; it is not what tells the operator. A tick that
     * un-ticks itself half a second later reads as a mis-click, so the caller
     * MUST report this — `reminders-card.tsx` awaits `mutateAsync` and shows the
     * refusal above the list. Firing this with `.mutate` swallows the rejection
     * and takes that message away with it.
     */
    onError: (_err, _note, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['tenant-notes', tenantId], context.previous);
      }
    },
    onSettled: invalidate,
  });

  const deleteNote = useMutation({
    mutationFn: async (note: TenantNote): Promise<void> => {
      if (!enabled || !tenantId) throw new Error('No tenant');

      const { error } = await (supabase as any)
        .from('tenant_notes')
        .delete()
        .eq('id', note.id)
        // §5 — a delete without this is the data-loss-grade version of the bug.
        .eq('tenant_id', tenantId);

      if (error) throw error;
    },
    onMutate: async (note: TenantNote) => {
      await queryClient.cancelQueries({ queryKey: ['tenant-notes', tenantId] });
      const previous = queryClient.getQueryData<TenantNote[]>(['tenant-notes', tenantId]);
      queryClient.setQueryData<TenantNote[]>(['tenant-notes', tenantId], (rows) =>
        (rows ?? []).filter((r) => r.id !== note.id),
      );
      return { previous };
    },
    /** Same contract as the tick above: restore the row, and let the caller say
     *  so. A note that reappears with no explanation is indistinguishable from
     *  one the operator never managed to delete. */
    onError: (_err, _note, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['tenant-notes', tenantId], context.previous);
      }
    },
    onSettled: invalidate,
  });

  return {
    notes,
    openCount,
    /**
     * `&& enabled` is belt and braces, and which library version you are on
     * decides whether it matters. Under React Query v5 a DISABLED query is
     * pending but never fetching, so `isLoading` is already false and a
     * non-canary tenant falls straight through to the empty list. Under v4 the
     * same query reports `isLoading: true` forever, which would leave the card
     * showing a skeleton that never resolves. Making the gate explicit costs
     * nothing and does not depend on which semantics are in force.
     */
    isLoading: query.isLoading && enabled,
    /** False for the 56 non-canary tenants and before the tenant resolves. */
    isEnabled: enabled,
    /**
     * The table is not in this database yet (`ops/tenant_notes.sql` unapplied).
     * The card uses this to stop offering a composer that cannot save, instead
     * of letting an operator type a note into something that will drop it.
     */
    isUnavailable: missingRef.current,
    addNote,
    toggleDone,
    deleteNote,
  };
}
