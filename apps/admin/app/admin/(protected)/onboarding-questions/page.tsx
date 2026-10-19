'use client';

/**
 * Onboarding Questions — the first-run wizard's question set.
 *
 * These are the questions every brand-new operator answers the first time they
 * open the portal. Platform-wide, not per-tenant: one set, asked of everyone.
 *
 * Each question is drawn as the wizard draws it and edited in place, the way
 * Signup Plans edits its pricing cards (components/admin/onboarding-question-card.tsx).
 * New question asks for the type and the heading, then adds it switched off.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO is show anybody's ANSWERS. That was
 * ruled out explicitly, and not building it is worth stating: this page never
 * reads another operator's onboarding submissions, so there is no tenant filter
 * here to get wrong (V2_PLAN §5).
 *
 * `question_key` is set once, when a question is created, and never changes.
 * It is the key answers are stored under in `tenant_first_run.answers`, and
 * renaming it would orphan every answer already collected under the old one.
 *
 * The table may not exist yet (`ops/first_run_questions.sql` is applied by
 * hand), so a missing-table read is reported as a setup instruction, and the
 * portal keeps asking its compiled question set until it does.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GripVertical, Maximize2, Minimize2, Plus } from 'lucide-react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { HEADER_ACTIONS, HEADER_PRIMARY, HeaderIconButton } from '@/components/admin/header-buttons';
import {
  KIND_LABEL,
  OnboardingQuestionCard,
  draftOf,
  slugOf,
  type OnboardingQuestion,
  type QuestionDraft,
  type QuestionKind,
} from '@/components/admin/onboarding-question-card';
import { cn } from '@/lib/utils';
import { confirmDialog } from '@/components/ui/confirm';

const COLUMNS = 'id,question_key,kind,prompt,help,placeholder,options,is_required,sort_order,is_published';

function fromRow(r: Record<string, unknown>): OnboardingQuestion {
  return {
    id: String(r.id),
    question_key: String(r.question_key ?? ''),
    kind: (r.kind as QuestionKind) ?? 'single',
    prompt: String(r.prompt ?? ''),
    help: r.help ? String(r.help) : '',
    placeholder: r.placeholder ? String(r.placeholder) : '',
    options: Array.isArray(r.options) ? (r.options as { value: string; label: string }[]) : [],
    is_required: r.is_required !== false,
    sort_order: Number(r.sort_order ?? 0),
    is_published: r.is_published !== false,
  };
}

export default function OnboardingQuestionsAdmin() {
  const [rows, setRows] = useState<OnboardingQuestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** Minimised: every question as a small row, to drag into order. */
  const [compact, setCompact] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('first_run_questions').select(COLUMNS).order('sort_order', { ascending: true });
    if (error) {
      const missing = error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|does not exist/i.test(error.message);
      setStatus(missing ? 'missing' : 'error');
      setLoadError(error.message);
      return;
    }
    const next = (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
    setRows(next);
    setDrafts(Object.fromEntries(next.map((q) => [q.id, draftOf(q)])));
    setStatus('ready');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Write one row and swap the saved version in, keeping other cards' drafts. */
  const write = async (q: OnboardingQuestion, patch: Partial<OnboardingQuestion>, tag: string, keepDraft = true) => {
    setPending(`${q.id}:${tag}`);
    const { data, error } = await supabase
      .from('first_run_questions')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', q.id)
      .select(COLUMNS)
      .single();
    setPending(null);
    if (error || !data) {
      toast.error(`Could not save: ${error?.message ?? 'no row came back'}`);
      return false;
    }
    const saved = fromRow(data as Record<string, unknown>);
    setRows((prev) => prev.map((r) => (r.id === q.id ? saved : r)));
    if (!keepDraft) setDrafts((prev) => ({ ...prev, [q.id]: draftOf(saved) }));
    return true;
  };

  const saveContent = async (q: OnboardingQuestion) => {
    const d = drafts[q.id];
    const ok = await write(
      q,
      {
        prompt: d.prompt.trim(),
        help: d.help.trim() || null,
        placeholder: d.placeholder.trim() || null,
        options: d.options.map((o) => ({ label: o.label.trim(), value: o.value || slugOf(o.label) })),
      } as unknown as Partial<OnboardingQuestion>,
      'content',
      false,
    );
    if (ok) toast.success('Saved. New operators see it from their next sign-in.');
  };

  const saveSettings = async (q: OnboardingQuestion, patch: Partial<OnboardingQuestion>) => {
    // A choice question needs something to choose; a text question ignores options.
    const options = patch.kind && patch.kind !== 'text' && (patch.options ?? q.options).length === 0
      ? [{ value: 'option_1', label: 'Option 1' }]
      : patch.options;
    const ok = await write(q, { ...patch, ...(options ? { options } : {}) }, 'settings', false);
    if (ok) toast.success('Settings saved');
  };

  /** Put the rows in this order and save every sort_order that changed. */
  const reorder = async (next: OnboardingQuestion[]) => {
    const before = new Map(rows.map((r) => [r.id, r.sort_order]));
    const renumbered = next.map((r, n) => ({ ...r, sort_order: (n + 1) * 10 }));
    setRows(renumbered);
    const changed = renumbered.filter((r) => r.sort_order !== before.get(r.id));
    if (changed.length === 0) return;
    setPending('order');
    const results = await Promise.all(
      changed.map((r) => supabase.from('first_run_questions').update({ sort_order: r.sort_order }).eq('id', r.id)),
    );
    setPending(null);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error(`Could not reorder: ${failed.error.message}`);
      void load();
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    void reorder(arrayMove(rows, index, target));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.id === active.id);
    const to = rows.findIndex((r) => r.id === over.id);
    if (from >= 0 && to >= 0) void reorder(arrayMove(rows, from, to));
  };

  /** Back to the full view, scrolled to this question. */
  const openFull = (id: string) => {
    setCompact(false);
    setTimeout(() => document.getElementById(`question-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const remove = async (q: OnboardingQuestion) => {
    const ok = await confirmDialog({
      title: `Delete "${q.prompt || q.question_key}"?`,
      description: `Answers already collected under "${q.question_key}" stay in the database, but nothing will read them again.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setPending(`${q.id}:delete`);
    const { error } = await supabase.from('first_run_questions').delete().eq('id', q.id);
    setPending(null);
    if (error) {
      toast.error(`Could not delete: ${error.message}`);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== q.id));
    toast.success('Question deleted');
  };

  const create = async (kind: QuestionKind, prompt: string) => {
    const base = slugOf(prompt) || 'question';
    const taken = new Set(rows.map((r) => r.question_key));
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
    setPending('create');
    const { data, error } = await supabase
      .from('first_run_questions')
      .insert({
        question_key: key,
        kind,
        prompt: prompt.trim(),
        help: null,
        placeholder: null,
        options: kind === 'text' ? [] : [{ value: 'option_1', label: 'Option 1' }, { value: 'option_2', label: 'Option 2' }],
        is_required: true,
        is_published: false,
        sort_order: (rows.reduce((m, r) => Math.max(m, r.sort_order), 0) || 0) + 10,
      })
      .select(COLUMNS)
      .single();
    setPending(null);
    if (error || !data) {
      toast.error(`Could not add the question: ${error?.message ?? 'no row came back'}`);
      return false;
    }
    const saved = fromRow(data as Record<string, unknown>);
    setRows((prev) => [...prev, saved]);
    // Bring the new question into view once it has rendered.
    setTimeout(() => document.getElementById(`question-${saved.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    setDrafts((prev) => ({ ...prev, [saved.id]: draftOf(saved) }));
    toast.success('Added, switched off. Fill in the answers, then switch it on.');
    return true;
  };

  const live = useMemo(() => rows.filter((r) => r.is_published), [rows]);
  const allRequired = live.length > 0 && live.every((r) => r.is_required);
  const busy = pending !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Onboarding Questions</h1>
          <p className="text-sm text-muted-foreground">Asked once, the first time a new operator opens the portal.</p>
        </div>
        <div className={HEADER_ACTIONS}>
          <HeaderIconButton
            label={compact ? 'Full view' : 'Minimise to reorder'}
            pressed={compact}
            onClick={() => setCompact((v) => !v)}
            disabled={status !== 'ready'}
          >
            {compact ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </HeaderIconButton>
          <Button className={HEADER_PRIMARY} onClick={() => setCreating(true)} disabled={status !== 'ready' || busy}>
            <Plus className="h-4 w-4" />
            New question
          </Button>
        </div>
      </div>

      {status === 'missing' && (
        <p className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
          The first_run_questions table has not been created yet. Apply ops/first_run_questions.sql, then reload. Until
          then the portal asks its built-in set.
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load the questions: {loadError}
        </p>
      )}

      {/* The wizard has no way out as a whole, so an all-required set is a wall. */}
      {status === 'ready' && allRequired && (
        <p className="flex items-start gap-2 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Every live question is required, so a new operator must answer all {live.length} before reaching their
            dashboard. Consider making the least important one optional.
          </span>
        </p>
      )}

      {status === 'loading' ? (
        <div className="space-y-6 pt-2">
          <div className="h-[460px] animate-pulse rounded-3xl border border-border bg-muted/40" />
        </div>
      ) : status === 'ready' ? (
        <div className="space-y-6 pt-2">
          {compact && rows.length > 0 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2" aria-label="Questions, drag to reorder">
                  {rows.map((q) => {
                    const stepIndex = live.findIndex((r) => r.id === q.id);
                    return (
                      <MiniQuestion
                        key={q.id}
                        question={q}
                        step={stepIndex >= 0 ? stepIndex + 1 : null}
                        disabled={busy}
                        onOpen={() => openFull(q.id)}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          ) : /* Every step, one after the other, each as the wizard shows it. */
          rows.length > 0 ? (
            rows.map((q, index) => {
              const stepIndex = live.findIndex((r) => r.id === q.id);
              return (
                <div key={q.id} id={`question-${q.id}`} className="scroll-mt-6">
                  <OnboardingQuestionCard
                    question={q}
                    draft={drafts[q.id] ?? draftOf(q)}
                    step={stepIndex >= 0 ? stepIndex + 1 : null}
                    liveCount={live.length}
                    busy={busy}
                    pending={pending}
                    isFirst={index === 0}
                    isLast={index === rows.length - 1}
                    onDraftChange={(patch) => setDrafts((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] ?? draftOf(q)), ...patch } }))}
                    onSave={() => void saveContent(q)}
                    onDiscard={() => setDrafts((prev) => ({ ...prev, [q.id]: draftOf(q) }))}
                    onTogglePublished={(next) => void write(q, { is_published: next }, 'published')}
                    onSaveSettings={(patch) => void saveSettings(q, patch)}
                    onMove={(delta) => void move(index, delta)}
                    onDelete={() => void remove(q)}
                  />
                </div>
              );
            })
          ) : (
            <p className="rounded-3xl border border-dashed border-border px-6 py-14 text-center text-sm text-muted-foreground">
              No questions yet. Add one with New question.
            </p>
          )}
        </div>
      ) : null}

      <NewQuestionDialog open={creating} busy={pending === 'create'} onClose={() => setCreating(false)} onCreate={create} />
    </div>
  );
}

function NewQuestionDialog({
  open,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (kind: QuestionKind, prompt: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<QuestionKind>('single');
  const [prompt, setPrompt] = useState('');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
        else {
          setKind('single');
          setPrompt('');
        }
      }}
    >
      <DialogContent className="max-w-[520px] gap-5 rounded-3xl p-6">
        <DialogHeader className="text-left">
          <DialogTitle>New question</DialogTitle>
          <DialogDescription>It is added switched off, so nobody is asked it until you turn it on.</DialogDescription>
        </DialogHeader>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">Question</span>
          <input
            autoFocus
            value={prompt}
            maxLength={120}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Do you deliver cars to customers?"
            className="h-10 w-full rounded-full border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
        </label>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-foreground">How they answer</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(KIND_LABEL) as QuestionKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'h-10 rounded-full border text-[13px] font-medium transition-colors',
                  kind === k ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            disabled={busy || !prompt.trim()}
            onClick={async () => {
              if (await onCreate(kind, prompt)) onClose();
            }}
          >
            Add question
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A question minimised to one row: grip, number, the question, its type. */
function MiniQuestion({
  question,
  step,
  disabled,
  onOpen,
}: {
  question: OnboardingQuestion;
  step: number | null;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: question.id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5',
        !question.is_published && 'opacity-60',
        isDragging && 'relative z-10 shadow-lg ring-1 ring-primary/30',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Drag to reorder: ${question.prompt || question.question_key}`}
        title="Drag to reorder"
        className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span
        className={cn(
          'flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
          step ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
        )}
      >
        {step ?? 'Off'}
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-[15px] font-medium text-foreground hover:text-primary">
        {question.prompt || 'Untitled question'}
      </button>
      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{KIND_LABEL[question.kind]}</span>
      {!question.is_required && (
        <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Optional</span>
      )}
    </li>
  );
}
