'use client';

/**
 * One onboarding question as the portal's first-run wizard draws it, edited in
 * place (Ghulam, Oct 19 2026: "exactly like the way we display onboarding on
 * northwind, with controls to edit", the Signup Plans pattern).
 *
 * The card is a small copy of the wizard screen (apps/portal/src/components/
 * onboarding/first-run-wizard.tsx): the question at display size on the soft
 * brand wash, the help line, the answers as dot rows (pick one), square rows
 * (pick any) or a bare rule (free text), then the progress hairlines and
 * Skip / Continue. Every piece of text on it is the field: click and type.
 *
 *   on the card      prompt, help, options (add, reorder, remove), placeholder,
 *                    then Save / Discard while there are edits
 *   top right        the switch (live in the wizard or not) and the gear
 *   settings dialog  answer type, required, the answer key (locked once saved),
 *                    each option's stored value, move earlier / later, delete
 */

import { ArrowLeft, ArrowRight, Check, GripVertical, Loader2, Plus, Settings2, Trash2 } from 'lucide-react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { INLINE } from './signup-plan-editable-card';

export type QuestionKind = 'single' | 'multi' | 'text';

export interface QuestionOption {
  value: string;
  label: string;
}

export interface OnboardingQuestion {
  id: string;
  question_key: string;
  kind: QuestionKind;
  prompt: string;
  help: string;
  placeholder: string;
  options: QuestionOption[];
  is_required: boolean;
  sort_order: number;
  is_published: boolean;
}

/** What the card edits. Settings (kind, required, values) save from the dialog. */
export type QuestionDraft = Pick<OnboardingQuestion, 'prompt' | 'help' | 'placeholder' | 'options'>;

export const KIND_LABEL: Record<QuestionKind, string> = {
  single: 'Pick one',
  multi: 'Pick any',
  text: 'Free text',
};

export const draftOf = (q: OnboardingQuestion): QuestionDraft => ({
  prompt: q.prompt,
  help: q.help,
  placeholder: q.placeholder,
  options: q.options.map((o) => ({ ...o })),
});

export function isDraftDirty(q: OnboardingQuestion, d: QuestionDraft): boolean {
  return JSON.stringify(draftOf(q)) !== JSON.stringify(d);
}

/** A stored value from a label: "SUVs & crossovers" -> "suvs_crossovers". */
export const slugOf = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

export function draftIssue(kind: QuestionKind, d: QuestionDraft): string | null {
  if (!d.prompt.trim()) return 'The question needs a heading.';
  if (kind === 'text') return null;
  if (d.options.length === 0) return 'Add at least one answer.';
  if (d.options.some((o) => !o.label.trim())) return 'Every answer needs a label.';
  const values = d.options.map((o) => o.value || slugOf(o.label));
  if (new Set(values).size !== values.length) return 'Two answers would be stored the same way. Change one.';
  return null;
}

export interface OnboardingQuestionCardProps {
  question: OnboardingQuestion;
  draft: QuestionDraft;
  /** 1-based place among the live questions; null while it is off. */
  step: number | null;
  liveCount: number;
  busy: boolean;
  pending: string | null;
  isFirst: boolean;
  isLast: boolean;
  onDraftChange: (patch: Partial<QuestionDraft>) => void;
  onSave: () => void;
  onDiscard: () => void;
  onTogglePublished: (next: boolean) => void;
  onSaveSettings: (patch: Partial<OnboardingQuestion>) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  dragging?: boolean;
}

export function OnboardingQuestionCard({
  question,
  draft,
  step,
  liveCount,
  busy,
  pending,
  isFirst,
  isLast,
  onDraftChange,
  onSave,
  onDiscard,
  onTogglePublished,
  onSaveSettings,
  onMove,
  onDelete,
  dragging = false,
}: OnboardingQuestionCardProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dirty = isDraftDirty(question, draft);
  const issue = draftIssue(question.kind, draft);
  const saving = pending === `${question.id}:content`;
  const multi = question.kind === 'multi';

  const setOptions = (options: QuestionOption[]) => onDraftChange({ options });

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={`Question: ${question.prompt || question.question_key}`}>
      <div
        className={cn(
          'relative isolate flex min-h-[calc(100dvh-14rem)] flex-col overflow-hidden rounded-3xl border border-border bg-card px-6 pb-6 pt-6 transition-opacity sm:px-12 sm:pb-8 sm:pt-8',
          !question.is_published && 'opacity-60',
          dragging && 'shadow-lg ring-1 ring-primary/30',
        )}
      >
        {/* The wizard's wash: two soft brand blobs, mirrored and still. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -right-48 -top-48 size-[36rem] rounded-full blur-[120px]" style={{ backgroundColor: 'hsl(var(--primary) / 0.10)' }} />
          <div className="absolute -bottom-48 -left-48 size-[36rem] rounded-full blur-[120px]" style={{ backgroundColor: 'hsl(var(--chart-3) / 0.08)' }} />
        </div>

        {/* The question, at the wizard's display size. */}
        <textarea
          value={draft.prompt}
          rows={1}
          maxLength={120}
          disabled={busy}
          placeholder="Ask something"
          aria-label="Question"
          onChange={(e) => onDraftChange({ prompt: e.target.value })}
          className={cn(INLINE, 'resize-none py-1 text-[clamp(2rem,4vw,3.5rem)] font-medium leading-[1.04] tracking-[-0.032em] text-foreground [field-sizing:content]')}
        />
        <textarea
          rows={1}
          value={draft.help}
          maxLength={200}
          disabled={busy}
          placeholder="A supporting line (optional)"
          aria-label="Help line"
          onChange={(e) => onDraftChange({ help: e.target.value })}
          className={cn(INLINE, 'mt-2 max-w-[52ch] resize-none py-1 text-[15px] leading-relaxed text-muted-foreground [field-sizing:content]')}
        />

        {/* The answers, drawn as the wizard draws them. */}
        <div className="mt-6 flex-1">
          {question.kind === 'text' ? (
            <div className="relative max-w-[26rem] pt-1">
              <input
                value={draft.placeholder}
                maxLength={80}
                disabled={busy}
                placeholder="Placeholder, e.g. Denver, CO"
                aria-label="Placeholder"
                onChange={(e) => onDraftChange({ placeholder: e.target.value })}
                className={cn(INLINE, 'h-10 pb-1 text-2xl tracking-tight text-foreground/35 placeholder:text-foreground/20')}
              />
              <span aria-hidden className="mt-1 block h-px w-full bg-foreground/15" />
            </div>
          ) : (
            <AnswerList options={draft.options} multi={multi} busy={busy} onChange={setOptions} />
          )}
        </div>

        {/* The wizard's footer: progress hairlines, and Skip on optional questions. */}
        <div className="mt-6 flex items-center justify-between gap-4">
          <div aria-hidden className="flex items-center gap-1.5">
            {Array.from({ length: Math.max(liveCount, 1) }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-[3px] rounded-full',
                  step !== null && i === step - 1 ? 'w-7 bg-primary' : step !== null && i < step - 1 ? 'w-4 bg-primary/40' : 'w-4 bg-foreground/[0.12]',
                )}
              />
            ))}
            {!question.is_required && <span className="ml-4 text-[13px] text-muted-foreground">Skip this question</span>}
          </div>
          <div>
            {/* Its place and tags, live in the wizard, then the settings: pinned to the card's corner. */}
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
              <span className="rounded-full bg-card/80 px-2.5 py-1 text-[11px] font-semibold text-foreground ring-1 ring-inset ring-border backdrop-blur">
                {step ? `Question ${step} of ${liveCount}` : 'Off'}
              </span>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{KIND_LABEL[question.kind]}</span>
              {!question.is_required && (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Optional</span>
              )}
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              {pending === `${question.id}:published` ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <Switch
                  checked={question.is_published}
                  disabled={busy}
                  onCheckedChange={onTogglePublished}
                  aria-label={question.is_published ? 'Take this question out of the wizard' : 'Put this question in the wizard'}
                  title={question.is_published ? 'Asked in the wizard' : 'Not asked'}
                />
              )}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Question settings"
                title="Question settings"
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-primary/10 hover:text-primary motion-reduce:transition-none"
              >
                <Settings2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {/* Save, only while there is something to save. */}
        {(dirty || saving) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button className="rounded-full" size="sm" disabled={busy || issue !== null} onClick={onSave}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save question'}
            </Button>
            <Button variant="ghost" size="sm" className="rounded-full" disabled={busy} onClick={onDiscard}>
              Discard changes
            </Button>
            {issue && <span className="text-xs text-destructive">{issue}</span>}
          </div>
        )}
      </div>

      <QuestionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        question={question}
        busy={busy}
        isFirst={isFirst}
        isLast={isLast}
        onSave={(patch) => {
          onSaveSettings(patch);
          setSettingsOpen(false);
        }}
        onMove={onMove}
        onDelete={() => {
          setSettingsOpen(false);
          onDelete();
        }}
      />
    </section>
  );
}

let answerKeySeq = 0;
const newAnswerKey = () => `a${++answerKeySeq}`;

/**
 * The answers as the wizard draws them, each row draggable by its grip (shown on
 * hover, left of the dot). Rows carry local keys so a drag keeps typed text and
 * focus with the row that moved.
 */
function AnswerList({
  options,
  multi,
  busy,
  onChange,
}: {
  options: QuestionOption[];
  multi: boolean;
  busy: boolean;
  onChange: (options: QuestionOption[]) => void;
}) {
  const keys = useRef<string[]>([]);
  // Discard or save swaps the list wholesale; give it fresh keys when the length disagrees.
  if (keys.current.length !== options.length) keys.current = options.map(() => newAnswerKey());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = keys.current.indexOf(String(active.id));
    const to = keys.current.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    keys.current = arrayMove(keys.current, from, to);
    onChange(arrayMove(options, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={keys.current} strategy={verticalListSortingStrategy}>
        <ul className="-ml-7 flex flex-col gap-0.5" aria-label="Answers">
          {options.map((option, index) => (
            <AnswerRow
              key={keys.current[index]}
              id={keys.current[index]}
              option={option}
              index={index}
              first={index === 0}
              multi={multi}
              busy={busy}
              canRemove={options.length > 1}
              onLabel={(label) => onChange(options.map((o, i) => (i === index ? { ...o, label } : o)))}
              onRemove={() => {
                keys.current = keys.current.filter((_, i) => i !== index);
                onChange(options.filter((_, i) => i !== index));
              }}
            />
          ))}
          <li className="pl-7">
            <button
              type="button"
              disabled={busy || options.length >= 12}
              onClick={() => {
                keys.current = [...keys.current, newAnswerKey()];
                onChange([...options, { value: '', label: '' }]);
              }}
              className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
            >
              <Plus className="size-3.5" aria-hidden /> Add answer
              <span className="font-normal">{options.length}/12</span>
            </button>
          </li>
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function AnswerRow({
  id,
  option,
  index,
  first,
  multi,
  busy,
  canRemove,
  onLabel,
  onRemove,
}: {
  id: string;
  option: QuestionOption;
  index: number;
  first: boolean;
  multi: boolean;
  busy: boolean;
  canRemove: boolean;
  onLabel: (label: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: busy });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group/opt relative flex items-center gap-2 rounded-full py-1', isDragging && 'z-10 bg-card shadow-md ring-1 ring-primary/25')}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Drag answer ${index + 1} to reorder`}
        title="Drag to reorder"
        className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/opt:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span aria-hidden className="relative flex size-5 shrink-0 items-center justify-center">
        {first ? (
          multi ? (
            <span className="flex size-[15px] items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
          ) : (
            <span className="size-[10px] rounded-full bg-primary" />
          )
        ) : (
          <span className={cn('size-[10px] ring-1 ring-foreground/30', multi ? 'rounded-[3px]' : 'rounded-full')} />
        )}
      </span>
      <input
        value={option.label}
        maxLength={60}
        disabled={busy}
        placeholder="An answer"
        aria-label={`Answer ${index + 1}`}
        onChange={(e) => onLabel(e.target.value)}
        className={cn(INLINE, 'ml-1 h-8 w-auto min-w-[8rem] max-w-[32rem] text-[17px] [field-sizing:content]', first ? 'font-medium text-foreground' : 'text-foreground/60')}
      />
      {/* Remove, right after the text, only while hovered or focused. */}
      <span className="pointer-events-none flex items-center rounded-full bg-card opacity-0 shadow-sm ring-1 ring-border transition-opacity duration-200 focus-within:pointer-events-auto focus-within:opacity-100 group-hover/opt:pointer-events-auto group-hover/opt:opacity-100 motion-reduce:transition-none">
        <IconButton label={`Remove answer ${index + 1}`} disabled={busy || !canRemove} onClick={onRemove} danger>
          <Trash2 className="size-3.5" />
        </IconButton>
      </span>
    </li>
  );
}

function QuestionSettingsDialog({
  open,
  onOpenChange,
  question,
  busy,
  isFirst,
  isLast,
  onSave,
  onMove,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: OnboardingQuestion;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSave: (patch: Partial<OnboardingQuestion>) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [kind, setKind] = useState(question.kind);
  const [required, setRequired] = useState(question.is_required);
  const [values, setValues] = useState(question.options.map((o) => o.value));

  // Fresh from the saved row every time it opens.
  const reset = () => {
    setKind(question.kind);
    setRequired(question.is_required);
    setValues(question.options.map((o) => o.value));
  };

  const changed =
    kind !== question.kind ||
    required !== question.is_required ||
    values.some((v, i) => v !== question.options[i]?.value);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-[520px] gap-5 rounded-3xl p-6">
        <DialogHeader className="text-left">
          <DialogTitle>Question settings</DialogTitle>
          <DialogDescription className="line-clamp-1">{question.prompt || 'Untitled question'}</DialogDescription>
        </DialogHeader>

        <SettingRow label="Answer type">
          <div className="inline-flex rounded-full bg-muted p-1">
            {(Object.keys(KIND_LABEL) as QuestionKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors',
                  kind === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow label="Required" hint={required ? 'Must be answered to continue.' : 'Shows “Skip this question”.'}>
          <Switch checked={required} onCheckedChange={setRequired} aria-label="Required" />
        </SettingRow>

        <SettingRow label="Answer key" hint="Answers are stored under this. Locked, so collected answers are never orphaned.">
          <code className="rounded-lg bg-muted px-2.5 py-1 font-mono text-[12px] text-foreground">{question.question_key}</code>
        </SettingRow>

        {question.kind !== 'text' && question.options.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Stored values</p>
            <p className="text-xs text-muted-foreground">What lands in the database for each answer. New answers get one from their label.</p>
            <div className="space-y-1.5">
              {question.options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{o.label}</span>
                  <input
                    value={values[i] ?? ''}
                    onChange={(e) => setValues(values.map((v, n) => (n === i ? slugOf(e.target.value) || e.target.value.toLowerCase() : v)))}
                    className="h-8 w-40 rounded-lg border border-border bg-background px-2.5 font-mono text-[12px]"
                    aria-label={`Stored value for ${o.label}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <SettingRow label="Order">
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="rounded-full" disabled={busy || isFirst} onClick={() => onMove(-1)}>
              <ArrowLeft className="size-3.5" /> Earlier
            </Button>
            <Button variant="outline" size="sm" className="rounded-full" disabled={busy || isLast} onClick={() => onMove(1)}>
              Later <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </SettingRow>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="sm" className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={onDelete}>
            <Trash2 className="size-4" /> Delete question
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="rounded-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              size="sm"
              className="rounded-full"
              disabled={busy || !changed}
              onClick={() =>
                onSave({
                  kind,
                  is_required: required,
                  options: question.options.map((o, i) => ({ ...o, value: values[i] || slugOf(o.label) })),
                })
              }
            >
              Save settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  danger,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-40',
        danger ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-primary/10 hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}
