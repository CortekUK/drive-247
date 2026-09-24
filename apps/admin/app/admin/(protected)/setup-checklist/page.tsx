'use client';

/**
 * Setup Checklist — the features an operator has to sit down with once.
 *
 * These rows appear on the operator's dashboard, in the "On your desk" band.
 * Platform-wide, not per-tenant: the same handful of features are hard for
 * everybody, so `setup_checklist_items` has no `tenant_id` and this page has no
 * tenant filter to get wrong (V2_PLAN §5). It is authored here because the rows
 * are ours to write, not an operator's — "ye wali jo cheez hai ye bhi
 * controllable ho super admin se".
 *
 * EVERY ROW MUST CARRY A LINK — a video or a written guide. A row naming a hard
 * feature with nothing behind it is worse than no row at all: the operator
 * clicks it, nothing happens, and the card has taught them it is decoration.
 * Saving refuses it here, a CHECK constraint refuses it in the database, and
 * the portal's reader drops any row that reaches it without one.
 *
 * A VIDEO MUST CARRY ITS LENGTH. The dashboard prints it as m:ss beside the
 * play button, so an operator knows what a walkthrough costs before pressing
 * play. The Length field takes m:ss, h:mm:ss or plain seconds; saving refuses a
 * video without a readable one, and so does a CHECK constraint in the database.
 *
 * WHAT THIS IS NOT is the Welcome Pack (/admin/welcome-pack). That is a
 * 12-chapter manual with its own read tracking, still served to 16 operators
 * across 14 tenants, and it is untouched. This is the much smaller list of
 * things that cost a live walkthrough every single time, each pointing at the
 * recording of that walkthrough.
 *
 * The table may not exist yet (`ops/setup_checklist_items.sql` is applied by
 * hand), so a missing-table read is reported as a setup instruction rather than
 * an error, and the portal keeps showing its compiled list until it does.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  LinkIcon,
  ListChecks,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';

interface ChecklistItem {
  /** `null` until the row has been saved. */
  id: string | null;
  item_key: string;
  title: string;
  description: string;
  video_url: string;
  /**
   * The video's length AS TYPED — "1:30", "1:02:05" or "90". Kept as text so a
   * half-typed value is never rewritten under the cursor; `parseVideoLength`
   * turns it into seconds at save time.
   */
  video_length: string;
  guide_url: string;
  sort_order: number;
  is_published: boolean;
}

/**
 * The list the portal ships compiled in, mirrored here.
 *
 * GENERATED from apps/portal/src/lib/setup-checklist.ts, which is the fallback
 * the dashboard renders when this table is missing or empty. Prefilling with it
 * means that before the table exists this page shows what operators are ACTUALLY
 * seeing, rather than an empty screen with an "Add" button — which would read as
 * "there is no checklist" when four rows are on screen right now.
 *
 * A STARTING POINT, not the source of truth: once rows exist in the table they
 * win and this constant is never read again. Every entry has `id: null`, because
 * they are unsaved drafts until someone presses Save.
 *
 * The links are placeholders. No walkthrough has been recorded and no written
 * guide written yet, so each points at the screen the feature is configured on.
 * Replace them here the moment a real URL exists.
 */
const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: null,
    item_key: 'auto_extension',
    title: 'Auto-extension',
    description:
      'Rentals that renew themselves each period, charged upfront. Worth understanding what happens when a card fails and the rental pauses rather than lapsing.',
    video_url: '',
    video_length: '',
    guide_url: '/settings?tab=auto-extend',
    sort_order: 10,
    is_published: true,
  },
  {
    id: null,
    item_key: 'installments',
    title: 'Installments',
    description:
      'Splitting a rental into scheduled payments — how the plan is built, what happens when one payment is missed, and how the balance settles.',
    video_url: '',
    video_length: '',
    guide_url: '/settings?tab=installments',
    sort_order: 20,
    is_published: true,
  },
  {
    id: null,
    item_key: 'payg',
    title: 'Pay as you go',
    description:
      'Rentals charged day by day with no return date — how the daily charges build up, how the customer pays them, and the limits that catch people out.',
    video_url: '',
    video_length: '',
    guide_url: '/settings?tab=payg',
    sort_order: 30,
    is_published: true,
  },
  {
    id: null,
    item_key: 'bonzah',
    title: 'Bonzah insurance',
    description:
      'Connecting Bonzah, what the quote actually covers, and how the balance and the low-balance alerts work.',
    video_url: '',
    video_length: '',
    guide_url: '/settings?tab=insurance',
    sort_order: 40,
    is_published: true,
  },
];

function blank(sort_order: number): ChecklistItem {
  return {
    id: null,
    item_key: '',
    title: '',
    description: '',
    video_url: '',
    video_length: '',
    guide_url: '',
    sort_order,
    is_published: true,
  };
}

const LINK_PROBE_ORIGIN = 'https://portal.invalid';

/**
 * Whether the portal will actually USE this link, rather than treat it as blank.
 *
 * A hand-kept mirror of `safeChecklistLink` in apps/portal/src/lib/setup-checklist.ts
 * (the apps share no code). The portal's reader drops any link that fails that
 * rule, and drops the whole row when none of its links survive — so a link
 * that only looks filled in here, like `docs.drive-247.com/payg` with no
 * scheme, would save with a success message and then quietly vanish from every
 * operator's dashboard. Keep the two in step.
 *
 * The rule: an absolute `http://` or `https://` URL, or a path starting with a
 * single `/` that stays on the portal once resolved (so not `//host`, `/\host`,
 * or `/.//host`, whose dot segment collapses to `//host`). No control
 * characters anywhere.
 */
function usableLink(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (!t.startsWith('/') || t.startsWith('//') || t.startsWith('/\\')) return false;
  try {
    const resolved = new URL(t, LINK_PROBE_ORIGIN);
    return resolved.origin === LINK_PROBE_ORIGIN && !resolved.pathname.startsWith('//');
  } catch {
    return false;
  }
}

/** Something was typed, but the portal would ignore it. */
function unusableLink(text: string): boolean {
  return text.trim().length > 0 && !usableLink(text);
}

/**
 * A row is only valid if at least one of its two links is one the portal will
 * use. Counting a merely non-empty field would let a row through whose only
 * link the dashboard then drops.
 */
function hasLink(row: ChecklistItem): boolean {
  return usableLink(row.video_url) || usableLink(row.guide_url);
}

/** A video the portal will play — so the length requirement follows it. */
function hasVideo(row: ChecklistItem): boolean {
  return usableLink(row.video_url);
}

const UNUSABLE_LINK_HELP =
  'Use a full link starting with https:// (or http://), or a portal path starting with a single /, such as /settings?tab=payg.';

/**
 * The longest length accepted: four hours. The same ceiling is the CHECK in
 * ops/setup_checklist_items.sql and MAX_VIDEO_DURATION_SECONDS in
 * apps/portal/src/lib/setup-checklist.ts — the apps share no code, so the three
 * are kept in step by hand.
 */
const MAX_VIDEO_SECONDS = 14400;

/**
 * A typed length to whole seconds, or `null` when it is blank or unreadable.
 *
 * Accepts what people actually type for a video's length:
 *   "1:30"     minutes and seconds          ->   90
 *   "12:05"                                 ->  725
 *   "1:02:05"  hours, minutes and seconds   -> 3725
 *   "90"       plain seconds                ->   90
 * The seconds (and the minutes, in the hours form) must be two digits under 60,
 * so "1:5" and "1:75" are refused rather than guessed at. The result must be
 * 1 second to 4 hours — the range the database enforces.
 */
function parseVideoLength(text: string): number | null {
  const t = text.trim();
  let seconds: number;
  let m: RegExpMatchArray | null;
  if (/^\d+$/.test(t)) {
    seconds = Number(t);
  } else if ((m = t.match(/^(\d+):([0-5]\d)$/))) {
    seconds = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = t.match(/^(\d+):([0-5]\d):([0-5]\d)$/))) {
    seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  } else {
    return null;
  }
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= MAX_VIDEO_SECONDS
    ? seconds
    : null;
}

/** Seconds back to the form's text: m:ss under an hour, h:mm:ss from one. */
function formatVideoLength(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * A failed save, in words that say what to fix.
 *
 * 23514 is Postgres' check_violation, and this table has three CHECKs that can
 * raise it — so the constraint's name, which Postgres puts in the message, is
 * what decides the sentence. 42703 / PGRST204 mean the table predates the
 * length column: that is a setup step, not a problem with the row.
 */
function describeSaveError(title: string, error: { code?: string; message: string }): string {
  if (error.code === '23514') {
    if (/video_has_duration/.test(error.message)) {
      return `"${title}" was refused by the database because its video has no length. Type the length beside the video URL, e.g. 1:30.`;
    }
    if (/video_duration_range/.test(error.message)) {
      return `"${title}" was refused by the database because its video length is out of range. It must be between 0:01 and 4:00:00.`;
    }
    if (/has_a_link/.test(error.message)) {
      return `"${title}" was refused by the database because it has no link. Add a video URL or a guide URL.`;
    }
    return `"${title}" was refused by a database check: ${error.message}`;
  }
  if (error.code === '42703' || error.code === 'PGRST204') {
    return `Could not save "${title}": the table has no video_duration_seconds column yet. Re-apply ops/setup_checklist_items.sql — it adds the column in place — then save again.`;
  }
  return `Could not save "${title}": ${error.message}`;
}

type NoticeTone = 'ok' | 'error' | 'setup';

export default function SetupChecklistAdmin() {
  const [rows, setRows] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('setup_checklist_items')
      .select(
        'id,item_key,title,description,video_url,video_duration_seconds,guide_url,sort_order,is_published',
      )
      .order('sort_order', { ascending: true });

    if (error) {
      // A table made from an earlier copy of the SQL, before the length column.
      // Checked FIRST, because its message also ends "does not exist" — and
      // calling it a missing table would send someone off to create a table
      // that is already there.
      const missingColumn =
        error.code === '42703' || /video_duration_seconds/i.test(error.message);
      const missing =
        !missingColumn &&
        (error.code === '42P01' ||
          error.code === 'PGRST205' ||
          /could not find the table|does not exist/i.test(error.message));
      if (missing) setRows(DEFAULT_CHECKLIST_ITEMS.map((r) => ({ ...r })));
      setNotice({
        tone: missing || missingColumn ? 'setup' : 'error',
        text: missingColumn
          ? 'The setup_checklist_items table has no video_duration_seconds column yet — it was created from an earlier copy of ops/setup_checklist_items.sql. Re-apply that file (it adds the column in place and changes no existing row), then reload.'
          : missing
            ? 'The setup_checklist_items table has not been created yet — apply ops/setup_checklist_items.sql, then reload. Below is the list the portal is showing right now, so you can read and edit it, but nothing can be saved until the table exists.'
            : `Could not load the checklist: ${error.message}`,
      });
      setLoading(false);
      return;
    }

    const loaded: ChecklistItem[] = (data ?? []).map((r: Record<string, unknown>) => {
      const seconds = Number(r.video_duration_seconds);
      return {
        id: String(r.id),
        item_key: String(r.item_key ?? ''),
        title: String(r.title ?? ''),
        description: r.description ? String(r.description) : '',
        video_url: r.video_url ? String(r.video_url) : '',
        // Shown the way it is typed ("1:30"), not as the stored seconds.
        // `Number(null)` is 0, so a row with no length stays blank.
        video_length:
          r.video_duration_seconds != null && Number.isInteger(seconds) && seconds > 0
            ? formatVideoLength(seconds)
            : '',
        guide_url: r.guide_url ? String(r.guide_url) : '',
        sort_order: Number(r.sort_order ?? 0),
        is_published: r.is_published !== false,
      };
    });

    // An empty table is far more likely to be unseeded than a deliberate choice
    // to explain nothing, so it starts from the compiled list too — unsaved, so
    // nothing is written until someone presses Save.
    setRows(loaded.length > 0 ? loaded : DEFAULT_CHECKLIST_ITEMS.map((r) => ({ ...r })));
    setNotice(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (i: number, fields: Partial<ChecklistItem>) =>
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, ...fields } : r)));

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      const a = next[i];
      const b = next[j];
      next[i] = b;
      next[j] = a;
      // Rewrite the order field from the new positions, so what is saved matches
      // what is on screen rather than the order the rows arrived in.
      return next.map((r, n) => ({ ...r, sort_order: (n + 1) * 10 }));
    });
  };

  const remove = async (i: number) => {
    const row = rows[i];
    if (row.id) {
      const ok = window.confirm(
        `Delete "${row.title || row.item_key}"?\n\nIt disappears from every operator's dashboard immediately.`,
      );
      if (!ok) return;
      const { error } = await supabase.from('setup_checklist_items').delete().eq('id', row.id);
      if (error) {
        setNotice({ tone: 'error', text: `Could not delete: ${error.message}` });
        return;
      }
    }
    setRows((prev) => prev.filter((_, n) => n !== i));
  };

  /**
   * Save every row.
   *
   * IDEMPOTENT ON PURPOSE, and this is where the equivalent screen at
   * /admin/onboarding-questions has a real bug worth not repeating. There, a
   * new row is INSERTed and its returned id is never written back into local
   * state — so if row 3 fails, rows 1 and 2 still have `id: null`, and pressing
   * Save again inserts them a SECOND time. On that table a unique key happens to
   * mask it as a "key already used" error; the underlying mistake is that a
   * partial save leaves the screen lying about what is already in the database.
   *
   * Two things fix it here:
   *
   *  1. New rows are UPSERTed on `item_key`, not inserted. `item_key` is unique,
   *     so re-running the same save updates the row it created last time
   *     instead of colliding with it. Re-pressing Save is therefore always safe,
   *     whatever failed last time and however far it got.
   *
   *  2. Every id that comes back is written into local state IMMEDIATELY, row by
   *     row, rather than after the whole loop. So even when the loop stops
   *     half-way the screen already knows which rows exist, and the next attempt
   *     updates them by id.
   *
   * Validation happens before any write, so a bad row cannot leave half the list
   * saved and half not.
   */
  const saveAll = async () => {
    const seen = new Set<string>();
    for (const r of rows) {
      const key = r.item_key.trim();
      if (!key || !r.title.trim()) {
        setNotice({ tone: 'error', text: 'Every row needs a key and a title.' });
        return;
      }
      if (seen.has(key)) {
        setNotice({
          tone: 'error',
          text: `Two rows share the key "${key}". Keys must be unique — the portal uses them to line a row up with the copy it ships compiled in.`,
        });
        return;
      }
      seen.add(key);
      // Before the has-a-link check, so the message names the actual problem
      // rather than saying there is no link when one was typed.
      for (const [field, value] of [
        ['video URL', r.video_url],
        ['guide URL', r.guide_url],
      ] as const) {
        if (unusableLink(value)) {
          setNotice({
            tone: 'error',
            text: `"${r.title.trim()}" has a ${field} the dashboard cannot open: "${value.trim()}". ${UNUSABLE_LINK_HELP} Anything else is ignored by the portal, so it would never reach an operator.`,
          });
          return;
        }
      }
      if (!hasLink(r)) {
        setNotice({
          tone: 'error',
          text: `"${r.title.trim()}" has no link. Every row needs a video URL or a guide URL — a row that names a hard feature and then opens nothing is worse than not listing it at all.`,
        });
        return;
      }
      if (hasVideo(r) && parseVideoLength(r.video_length) === null) {
        setNotice({
          tone: 'error',
          text: `"${r.title.trim()}" has a video but no readable length. Type it beside the video URL as m:ss (1:30), h:mm:ss (1:02:05) or plain seconds (90), up to 4 hours — operators see it before they press play, so it should match the file.`,
        });
        return;
      }
    }

    setSaving(true);
    setNotice(null);

    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const payload = {
        item_key: r.item_key.trim(),
        title: r.title.trim(),
        description: r.description.trim() || null,
        video_url: r.video_url.trim() || null,
        // Only a video has a length. Null when the video field is blank, so
        // clearing the video also clears its old length rather than leaving a
        // time behind for whatever URL is pasted in next.
        video_duration_seconds: hasVideo(r) ? parseVideoLength(r.video_length) : null,
        guide_url: r.guide_url.trim() || null,
        sort_order: r.sort_order,
        is_published: r.is_published,
        updated_at: new Date().toISOString(),
      };

      if (r.id) {
        const { error } = await supabase
          .from('setup_checklist_items')
          .update(payload)
          .eq('id', r.id);
        if (error) {
          setSaving(false);
          setNotice({ tone: 'error', text: describeSaveError(r.title, error) });
          return;
        }
      } else {
        const { data, error } = await supabase
          .from('setup_checklist_items')
          .upsert(payload, { onConflict: 'item_key' })
          .select('id')
          .single();
        if (error) {
          setSaving(false);
          setNotice({ tone: 'error', text: describeSaveError(r.title, error) });
          return;
        }
        // Written back NOW, not after the loop — see the note above.
        const savedId: string | null = data?.id ? String(data.id) : null;
        if (savedId) {
          setRows((prev) =>
            prev.map((row, n) => (n === i && !row.id ? { ...row, id: savedId } : row)),
          );
        }
      }
    }

    setSaving(false);
    setNotice({
      tone: 'ok',
      text: 'Saved. Operators see this on their dashboard from their next page load.',
    });
    void load();
  };

  const publishedCount = rows.filter((r) => r.is_published).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ListChecks className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Setup Checklist</h1>
          <p className="text-sm text-muted-foreground">
            The features every operator has to sit down with once — each with the video or the
            written guide that explains it.
          </p>
        </div>
      </header>

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.tone === 'error'
              ? 'bg-destructive/10 text-destructive'
              : notice.tone === 'setup'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {notice.text}
        </p>
      )}

      {!loading && rows.length > 0 && publishedCount === 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <EyeOff className="mt-0.5 size-4 shrink-0" />
          <span>
            Every row is a draft, so the card on the dashboard falls back to the list the portal
            ships compiled in. Publish at least one row for these to take over.
          </span>
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      ) : (
        <>
          <div className="space-y-4">
            {rows.map((r, i) => (
              <div
                key={r.id ?? `new-${i}`}
                className="space-y-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Item {i + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(i)}
                      className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                      aria-label="Delete item"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Feature</span>
                  <input
                    value={r.title}
                    onChange={(e) => patch(i, { title: e.target.value })}
                    placeholder="Auto-extension"
                    className="w-full rounded-3xl border border-border bg-background px-4 py-2 text-sm"
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    Why it needs an hour{' '}
                    <span className="font-normal text-muted-foreground">
                      (optional — one or two lines, shown under the name)
                    </span>
                  </span>
                  <textarea
                    value={r.description}
                    onChange={(e) => patch(i, { description: e.target.value })}
                    rows={2}
                    className="w-full rounded-3xl border border-border bg-background px-4 py-2 text-sm"
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    Key{' '}
                    <span className="font-normal text-muted-foreground">
                      {r.id
                        ? '— locked; it is how the portal lines this row up with the copy it ships'
                        : '— permanent once saved'}
                    </span>
                  </span>
                  <input
                    value={r.item_key}
                    disabled={!!r.id}
                    onChange={(e) => patch(i, { item_key: e.target.value })}
                    placeholder="auto_extension"
                    className="w-full rounded-3xl border border-border bg-background px-4 py-2 font-mono text-sm disabled:opacity-60"
                  />
                </label>

                {/* THE LINK PAIR. At least one is required — the message below
                    says so before anyone presses Save, rather than after. */}
                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <LinkIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      At least one of these is required. Where no video exists yet, link the written
                      guide instead. A video also needs its length, which operators see beside the
                      play button before they press it. A path starting with <code>/</code> opens
                      inside the portal; a full <code>https://</code> link opens in a new tab.
                      Anything else is ignored by the portal, so it cannot be saved.
                    </span>
                  </p>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">Video</span>
                      <input
                        value={r.video_url}
                        onChange={(e) => patch(i, { video_url: e.target.value })}
                        placeholder="https://www.loom.com/embed/… or /explainers/auto-extend.mp4"
                        aria-invalid={unusableLink(r.video_url)}
                        className="w-full rounded-3xl border border-border bg-background px-4 py-2 text-sm aria-[invalid=true]:border-destructive"
                      />
                    </label>

                    {/* The length an operator sees beside the play button. Typed
                        as text and tidied on blur ("90" becomes "1:30"), so the
                        field always ends up showing exactly what will be saved. */}
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">
                        Length{' '}
                        <span className="font-normal text-muted-foreground">(m:ss)</span>
                      </span>
                      <input
                        value={r.video_length}
                        onChange={(e) => patch(i, { video_length: e.target.value })}
                        onBlur={() => {
                          const seconds = parseVideoLength(r.video_length);
                          if (seconds !== null) patch(i, { video_length: formatVideoLength(seconds) });
                        }}
                        placeholder="1:30"
                        aria-invalid={hasVideo(r) && parseVideoLength(r.video_length) === null}
                        className="w-full rounded-3xl border border-border bg-background px-4 py-2 text-sm tabular-nums"
                      />
                    </label>
                  </div>

                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Written guide</span>
                    <input
                      value={r.guide_url}
                      onChange={(e) => patch(i, { guide_url: e.target.value })}
                      placeholder="https://… or /settings?tab=auto-extend"
                      aria-invalid={unusableLink(r.guide_url)}
                      className="w-full rounded-3xl border border-border bg-background px-4 py-2 text-sm aria-[invalid=true]:border-destructive"
                    />
                  </label>

                  {unusableLink(r.video_url) && (
                    <p className="text-xs font-medium text-destructive">
                      The video URL is not a link the dashboard can open, so this row cannot be
                      saved. {UNUSABLE_LINK_HELP}
                    </p>
                  )}

                  {unusableLink(r.guide_url) && (
                    <p className="text-xs font-medium text-destructive">
                      The guide URL is not a link the dashboard can open, so this row cannot be
                      saved. {UNUSABLE_LINK_HELP}
                    </p>
                  )}

                  {/* Only when nothing was typed: a typed-but-unusable link has
                      its own message above, which says what to change. */}
                  {!hasLink(r) && !unusableLink(r.video_url) && !unusableLink(r.guide_url) && (
                    <p className="text-xs font-medium text-destructive">
                      This row has no link, so it cannot be saved. An item that names a hard feature
                      and then opens nothing is worse than not listing it at all.
                    </p>
                  )}

                  {hasVideo(r) && parseVideoLength(r.video_length) === null && (
                    <p className="text-xs font-medium text-destructive">
                      {r.video_length.trim()
                        ? `"${r.video_length.trim()}" is not a length this form can read, so this row cannot be saved. Type it as m:ss (1:30), h:mm:ss (1:02:05) or plain seconds (90), up to 4 hours.`
                        : 'This row has a video but no length, so it cannot be saved. Operators see the length beside the play button before they press it — type it as m:ss, e.g. 1:30.'}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-5 border-t border-border pt-3 text-sm">
                  <button
                    type="button"
                    onClick={() => patch(i, { is_published: !r.is_published })}
                    className="flex items-center gap-2 font-medium"
                  >
                    {r.is_published ? (
                      <Eye className="size-4 text-emerald-600" />
                    ) : (
                      <EyeOff className="size-4 text-muted-foreground" />
                    )}
                    {r.is_published ? 'Live' : 'Draft'}
                  </button>
                  <span className="text-muted-foreground">
                    {r.is_published
                      ? 'On every operator’s dashboard.'
                      : 'Hidden from operators; visible only here.'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, blank((prev.length + 1) * 10)])}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium"
            >
              <Plus className="size-4" /> Add item
            </button>

            <button
              type="button"
              onClick={() => void saveAll()}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
