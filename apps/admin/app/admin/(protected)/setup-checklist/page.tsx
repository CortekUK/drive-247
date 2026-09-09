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
    guide_url: '/settings?tab=installments',
    sort_order: 20,
    is_published: true,
  },
  {
    id: null,
    item_key: 'payg',
    title: 'Pay as you go',
    description:
      'The settings under pay-as-you-go are the fiddliest in the product. Go through them once with someone rather than guessing.',
    video_url: '',
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
    guide_url: '',
    sort_order,
    is_published: true,
  };
}

/** A row is only valid if at least one of its two links has something in it. */
function hasLink(row: ChecklistItem): boolean {
  return row.video_url.trim().length > 0 || row.guide_url.trim().length > 0;
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
      .select('id,item_key,title,description,video_url,guide_url,sort_order,is_published')
      .order('sort_order', { ascending: true });

    if (error) {
      const missing =
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        /could not find the table|does not exist/i.test(error.message);
      if (missing) setRows(DEFAULT_CHECKLIST_ITEMS.map((r) => ({ ...r })));
      setNotice({
        tone: missing ? 'setup' : 'error',
        text: missing
          ? 'The setup_checklist_items table has not been created yet — apply ops/setup_checklist_items.sql, then reload. Below is the list the portal is showing right now, so you can read and edit it, but nothing can be saved until the table exists.'
          : `Could not load the checklist: ${error.message}`,
      });
      setLoading(false);
      return;
    }

    const loaded: ChecklistItem[] = (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      item_key: String(r.item_key ?? ''),
      title: String(r.title ?? ''),
      description: r.description ? String(r.description) : '',
      video_url: r.video_url ? String(r.video_url) : '',
      guide_url: r.guide_url ? String(r.guide_url) : '',
      sort_order: Number(r.sort_order ?? 0),
      is_published: r.is_published !== false,
    }));

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
      if (!hasLink(r)) {
        setNotice({
          tone: 'error',
          text: `"${r.title.trim()}" has no link. Every row needs a video URL or a guide URL — a row that names a hard feature and then opens nothing is worse than not listing it at all.`,
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
          setNotice({ tone: 'error', text: `Could not save "${r.title}": ${error.message}` });
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
          setNotice({
            tone: 'error',
            text:
              error.code === '23514'
                ? `"${r.title}" was refused by the database because it has no link. Add a video URL or a guide URL.`
                : `Could not save "${r.title}": ${error.message}`,
          });
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
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ListChecks className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Setup Checklist</h1>
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
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
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
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
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
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm disabled:opacity-60"
                  />
                </label>

                {/* THE LINK PAIR. At least one is required — the message below
                    says so before anyone presses Save, rather than after. */}
                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <LinkIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      At least one of these is required. Where no video exists yet, link the written
                      guide instead. A path starting with <code>/</code> opens inside the portal;
                      anything else opens in a new tab.
                    </span>
                  </p>

                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Video</span>
                    <input
                      value={r.video_url}
                      onChange={(e) => patch(i, { video_url: e.target.value })}
                      placeholder="https://www.loom.com/embed/… or /explainers/auto-extend.mp4"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Written guide</span>
                    <input
                      value={r.guide_url}
                      onChange={(e) => patch(i, { guide_url: e.target.value })}
                      placeholder="https://… or /settings?tab=auto-extend"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>

                  {!hasLink(r) && (
                    <p className="text-xs font-medium text-destructive">
                      This row has no link, so it cannot be saved. An item that names a hard feature
                      and then opens nothing is worse than not listing it at all.
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
