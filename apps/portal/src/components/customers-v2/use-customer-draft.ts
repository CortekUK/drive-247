"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — editing without a Save button.
 *
 * The record already exists. There is nothing to submit, no draft to discard
 * and no half-created row to lose, so asking an operator to press Save after
 * correcting a phone number is asking them to confirm a decision they already
 * made. This hook is what makes "it applies as you type" true rather than a
 * slogan:
 *
 *   1. the change lands in the React Query cache immediately, so the middle
 *      column and the right-hand rail both move on the keystroke;
 *   2. the write is debounced, so a fifteen-character name is one UPDATE and
 *      not fifteen;
 *   3. a failed write says so and re-reads the row, so the screen never keeps
 *      showing a value the database refused.
 *
 * ⚠️ EVERY write carries `tenant_id`.
 *
 * RLS is disabled on `customers` (V2_PLAN §5): the policies exist but are
 * inert, so `.eq("id", …)` alone is a query that will happily update another
 * tenant's row if an id is ever guessed, mistyped or replayed. The v1 page's
 * inline name and date-of-birth edits do exactly that today. The guard below is
 * the only thing standing between this screen and a cross-tenant write, so it
 * is applied once, here, where it cannot be forgotten per call site.
 * ────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import type { EditableColumn } from "./types";

export type CustomerPatch = Partial<Record<EditableColumn, string | boolean | null>>;

/** Columns typed as `date`/`timestamptz`, where "" is not a legal value. */
const NULLABLE_WHEN_BLANK = new Set<EditableColumn>(["date_of_birth", "sms_consent_at", "rejected_at"]);

const normalise = (patch: CustomerPatch): CustomerPatch => {
  const out: CustomerPatch = {};
  (Object.keys(patch) as EditableColumn[]).forEach((k) => {
    const v = patch[k];
    out[k] = NULLABLE_WHEN_BLANK.has(k) && v === "" ? null : v;
  });
  return out;
};

/** How long to wait after the last keystroke before writing. */
const DEBOUNCE_MS = 700;

export function useCustomerDraft(id: string) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  /** Accumulated but not yet written. Merged, so the last value of each field wins. */
  const queued = useRef<CustomerPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowKey = ["customer-v2-row", tenant?.id, id] as const;

  const flush = useCallback(async () => {
    const patch = queued.current;
    queued.current = {};
    if (Object.keys(patch).length === 0 || !tenant?.id) return;

    setSaving(true);
    const { error } = await (supabase as any)
      .from("customers")
      .update(patch)
      .eq("id", id)
      // The tenant guard. See the note at the top of this file — without it
      // this is a cross-tenant write, not a slow one.
      .eq("tenant_id", tenant.id);
    setSaving(false);

    if (error) {
      toast({
        title: "That change did not save",
        description: error.message || "The record has been reloaded so you can see where it actually stands.",
        variant: "destructive",
      });
      // Never leave a value on screen the database rejected.
      queryClient.invalidateQueries({ queryKey: rowKey });
      return;
    }

    setSavedAt(Date.now());
    // Other screens read this customer through the v1 keys. They are not
    // invalidated on every keystroke — only once a write actually lands.
    queryClient.invalidateQueries({ queryKey: ["customer", id] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["customers-list"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tenant?.id, queryClient, toast]);

  const set = useCallback(
    (patch: CustomerPatch) => {
      if (!tenant?.id) return;
      const clean = normalise(patch);

      // 1. On screen immediately. `useCustomerRecord` reads this cache entry,
      //    so both columns and the rail move on the keystroke.
      queryClient.setQueryData(rowKey, (prev: any) => (prev ? { ...prev, ...clean } : prev));

      // 2. Queued for one write.
      queued.current = { ...queued.current, ...clean };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [flush, queryClient, tenant?.id, id]
  );

  /** Don't lose the last keystroke to a navigation. */
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    [flush]
  );

  return { set, saving, savedAt };
}
