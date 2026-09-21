import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationSettingRow,
  type PushDisplayOptions,
} from "@/lib/notifications-v2/types";

/**
 * Notifications v2: the tenant's stored per-notification, per-channel settings
 * (table public.tenant_notification_settings, ops/notifications_v2.sql).
 *
 * One row per (tenant, notification_key, channel). A NULL column means "use the
 * catalog default", a missing row means "all defaults", and Reset is a DELETE
 * (lib/notifications-v2/settings-model.ts turns rows into what the page shows
 * and edits back into rows). v2 only: nothing in v1 imports this.
 *
 * Rules this hook keeps:
 *   - every query filters `.eq("tenant_id", tenant.id)` (V2_PLAN §5);
 *   - supabase-js never throws, so every `{ error }` is checked and thrown;
 *   - a missing table (the SQL is not applied yet) is NOT an error: the page
 *     gets `tableMissing: true` and empty rows, shows the catalog defaults, and
 *     Save explains that storage isn't switched on yet
 *     (`NotificationStorageMissingError`);
 *   - a write that silently changes fewer rows than asked (RLS filters rows
 *     instead of raising) is reported as a failure, never as a save.
 */

/** Table name, exported so tests and the SQL check agree on it. */
export const NOTIFICATION_SETTINGS_V2_TABLE = "tenant_notification_settings";

/** The upsert conflict target: the table's primary key. */
export const NOTIFICATION_SETTINGS_V2_CONFLICT = "tenant_id,notification_key,channel";

export const NOTIFICATION_SETTINGS_V2_COLUMNS =
  "tenant_id, notification_key, channel, enabled, subject, title, body, push_options, updated_at, updated_by";

/** The DB CHECK on notification_key (catalog keys). */
export const NOTIFICATION_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

export const notificationSettingsV2QueryKey = (tenantId: string | null | undefined) =>
  ["notification-settings-v2", tenantId] as const;

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

type DbError = { code?: string | null; message?: string | null; details?: string | null } | null | undefined;

/**
 * The table does not exist yet: PostgREST PGRST205 ("Could not find the table
 * ... in the schema cache"), or Postgres 42P01 ("relation ... does not exist").
 * A missing COLUMN (42703, "column ... does not exist") is a real error, not this.
 */
export function isMissingTableError(error: DbError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

/** Thrown by a save while the table is missing. Its message is safe to show as is. */
export class NotificationStorageMissingError extends Error {
  readonly code = "storage_missing";
  constructor(
    message = "Saving isn't switched on for your account yet. Your changes are still on this page.",
  ) {
    super(message);
    this.name = "NotificationStorageMissingError";
  }
}

/**
 * A PostgREST error as an Error the page can show as is. The two errors an
 * operator can cause get a plain sentence; anything else gets `fallback`. The
 * original error stays on `cause`, and its code on `code`, for callers that
 * branch on it.
 */
export function toOperatorError(error: NonNullable<DbError>, fallback: string): Error & { code?: string } {
  const code = error.code ? String(error.code) : undefined;
  let message = fallback;
  if (code === "42501" || /row-level security|permission denied/i.test(String(error.message ?? ""))) {
    message = "You don't have permission to change notifications. Ask an admin.";
  } else if (code === "23514") {
    message = "Something in these settings isn't allowed, like text that's too long. Check it and try again.";
  }
  const e = new Error(message, { cause: error }) as Error & { code?: string };
  if (code) e.code = code;
  return e;
}

/* -------------------------------------------------------------------------- */
/* Row shaping                                                                 */
/* -------------------------------------------------------------------------- */

const PUSH_OPTION_KEYS = ["requireInteraction", "silent", "replacePrevious", "openInApp"] as const;

function isChannel(value: unknown): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly unknown[]).includes(value);
}

/** Only the known push options that hold a boolean. */
function cleanPushOptions(value: unknown): PushDisplayOptions {
  const out: PushDisplayOptions = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const v = value as Record<string, unknown>;
  for (const key of PUSH_OPTION_KEYS) if (typeof v[key] === "boolean") out[key] = v[key] as boolean;
  return out;
}

const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A stored row as the page expects it; rows for another tenant or channel are dropped. */
export function normaliseSettingRows(data: unknown, tenantId: string): NotificationSettingRow[] {
  if (!Array.isArray(data)) return [];
  const rows: NotificationSettingRow[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (!raw || raw.tenant_id !== tenantId || !isChannel(raw.channel)) continue;
    if (typeof raw.notification_key !== "string") continue;
    rows.push({
      tenant_id: tenantId,
      notification_key: raw.notification_key,
      channel: raw.channel,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
      subject: textOrNull(raw.subject),
      title: textOrNull(raw.title),
      body: textOrNull(raw.body),
      push_options: raw.channel === "push" ? cleanPushOptions(raw.push_options) : {},
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : undefined,
      updated_by: typeof raw.updated_by === "string" ? raw.updated_by : null,
    });
  }
  return rows;
}

/** What `saveRows` / `resetRows` accept to name one row (tenant_id is optional; the hook's tenant is used). */
export interface NotificationSettingRef {
  notification_key: string;
  /** Omitted = every channel of that notification. */
  channel?: NotificationChannel;
  tenant_id?: string;
}

/** `{ upserts, deletes }` exactly as settings-model's `diffEdits` returns it. */
export interface NotificationSettingsWrite {
  upserts?: readonly NotificationSettingRow[] | null;
  deletes?: readonly NotificationSettingRef[] | null;
}

type RefInput = NotificationSettingRef | string;

const pairKey = (key: string, channel: NotificationChannel) => key + ":" + channel;

/**
 * Accepts `{ notification_key, channel? }` objects, or strings: "key:channel"
 * (settings-model `settingKey`) for one channel, "key" for all of them.
 */
export function expandSettingRefs(refs: readonly RefInput[] | null | undefined): { key: string; channel: NotificationChannel }[] {
  const out = new Map<string, { key: string; channel: NotificationChannel }>();
  const add = (key: string, channel?: string | null) => {
    if (channel != null && channel !== "" && !isChannel(channel)) {
      throw new Error(`"${channel}" isn't a notification channel.`);
    }
    const channels = channel ? [channel as NotificationChannel] : [...NOTIFICATION_CHANNELS];
    for (const c of channels) out.set(pairKey(key, c), { key, channel: c });
  };
  for (const ref of refs ?? []) {
    if (typeof ref === "string") {
      const i = ref.lastIndexOf(":");
      if (i > 0) add(ref.slice(0, i), ref.slice(i + 1));
      else add(ref);
    } else if (ref && typeof ref.notification_key === "string") {
      add(ref.notification_key, ref.channel ?? null);
    }
  }
  return [...out.values()];
}

function assertKey(key: string): void {
  if (!NOTIFICATION_KEY_PATTERN.test(key)) {
    throw new Error(`"${key}" isn't a notification this page can save.`);
  }
}

/**
 * The rows to upsert: every column written explicitly (a column left out of a
 * bulk upsert would otherwise be sent as NULL for that row anyway, but
 * silently), push_options {} off the push channel (the table CHECK), the
 * hook's tenant stamped on, and the last row per (key, channel) kept, since
 * Postgres refuses to touch one row twice in a single upsert.
 */
export function prepareUpserts(
  rows: readonly Partial<NotificationSettingRow>[] | null | undefined,
  tenantId: string,
): Omit<NotificationSettingRow, "updated_at" | "updated_by">[] {
  const byKey = new Map<string, Omit<NotificationSettingRow, "updated_at" | "updated_by">>();
  for (const row of rows ?? []) {
    if (!row) continue;
    if (row.tenant_id && row.tenant_id !== tenantId) {
      throw new Error("These settings belong to another account. Refresh the page and try again.");
    }
    const key = String(row.notification_key ?? "");
    assertKey(key);
    if (!isChannel(row.channel)) throw new Error(`"${String(row.channel)}" isn't a notification channel.`);
    byKey.set(pairKey(key, row.channel), {
      tenant_id: tenantId,
      notification_key: key,
      channel: row.channel,
      enabled: typeof row.enabled === "boolean" ? row.enabled : null,
      subject: row.channel === "email" ? textOrNull(row.subject) : null,
      title: row.channel === "email" ? null : textOrNull(row.title),
      body: textOrNull(row.body),
      push_options: row.channel === "push" ? cleanPushOptions(row.push_options) : {},
    });
  }
  return [...byKey.values()];
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

interface SettingsData {
  rows: NotificationSettingRow[];
  tableMissing: boolean;
}

const EMPTY_ROWS: NotificationSettingRow[] = [];

export function useNotificationSettingsV2() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const tenantId = tenant?.id ?? null;
  const queryKey = notificationSettingsV2QueryKey(tenantId);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<SettingsData> => {
      const { data, error } = await (supabase as any)
        .from(NOTIFICATION_SETTINGS_V2_TABLE)
        .select(NOTIFICATION_SETTINGS_V2_COLUMNS)
        .eq("tenant_id", tenantId);
      if (error) {
        if (isMissingTableError(error)) return { rows: [], tableMissing: true };
        throw toOperatorError(error, "Couldn't load your notification settings. Try again in a moment.");
      }
      return { rows: normaliseSettingRows(data, tenantId as string), tableMissing: false };
    },
    enabled: !!tenant,
    retry: 1,
  });

  /** Deletes the given rows, and fails if one we know exists was not really removed. */
  const deleteRefs = useCallback(
    async (refs: { key: string; channel: NotificationChannel }[], known: NotificationSettingRow[]) => {
      if (refs.length === 0) return;
      const byChannel = new Map<NotificationChannel, string[]>();
      for (const { key, channel } of refs) {
        assertKey(key);
        byChannel.set(channel, [...(byChannel.get(channel) ?? []), key]);
      }
      const removed = new Set<string>();
      for (const [channel, keys] of byChannel) {
        const { data, error } = await (supabase as any)
          .from(NOTIFICATION_SETTINGS_V2_TABLE)
          .delete()
          .eq("tenant_id", tenantId)
          .eq("channel", channel)
          .in("notification_key", keys)
          .select("notification_key, channel");
        if (error) {
          // Nothing stored = nothing to reset.
          if (isMissingTableError(error)) return;
          throw toOperatorError(error, "Couldn't reset your notification settings. Try again in a moment.");
        }
        for (const r of (data ?? []) as { notification_key: string; channel: NotificationChannel }[]) {
          removed.add(pairKey(r.notification_key, r.channel));
        }
      }
      // RLS filters a DELETE it does not allow instead of raising, so a row we
      // know exists and did not come back is a refusal, not a success.
      const stillThere = refs.filter(
        ({ key, channel }) =>
          known.some((r) => r.notification_key === key && r.channel === channel) && !removed.has(pairKey(key, channel)),
      );
      if (stillThere.length > 0) {
        throw new Error(
          "Some settings couldn't be reset. You may not have permission to change notifications. Refresh the page and try again.",
        );
      }
    },
    [tenantId],
  );

  const saveMutation = useMutation({
    mutationFn: async ({ upserts, deletes }: { upserts: readonly Partial<NotificationSettingRow>[]; deletes: readonly RefInput[] }) => {
      if (!tenantId) throw new Error("Your account details haven't loaded yet. Try again in a moment.");
      const rows = prepareUpserts(upserts, tenantId);
      const upserted = new Set(rows.map((r) => pairKey(r.notification_key, r.channel)));
      // A (key, channel) both saved and reset in one call: the save wins.
      const toDelete = expandSettingRefs(deletes).filter(({ key, channel }) => !upserted.has(pairKey(key, channel)));
      const known = query.data?.rows ?? EMPTY_ROWS;

      try {
        if (rows.length > 0) {
          const { data, error } = await (supabase as any)
            .from(NOTIFICATION_SETTINGS_V2_TABLE)
            .upsert(rows, { onConflict: NOTIFICATION_SETTINGS_V2_CONFLICT })
            .select("notification_key, channel");
          if (error) {
            if (isMissingTableError(error)) throw new NotificationStorageMissingError();
            throw toOperatorError(error, "Couldn't save your notification settings. Try again in a moment.");
          }
          const saved = Array.isArray(data) ? data.length : 0;
          if (saved !== rows.length) {
            throw new Error(
              `Only ${saved} of ${rows.length} notification settings were saved. Refresh the page and try again.`,
            );
          }
        }
        await deleteRefs(toDelete, known);
      } finally {
        // Re-read either way, so the page shows what is really stored.
        await queryClient.invalidateQueries({ queryKey: notificationSettingsV2QueryKey(tenantId) });
      }
    },
  });

  const { mutateAsync } = saveMutation;

  /**
   * Saves the page's edits. Takes settings-model's `diffEdits` result as is
   * (`saveRows({ upserts, deletes })`), or the two lists separately
   * (`saveRows(upserts, deletes)`). Upserts on the primary key and checks every
   * row came back; deletes are filtered by tenant, key and channel. Rejects with
   * an Error whose message can be shown to the operator.
   */
  const saveRows = useCallback(
    (
      rowsOrWrite: readonly Partial<NotificationSettingRow>[] | NotificationSettingsWrite | null | undefined,
      deletes?: readonly RefInput[] | null,
    ): Promise<void> => {
      if (Array.isArray(rowsOrWrite)) return mutateAsync({ upserts: rowsOrWrite, deletes: deletes ?? [] });
      const write = (rowsOrWrite ?? {}) as NotificationSettingsWrite;
      return mutateAsync({ upserts: write.upserts ?? [], deletes: write.deletes ?? [] });
    },
    [mutateAsync],
  );

  /**
   * Back to defaults: deletes the rows. Each ref is `{ notification_key,
   * channel }`, "key:channel", or just the key (every channel of it).
   */
  const resetRows = useCallback(
    (keys: readonly RefInput[] | null | undefined): Promise<void> => mutateAsync({ upserts: [], deletes: keys ?? [] }),
    [mutateAsync],
  );

  return {
    rows: query.data?.rows ?? EMPTY_ROWS,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    tableMissing: query.data?.tableMissing === true,
    refetch: query.refetch,
    saveRows,
    resetRows,
    isSaving: saveMutation.isPending,
  };
}
