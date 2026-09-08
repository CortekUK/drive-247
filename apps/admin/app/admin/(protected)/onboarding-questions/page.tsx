'use client';

/**
 * Onboarding Questions — the first-run wizard's question set.
 *
 * These are the questions every brand-new operator answers the first time they
 * open the portal. Platform-wide, not per-tenant: one set, asked of everyone.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO is show anybody's ANSWERS. That was
 * ruled out explicitly, and not building it is worth stating: this page never
 * reads another operator's onboarding submissions, so there is no tenant filter
 * here to get wrong (V2_PLAN §5).
 *
 * `question_key` is editable only on a question that has not been saved yet.
 * It is the key answers are stored under in `tenant_first_run.answers`, and
 * renaming it orphans every answer already collected under the old one — so
 * once a row exists, the field locks.
 *
 * The table may not exist yet (`ops/first_run_questions.sql` is applied by
 * hand), so a missing-table read is reported as a setup instruction rather than
 * an error, and the portal keeps asking its compiled question set until it does.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ListChecks,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { DEFAULT_FIRST_RUN_QUESTIONS } from '@/lib/onboarding/default-questions';

type Kind = 'single' | 'multi' | 'text';

interface Option {
  value: string;
  label: string;
}

interface Question {
  id: string | null;
  question_key: string;
  kind: Kind;
  prompt: string;
  help: string;
  placeholder: string;
  options: Option[];
  is_required: boolean;
  sort_order: number;
  is_published: boolean;
}

function blank(sort_order: number): Question {
  return {
    id: null,
    question_key: '',
    kind: 'single',
    prompt: '',
    help: '',
    placeholder: '',
    options: [],
    is_required: true,
    sort_order,
    is_published: true,
  };
}

export default function OnboardingQuestionsAdmin() {
  const [rows, setRows] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'setup'; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('first_run_questions')
      .select('id,question_key,kind,prompt,help,placeholder,options,is_required,sort_order,is_published')
      .order('sort_order', { ascending: true });

    if (error) {
      const missing =
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        /could not find the table|does not exist/i.test(error.message);
      // Show the set the portal is ACTUALLY asking, rather than an empty page.
      // An "Add question" button on a blank screen reads as "there are no
      // questions" — when five are being asked right now.
      if (missing) setRows(DEFAULT_FIRST_RUN_QUESTIONS.map((q) => ({ ...q, id: null })));
      setNotice({
        tone: missing ? 'setup' : 'error',
        text: missing
          ? 'The first_run_questions table has not been created yet — apply ops/first_run_questions.sql, then reload. Below is the set the portal is asking right now, so you can read and edit it, but nothing can be saved until the table exists.'
          : `Could not load the questions: ${error.message}`,
      });
      setLoading(false);
      return;
    }

    setRows(
      (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        question_key: String(r.question_key ?? ''),
        kind: (r.kind as Kind) ?? 'single',
        prompt: String(r.prompt ?? ''),
        help: r.help ? String(r.help) : '',
        placeholder: r.placeholder ? String(r.placeholder) : '',
        options: Array.isArray(r.options) ? (r.options as Option[]) : [],
        is_required: r.is_required !== false,
        sort_order: Number(r.sort_order ?? 0),
        is_published: r.is_published !== false,
      })),
    );
    // An empty table is far more likely to be unseeded than a deliberate choice
    // to ask nothing, so it starts from the live set too — unsaved, so nothing
    // is written until someone presses Save.
    if ((data ?? []).length === 0) {
      setRows(DEFAULT_FIRST_RUN_QUESTIONS.map((q) => ({ ...q, id: null })));
    }
    setNotice(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (i: number, fields: Partial<Question>) =>
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, ...fields } : r)));

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      // Rewrite the order field from the new positions, so what is saved
      // matches what is on screen rather than the order rows arrived in.
      return next.map((r, n) => ({ ...r, sort_order: (n + 1) * 10 }));
    });
  };

  const remove = async (i: number) => {
    const row = rows[i];
    if (row.id) {
      const ok = window.confirm(
        `Delete "${row.prompt || row.question_key}"?\n\nAnswers already collected under "${row.question_key}" stay in the database but nothing will read them again.`,
      );
      if (!ok) return;
      const { error } = await supabase.from('first_run_questions').delete().eq('id', row.id);
      if (error) {
        setNotice({ tone: 'error', text: `Could not delete: ${error.message}` });
        return;
      }
    }
    setRows((prev) => prev.filter((_, n) => n !== i));
  };

  const saveAll = async () => {
    for (const r of rows) {
      if (!r.question_key.trim() || !r.prompt.trim()) {
        setNotice({ tone: 'error', text: 'Every question needs a key and a prompt.' });
        return;
      }
      if (r.kind !== 'text' && r.options.length === 0) {
        setNotice({
          tone: 'error',
          text: `"${r.prompt}" is a choice question with no options. Add at least one, or change it to free text.`,
        });
        return;
      }
    }

    setSaving(true);
    setNotice(null);

    for (const r of rows) {
      const payload = {
        question_key: r.question_key.trim(),
        kind: r.kind,
        prompt: r.prompt.trim(),
        help: r.help.trim() || null,
        placeholder: r.kind === 'text' ? r.placeholder.trim() || null : null,
        options: r.kind === 'text' ? [] : r.options,
        is_required: r.is_required,
        sort_order: r.sort_order,
        is_published: r.is_published,
        updated_at: new Date().toISOString(),
      };
      const { error } = r.id
        ? await supabase.from('first_run_questions').update(payload).eq('id', r.id)
        : await supabase.from('first_run_questions').insert(payload);

      if (error) {
        setSaving(false);
        setNotice({
          tone: 'error',
          text:
            error.code === '23505'
              ? `The key "${r.question_key}" is already used by another question. Keys must be unique.`
              : `Could not save "${r.prompt}": ${error.message}`,
        });
        return;
      }
    }

    setSaving(false);
    setNotice({ tone: 'ok', text: 'Saved. New operators will see this set from their next sign-in.' });
    void load();
  };

  const requiredCount = rows.filter((r) => r.is_required && r.is_published).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ListChecks className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Onboarding Questions</h1>
          <p className="text-sm text-muted-foreground">
            What every new operator is asked the first time they open the portal.
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

      {/* The wizard cannot be dismissed as a whole, so a set with no optional
          questions is a wall an operator must climb before reaching anything.
          Worth saying out loud at the moment someone is deciding. */}
      {!loading && requiredCount === rows.filter((r) => r.is_published).length && rows.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Every published question is required. A new operator cannot reach their dashboard
            without answering all {requiredCount}. Consider marking the least important ones
            optional.
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
              <div key={r.id ?? `new-${i}`} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Question {i + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label="Move up">
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label="Move down">
                      <ArrowDown className="size-4" />
                    </button>
                    <button type="button" onClick={() => void remove(i)}
                      className="rounded-md p-1.5 text-destructive hover:bg-destructive/10" aria-label="Delete question">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block font-medium">Prompt</span>
                    <input value={r.prompt} onChange={(e) => patch(i, { prompt: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Type</span>
                    <select value={r.kind} onChange={(e) => patch(i, { kind: e.target.value as Kind })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                      <option value="single">Pick one</option>
                      <option value="multi">Pick any</option>
                      <option value="text">Free text</option>
                    </select>
                  </label>
                </div>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    Help <span className="font-normal text-muted-foreground">(optional)</span>
                  </span>
                  <input value={r.help} onChange={(e) => patch(i, { help: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    Answer key{' '}
                    <span className="font-normal text-muted-foreground">
                      {r.id ? '— locked; renaming it would orphan every answer already collected' : '— permanent once saved'}
                    </span>
                  </span>
                  <input value={r.question_key} disabled={!!r.id}
                    onChange={(e) => patch(i, { question_key: e.target.value })}
                    placeholder="fleet_size"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm disabled:opacity-60" />
                </label>

                {r.kind === 'text' ? (
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">
                      Placeholder <span className="font-normal text-muted-foreground">(optional)</span>
                    </span>
                    <input value={r.placeholder} onChange={(e) => patch(i, { placeholder: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                  </label>
                ) : (
                  <div className="text-sm">
                    <span className="mb-1 block font-medium">Options</span>
                    <div className="space-y-2">
                      {r.options.map((o, oi) => (
                        <div key={oi} className="flex gap-2">
                          <input value={o.label} placeholder="Label shown to the operator"
                            onChange={(e) => patch(i, {
                              options: r.options.map((x, n) => (n === oi ? { ...x, label: e.target.value } : x)),
                            })}
                            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                          <input value={o.value} placeholder="stored_value"
                            onChange={(e) => patch(i, {
                              options: r.options.map((x, n) => (n === oi ? { ...x, value: e.target.value } : x)),
                            })}
                            className="w-40 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm" />
                          <button type="button"
                            onClick={() => patch(i, { options: r.options.filter((_, n) => n !== oi) })}
                            className="rounded-md p-2 text-destructive hover:bg-destructive/10" aria-label="Remove option">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ))}
                      <button type="button"
                        onClick={() => patch(i, { options: [...r.options, { value: '', label: '' }] })}
                        className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <Plus className="size-4" /> Add option
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-5 border-t border-border pt-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={r.is_required}
                      onChange={(e) => patch(i, { is_required: e.target.checked })} />
                    <span className="font-medium">Required</span>
                    <span className="text-muted-foreground">
                      {r.is_required ? '— must be answered' : '— an operator can skip this one'}
                    </span>
                  </label>

                  <button type="button" onClick={() => patch(i, { is_published: !r.is_published })}
                    className="flex items-center gap-2 font-medium">
                    {r.is_published ? <Eye className="size-4 text-emerald-600" /> : <EyeOff className="size-4 text-muted-foreground" />}
                    {r.is_published ? 'Live' : 'Draft'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button"
              onClick={() => setRows((prev) => [...prev, blank((prev.length + 1) * 10)])}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium">
              <Plus className="size-4" /> Add question
            </button>

            <button type="button" onClick={() => void saveAll()} disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
