'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type PlatformNotificationSettingRow,
  type PushDisplayOptions,
} from '@/lib/notifications-v2/types';

/**
 * Notifications v2, SYSTEM set: Drive247's own per-notification, per-channel
 * settings (table public.platform_notification_settings,
 * ops/notifications_v2_platform.sql).
 *
 * One row per (notification_key, channel). PLATFORM scope, so unlike the
 * portal's twin there is NO tenant_id: these settings are ours, the same for
 * every operator, and the whole primary key is (notification_key, channel). A
 * NULL column means "use the catalog default", a missing row means "all
 * defaults", and Reset is a DELETE (lib/notifications-v2/settings-model.ts turns
 * rows into what the page shows and edits back into rows).
 *
 * Rules this hook keeps:
 *   - supabase-js never throws, so every `{ error }` is checked and thrown;
 *   - a missing table (the SQL is not applied yet) is NOT an error: the page
 *     gets `tableMissing: true` and empty rows, shows the catalog defaults, and
 *     Save explains that storage isn't switched on yet
 *     (`PlatformNotificationStorageMissingError`);
 *   - a write that silently changes fewer rows than asked (RLS filters rows
 *     instead of raising) is reported as a failure, never as a save.
 *
 * WHY PLAIN STATE AND NOT REACT QUERY. apps/admin has @tanstack/react-query as a
 * dependency but mounts NO QueryClientProvider anywhere (app/layout.tsx and
 * app/admin/(protected)/layout.tsx provide Tooltip / Sidebar / SupportRail and
 * nothing else), so `useQuery` here throws "No QueryClient set" the moment the
 * component renders — components/admin/finance-events-tab.tsx is the one place
 * that does it and is a latent runtime error. hooks/use-platform-push.ts says
 * the same thing and uses plain useState/useEffect; this follows it, so the hook
 * works whether or not a provider is ever added. If a provider is added later,
 * the shape below (`rows`, `isLoading`, `error`, `refresh`, `saveRows`) ports to
 * useQuery/useMutation without touching a caller.
 */

/** Table name, exported so the page, the SQL and any test agree on it. */
export const PLATFORM_NOTIFICATION_SETTINGS_TABLE = 'platform_notification_settings';

/** The upsert conflict target: the table's primary key. */
export const PLATFORM_NOTIFICATION_SETTINGS_CONFLICT = 'notification_key,channel';

export const PLATFORM_NOTIFICATION_SETTINGS_COLUMNS =
  'notification_key, channel, enabled, subject, title, body, push_options, updated_at, updated_by';

/** The DB CHECK on notification_key (catalog keys). */
export const NOTIFICATION_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

type DbError = { code?: string | null; message?: string | null; details?: string | null } | null | undefined;

/**
 * The table does not exist yet: PostgREST PGRST205 ("Could not find the table
 * ... in the schema cache"), or Postgres 42P01 ("relation ... does not exist").
 * A missing COLUMN (42703) is a real error, not this.
 */
export function isMissingTableError(error: DbError): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

/** Thrown by a save while the table is missing. Its message is safe to show as is. */
export class PlatformNotificationStorageMissingError extends Error {
  readonly code = 'storage_missing';
  constructor(
    message = "Saving isn't switched on yet (the notifications table hasn't been created). Your changes are still on this page.",
  ) {
    super(message);
    this.name = 'PlatformNotificationStorageMissingError';
  }
}

/**
 * A PostgREST error as an Error the page can show as is. The two errors a person
 * can cause get a plain sentence; anything else gets `fallback`. The original
 * error stays on `cause`, and its code on `code`.
 */
export function toAdminError(error: NonNullable<DbError>, fallback: string): Error & { code?: string } {
  const code = error.code ? String(error.code) : undefined;
  let message = fallback;
  if (code === '42501' || /row-level security|permission denied/i.test(String(error.message ?? ''))) {
    // The table is super-admin only, and RLS also demands an ACTIVE account.
    message = 'Only an active Drive247 super admin can change platform notifications.';
  } else if (code === '23514') {
    message = "Something in these settings isn't allowed, like text that's too long. Check it and try again.";
  }
  const e = new Error(message, { cause: error }) as Error & { code?: string };
  if (code) e.code = code;
  return e;
}

/* -------------------------------------------------------------------------- */
/* Row shaping                                                                 */
/* -------------------------------------------------------------------------- */

const PUSH_OPTION_KEYS = ['requireInteraction', 'silent', 'replacePrevious', 'openInApp'] as const;

function isChannel(value: unknown): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly unknown[]).includes(value);
}

/** Only the known push options that hold a boolean. */
function cleanPushOptions(value: unknown): PushDisplayOptions {
  const out: PushDisplayOptions = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const v = value as Record<string, unknown>;
  for (const key of PUSH_OPTION_KEYS) if (typeof v[key] === 'boolean') out[key] = v[key] as boolean;
  return out;
}

const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Stored rows as the page expects them; anything with an unknown channel is dropped. */
export function normaliseSettingRows(data: unknown): PlatformNotificationSettingRow[] {
  if (!Array.isArray(data)) return [];
  const rows: PlatformNotificationSettingRow[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (!raw || typeof raw.notification_key !== 'string' || !isChannel(raw.channel)) continue;
    rows.push({
      notification_key: raw.notification_key,
      channel: raw.channel,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : null,
      subject: textOrNull(raw.subject),
      title: textOrNull(raw.title),
      body: textOrNull(raw.body),
      push_options: raw.channel === 'push' ? cleanPushOptions(raw.push_options) : {},
      updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
      updated_by: typeof raw.updated_by === 'string' ? raw.updated_by : null,
    });
  }
  return rows;
}

/** What `saveRows` / `resetRows` accept to name one row. */
export interface PlatformNotificationSettingRef {
  notification_key: string;
  /** Omitted = every channel of that notification. */
  channel?: NotificationChannel;
}

/**
 * `{ upserts, deletes }` — settings-model's `SettingsDiff` fits this as it is,
 * which is the intended call: `saveRows(diffEdits(rows, drafts))`.
 */
export interface PlatformNotificationSettingsWrite {
  upserts?: readonly Partial<PlatformNotificationSettingRow>[] | null;
  deletes?: readonly RefInput[] | null;
}

type RefInput = PlatformNotificationSettingRef | string;

const pairKey = (key: string, channel: NotificationChannel) => key + ':' + channel;

/**
 * Accepts `{ notification_key, channel? }` objects, or strings: "key:channel"
 * (settings-model `settingKey`) for one channel, "key" for all of them.
 */
export function expandSettingRefs(refs: readonly RefInput[] | null | undefined): { key: string; channel: NotificationChannel }[] {
  const out = new Map<string, { key: string; channel: NotificationChannel }>();
  const add = (key: string, channel?: string | null) => {
    if (channel != null && channel !== '' && !isChannel(channel)) {
      throw new Error(`"${channel}" isn't a notification channel.`);
    }
    const channels = channel ? [channel as NotificationChannel] : [...NOTIFICATION_CHANNELS];
    for (const c of channels) out.set(pairKey(key, c), { key, channel: c });
  };
  for (const ref of refs ?? []) {
    if (typeof ref === 'string') {
      const i = ref.lastIndexOf(':');
      if (i > 0) add(ref.slice(0, i), ref.slice(i + 1));
      else add(ref);
    } else if (ref && typeof ref.notification_key === 'string') {
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
 * bulk upsert is sent as NULL for that row anyway, but silently), push_options
 * {} off the push channel (the table CHECK), and the last row per
 * (key, channel) kept, since Postgres refuses to touch one row twice in a
 * single upsert.
 */
export function prepareUpserts(
  rows: readonly Partial<PlatformNotificationSettingRow>[] | null | undefined,
): Omit<PlatformNotificationSettingRow, 'updated_at' | 'updated_by'>[] {
  const byKey = new Map<string, Omit<PlatformNotificationSettingRow, 'updated_at' | 'updated_by'>>();
  for (const row of rows ?? []) {
    if (!row) continue;
    const key = String(row.notification_key ?? '');
    assertKey(key);
    if (!isChannel(row.channel)) throw new Error(`"${String(row.channel)}" isn't a notification channel.`);
    byKey.set(pairKey(key, row.channel), {
      notification_key: key,
      channel: row.channel,
      enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
      subject: row.channel === 'email' ? textOrNull(row.subject) : null,
      title: row.channel === 'email' ? null : textOrNull(row.title),
      body: textOrNull(row.body),
      push_options: row.channel === 'push' ? cleanPushOptions(row.push_options) : {},
    });
  }
  return [...byKey.values()];
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

const EMPTY_ROWS: PlatformNotificationSettingRow[] = [];

export interface UsePlatformNotificationSettings {
  /** What is stored. Everything else comes from the catalog defaults. */
  rows: PlatformNotificationSettingRow[];
  /** True until the first read finishes. */
  isLoading: boolean;
  isSaving: boolean;
  /** The last read error, as a sentence that can be shown. Writes reject instead. */
  error: Error | null;
  /** ops/notifications_v2_platform.sql has not been applied yet. */
  tableMissing: boolean;
  /** Re-reads the table. */
  refresh: () => Promise<void>;
  /** Saves a `SettingsDiff`, or an upserts/deletes pair. Rejects with a showable Error. */
  saveRows: (
    write: PlatformNotificationSettingsWrite | readonly Partial<PlatformNotificationSettingRow>[] | null | undefined,
    deletes?: readonly RefInput[] | null,
  ) => Promise<void>;
  /** Back to the catalog defaults: deletes those rows. */
  resetRows: (refs: readonly RefInput[] | null | undefined) => Promise<void>;
}

export function usePlatformNotificationSettings(): UsePlatformNotificationSettings {
  const [rows, setRows] = useState<PlatformNotificationSettingRow[]>(EMPTY_ROWS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  // Guards state writes after unmount, and drops a read that a newer one has
  // already overtaken (Save reloads while a refresh may be in flight).
  const mounted = useRef(true);
  const readId = useRef(0);
  // Saves read this to decide whether a DELETE that changed nothing was a
  // refusal or simply had nothing to delete. A ref, not state, so a save that
  // starts in the same tick as a reload still sees the latest rows.
  const knownRows = useRef<PlatformNotificationSettingRow[]>(EMPTY_ROWS);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const id = ++readId.current;
    const { data, error: readError } = await supabase
      .from(PLATFORM_NOTIFICATION_SETTINGS_TABLE)
      .select(PLATFORM_NOTIFICATION_SETTINGS_COLUMNS);

    // supabase-js resolves with { error } instead of throwing: an unchecked
    // read here would show every default as if nothing had been saved.
    if (readError) {
      if (isMissingTableError(readError)) {
        if (id !== readId.current) return;
        knownRows.current = EMPTY_ROWS;
        if (mounted.current) {
          setRows(EMPTY_ROWS);
          setTableMissing(true);
          setError(null);
          setIsLoading(false);
        }
        return;
      }
      const shown = toAdminError(readError, "Couldn't load the platform notification settings. Try again in a moment.");
      console.error('[platform-notification-settings] read failed:', readError);
      if (mounted.current && id === readId.current) {
        setError(shown);
        setIsLoading(false);
      }
      return;
    }

    // A read that a newer one has already overtaken is dropped, so a slow
    // refresh cannot put stale rows back under a save that just finished.
    if (id !== readId.current) return;
    const next = normaliseSettingRows(data);
    knownRows.current = next;
    if (mounted.current) {
      setRows(next);
      setTableMissing(false);
      setError(null);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Deletes the given rows, and fails if one we know exists was not really removed. */
  const deleteRefs = useCallback(
    async (refs: { key: string; channel: NotificationChannel }[]): Promise<void> => {
      if (refs.length === 0) return;
      const known = knownRows.current;
      const byChannel = new Map<NotificationChannel, string[]>();
      for (const { key, channel } of refs) {
        assertKey(key);
        byChannel.set(channel, [...(byChannel.get(channel) ?? []), key]);
      }
      const removed = new Set<string>();
      for (const [channel, keys] of byChannel) {
        const { data, error: deleteError } = await supabase
          .from(PLATFORM_NOTIFICATION_SETTINGS_TABLE)
          .delete()
          .eq('channel', channel)
          .in('notification_key', keys)
          .select('notification_key, channel');
        if (deleteError) {
          // Nothing stored = nothing to reset.
          if (isMissingTableError(deleteError)) return;
          throw toAdminError(deleteError, "Couldn't reset those notifications. Try again in a moment.");
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
          'Some settings could not be reset. Your account may not be allowed to change platform notifications. Refresh the page and try again.',
        );
      }
    },
    [],
  );

  const saveRows = useCallback(
    async (
      write: PlatformNotificationSettingsWrite | readonly Partial<PlatformNotificationSettingRow>[] | null | undefined,
      deletes?: readonly RefInput[] | null,
    ): Promise<void> => {
      const input: PlatformNotificationSettingsWrite = Array.isArray(write)
        ? { upserts: write as readonly Partial<PlatformNotificationSettingRow>[], deletes: deletes ?? [] }
        : ((write ?? {}) as PlatformNotificationSettingsWrite);

      const upserts = prepareUpserts(input.upserts);
      const upserted = new Set(upserts.map((r) => pairKey(r.notification_key, r.channel)));
      // A (key, channel) both saved and reset in one call: the save wins.
      const toDelete = expandSettingRefs(input.deletes).filter(({ key, channel }) => !upserted.has(pairKey(key, channel)));
      if (upserts.length === 0 && toDelete.length === 0) return;

      if (mounted.current) setIsSaving(true);
      try {
        if (upserts.length > 0) {
          const { data, error: writeError } = await supabase
            .from(PLATFORM_NOTIFICATION_SETTINGS_TABLE)
            .upsert(upserts, { onConflict: PLATFORM_NOTIFICATION_SETTINGS_CONFLICT })
            .select('notification_key, channel');
          if (writeError) {
            if (isMissingTableError(writeError)) throw new PlatformNotificationStorageMissingError();
            throw toAdminError(writeError, "Couldn't save the platform notification settings. Try again in a moment.");
          }
          const saved = Array.isArray(data) ? data.length : 0;
          if (saved !== upserts.length) {
            throw new Error(
              `Only ${saved} of ${upserts.length} notification settings were saved. Refresh the page and try again.`,
            );
          }
        }
        await deleteRefs(toDelete);
      } finally {
        // Re-read either way, so the page shows what is really stored.
        await load();
        if (mounted.current) setIsSaving(false);
      }
    },
    [deleteRefs, load],
  );

  const resetRows = useCallback(
    (refs: readonly RefInput[] | null | undefined): Promise<void> => saveRows({ upserts: [], deletes: refs ?? [] }),
    [saveRows],
  );

  return { rows, isLoading, isSaving, error, tableMissing, refresh: load, saveRows, resetRows };
}
