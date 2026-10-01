'use client';

/**
 * To do — the third card under the revenue chart (Sep 27 2026).
 *
 * The operator's own list: things to do, optionally with a time. Backed by
 * `useTenantNotes` (`public.tenant_notes`, live in production), so every add,
 * tick and delete is real.
 *
 * The shape of it:
 *  - a composer at the top: type, press Enter; the clock opens a small
 *    "Remind me" dialog (reminder-picker.tsx) for the time
 *  - the open items, soonest first; each carries its time as a chip that turns
 *    red once it has passed
 *  - ticking an item strikes it through; it stays in the one list, after the
 *    open ones
 *
 * Flat, like the rest of the page: no shadows; the only colour is the accent
 * on the tick and the time, and red for what is overdue.
 *
 * TENANT ISOLATION: the hook filters every select/insert/update/delete by
 * `tenant_id` (V2_PLAN §5); this component issues no query of its own.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { format, isToday, isTomorrow } from 'date-fns';
import { AlarmClock, Check, MoreVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { MAX_NOTE_LENGTH, useTenantNotes, type TenantNote } from '@/hooks/use-tenant-notes';
import { Eyebrow } from './ui';
import { ExpandButton } from './expand-button';
import { PHONE_SHEET, SheetGrabber } from './phone-sheet';
import { CardGrip } from './sortable-cards';
import { ReminderPicker, describeWhen } from './reminder-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buildDemoTodos } from './mock';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';
import { useSkeletonLoading } from '@/hooks/use-skeleton-loading';
import { skeletonRows } from '@/lib/skeleton-data';

/** Placeholder to-dos for the skeleton: only their lengths are ever seen. */
const SKELETON_NOTES: TenantNote[] = skeletonRows(5, (f, i) => ({
  id: f.id,
  body: f.text(3, 6),
  remind_at: i % 2 ? null : f.date(-1),
  is_done: false,
  completed_at: null,
  created_at: f.date(),
}));

// ── Time ────────────────────────────────────────────────────────────────────

/**
 * A to-do's time, as a pill: just the time or date (Sep 29 2026: no clock
 * icon and no "overdue" wording). Red when it has passed, purple when not.
 */
function whenLabel(iso: string, now: Date): { text: string; overdue: boolean } {
  const d = new Date(iso);
  const overdue = d.getTime() < now.getTime();
  const time = format(d, 'h:mm a');
  if (isToday(d)) return { text: time, overdue };
  if (isTomorrow(d)) return { text: `Tomorrow ${time}`, overdue };
  return { text: `${format(d, 'EEE d MMM')}, ${time}`, overdue };
}


/**
 * The sample list, in the order `useTenantNotes` gives real notes: open before
 * done; among open, timed ones soonest first, then untimed newest first.
 */
function sortLikeTheHook(list: TenantNote[]): TenantNote[] {
  return [...list].sort((a, b) => {
    if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
    const aTimed = !!a.remind_at;
    const bTimed = !!b.remind_at;
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    if (aTimed && bTimed) return (a.remind_at as string).localeCompare(b.remind_at as string);
    return b.created_at.localeCompare(a.created_at);
  });
}

// ── A row ───────────────────────────────────────────────────────────────────

/** Edit a to-do: its text, and its reminder — change it, remove it, or add one. */
function EditTodoDialog({
  note,
  open,
  onOpenChange,
  onSave,
}: {
  note: TenantNote;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (body: string, remindAt: string | null) => void;
}) {
  const [body, setBody] = useState(note.body);
  const [remindAt, setRemindAt] = useState<Date | null>(note.remind_at ? new Date(note.remind_at) : null);
  // Fresh from the to-do every time it opens, so a cancelled edit leaves no trace.
  useEffect(() => {
    if (open) {
      setBody(note.body);
      setRemindAt(note.remind_at ? new Date(note.remind_at) : null);
    }
  }, [open, note.body, note.remind_at]);
  const canSave = body.trim().length > 0;
  const save = () => {
    if (!canSave) return;
    onSave(body.trim(), remindAt ? remindAt.toISOString() : null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`pv max-w-md gap-0 overflow-hidden p-0 ${PHONE_SHEET}`}>
        <SheetGrabber onClose={() => onOpenChange(false)} />
        <DialogHeader className="px-6 pb-2 pt-5 text-left">
          <DialogTitle className="text-[16px] font-semibold text-[var(--pv-ink)]">Edit to-do</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-5 pt-2">
          <textarea
            autoFocus
            value={body}
            maxLength={MAX_NOTE_LENGTH}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
            }}
            aria-label="To-do"
            className="w-full resize-none rounded-xl border border-[var(--pv-line)] bg-[var(--pv-wash)] px-3 py-2.5 text-[13.5px] leading-snug text-[var(--pv-ink)] outline-none transition-colors focus:border-[var(--pv-accent)] focus:bg-[var(--pv-paper)]"
          />
          {/* The reminder: add one, change it, or take it off. */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--pv-line)] px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-[13px]">
              <AlarmClock className="size-4 shrink-0 text-[var(--pv-accent-ink)]" strokeWidth={2.25} />
              {remindAt ? (
                <span className="truncate font-medium text-[var(--pv-ink)]">{describeWhen(remindAt)}</span>
              ) : (
                <span className="text-[var(--pv-ink-3)]">No reminder</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {remindAt && (
                <button
                  type="button"
                  onClick={() => setRemindAt(null)}
                  className="rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--pv-ink-3)] transition-colors hover:bg-[var(--pv-wash)] hover:text-[var(--pv-late)]"
                >
                  Remove
                </button>
              )}
              <ReminderPicker value={remindAt} onChange={setRemindAt}>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-[12px] font-semibold text-[var(--pv-accent-ink)] transition-colors hover:bg-[var(--pv-accent-bg)]"
                >
                  {remindAt ? 'Change' : 'Add a reminder'}
                </button>
              </ReminderPicker>
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--pv-line)] px-6 py-3.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[var(--pv-ink-2)] transition-colors hover:bg-[var(--pv-wash)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="rounded-lg bg-[var(--pv-accent)] px-4 py-2 text-[13px] font-medium text-[var(--pv-on-accent,#fff)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Are you sure?" before a to-do is deleted for good. */
function DeleteTodoDialog({
  note,
  open,
  onOpenChange,
  onDelete,
}: {
  note: TenantNote;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={`pv max-w-sm gap-0 overflow-hidden p-0 ${PHONE_SHEET}`}>
        <SheetGrabber onClose={() => onOpenChange(false)} />
        <div className="px-6 pb-5 pt-6">
          <DialogTitle className="text-[16px] font-semibold text-[var(--pv-ink)]">Delete this to-do?</DialogTitle>
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug text-[var(--pv-ink-2)]">&ldquo;{note.body}&rdquo;</p>
          <p className="mt-2 text-[12px] text-[var(--pv-ink-3)]">This can&rsquo;t be undone.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--pv-line)] px-6 py-3.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[var(--pv-ink-2)] transition-colors hover:bg-[var(--pv-wash)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete();
              onOpenChange(false);
            }}
            className="rounded-lg bg-[var(--pv-late)] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TodoItem({
  note,
  now,
  onToggle,
  onDelete,
  onEdit,
  inDialog = false,
}: {
  note: TenantNote;
  now: Date;
  onToggle: () => void;
  onDelete: () => void;
  /** Save new text and reminder (`null` clears it) for this to-do. */
  onEdit: (body: string, remindAt: string | null) => void;
  /** In the expanded dialog: plain Edit / Delete icons instead of the ⋮ menu. */
  inDialog?: boolean;
}) {
  const when = note.remind_at && !note.is_done ? whenLabel(note.remind_at, now) : null;
  // The ⋮ menu opens one of these two dialogs.
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // A left swipe asks first, the same as ⋮ → Delete.
  const swipe = useSwipe({ onRight: onToggle, onLeft: () => setDeleteOpen(true) });
  return (
    // On a touch screen the row swipes like iOS Reminders: right to tick it
    // off (or back on), left to delete. The actions sit behind the row and
    // are revealed as it slides.
    <li className="relative overflow-hidden rounded-lg">
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-between px-4 md:hidden">
        <span
          className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--pv-accent)] transition-opacity"
          style={{ opacity: swipe.dx > 12 ? 1 : 0 }}
        >
          <Check className="size-4" strokeWidth={3} /> {note.is_done ? 'Not done' : 'Done'}
        </span>
        <span
          className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--pv-late)] transition-opacity"
          style={{ opacity: swipe.dx < -12 ? 1 : 0 }}
        >
          Delete <Trash2 className="size-4" strokeWidth={2.25} />
        </span>
      </div>
    <div
      {...swipe.handlers}
      style={swipe.style}
      // Click anywhere on the row to tick it off (Sep 29 2026). Ignored when
      // the click came from a dialog (portalled, so not inside this element),
      // from the ⋮ menu, or at the end of a swipe.
      onClick={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        if ((e.target as HTMLElement).closest('[data-row-menu]')) return;
        if (swipe.justSwiped()) return;
        onToggle();
      }}
      className="group relative flex cursor-pointer touch-pan-y items-start gap-3 rounded-lg bg-[var(--pv-paper)] px-2 py-[11px] transition-colors hover:bg-[var(--pv-wash)]"
    >
      {/* The tick: an empty ring that fills with the accent. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={note.is_done ? 'Mark as not done' : 'Mark as done'}
        aria-pressed={note.is_done}
        className={cn(
          'mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-200',
          note.is_done
            ? 'border-[var(--pv-accent)] bg-[var(--pv-accent)] text-[var(--pv-on-accent)]'
            : cn(
                'text-transparent hover:border-[var(--pv-accent)] hover:text-[var(--pv-accent-ink)]',
                when?.overdue ? 'border-[var(--pv-late)]' : 'border-[var(--pv-line-2)]'
              )
        )}
      >
        <Check className="size-2.5" strokeWidth={3.5} />
      </button>

      {/* The text and its time. Side by side on a desktop; on a phone the time
          drops to a small line under the title, the way iOS Reminders does. */}
      <span className="flex min-w-0 flex-1 items-start justify-between gap-3 max-md:flex-col max-md:justify-start max-md:gap-0.5">
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] leading-[18px] transition-colors duration-300 max-md:w-full max-md:text-[15px] max-md:leading-5',
          note.is_done ? 'text-[var(--pv-ink-3)]' : 'text-[var(--pv-ink)]'
        )}
      >
        {/* The strike is DRAWN across the words only (an inline span, so the
            line ends where the text does): a 1px line whose width runs from
            0 to 100% as the to-do is ticked, and back when unticked. */}
        <span
          className={cn(
            'bg-[linear-gradient(currentColor,currentColor)] bg-[position:0_55%] bg-no-repeat transition-[background-size] duration-300 ease-out',
            note.is_done ? 'bg-[length:100%_1px]' : 'bg-[length:0%_1px]'
          )}
        >
          {note.body}
        </span>
      </span>

      {when && (
        <span
          className={cn(
            'mt-px flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums max-md:mt-0 max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:text-[12px]',
            when.overdue
              ? 'bg-[var(--pv-late-bg)] text-[var(--pv-late)]'
              : 'bg-[var(--pv-accent-bg)] text-[var(--pv-accent-ink)]'
          )}
        >
          {when.text}
        </span>
      )}
      </span>

      {inDialog ? (
        // Plain icons in the expanded dialog, where there is room for them.
        <span data-row-menu="" className="-my-1 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            aria-label="Edit to-do"
            title="Edit"
            className="flex size-7 items-center justify-center rounded-lg text-[var(--pv-ink-3)] transition-colors hover:bg-[var(--pv-accent-bg)] hover:text-[var(--pv-accent-ink)]"
          >
            <Pencil className="size-3.5" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete to-do"
            title="Delete"
            className="flex size-7 items-center justify-center rounded-lg text-[var(--pv-ink-3)] transition-colors hover:bg-[var(--pv-late-bg)] hover:text-[var(--pv-late)]"
          >
            <Trash2 className="size-3.5" strokeWidth={2.25} />
          </button>
        </span>
      ) : (
      /* The row's own menu, last in the row: Edit and Delete (Sep 29 2026,
         in place of the hover ✕). */
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-row-menu=""
            aria-label="To-do options"
            /* Takes NO space until the row is hovered (or the menu is open /
               focused): zero width and a negative margin that cancels the row's
               gap, so the text and time use the whole row. It then slides open.
               Always shown on touch screens, which have no hover. */
            className="-my-0.5 -ml-3 flex h-[22px] w-0 shrink-0 items-center justify-center overflow-hidden rounded-md text-[var(--pv-ink-3)] opacity-0 outline-none translate-x-1 transition-[width,margin,opacity,transform,background-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0 data-[state=open]:translate-x-0 hover:bg-[var(--pv-line)] hover:text-[var(--pv-ink)] focus-visible:ml-0 focus-visible:w-[22px] focus-visible:opacity-100 group-hover:ml-0 group-hover:w-[22px] group-hover:opacity-100 data-[state=open]:ml-0 data-[state=open]:w-[22px] data-[state=open]:bg-[var(--pv-line)] data-[state=open]:text-[var(--pv-ink)] data-[state=open]:opacity-100 max-md:ml-0 max-md:w-[22px] max-md:opacity-100"
          >
            <MoreVertical className="size-3.5" strokeWidth={2.25} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="pv w-36 rounded-xl border-[var(--pv-line)] p-1 shadow-none">
          <DropdownMenuItem
            onSelect={() => {
              // After the menu has closed and handed focus back.
              window.setTimeout(() => setEditOpen(true), 0);
            }}
            className="gap-2 rounded-lg text-[13px]"
          >
            <Pencil className="size-3.5" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              window.setTimeout(() => setDeleteOpen(true), 0);
            }}
            className="gap-2 rounded-lg text-[13px] text-[var(--pv-late)] focus:bg-[var(--pv-late-bg)] focus:text-[var(--pv-late)]"
          >
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      )}
      <EditTodoDialog note={note} open={editOpen} onOpenChange={setEditOpen} onSave={onEdit} />
      <DeleteTodoDialog note={note} open={deleteOpen} onOpenChange={setDeleteOpen} onDelete={onDelete} />
    </div>
    </li>
  );
}

/** How far a row must be swiped before letting go acts on it. */
const SWIPE_ACT_PX = 80;

/**
 * Horizontal swipe on touch (never mouse): the row follows the finger, and
 * letting go past SWIPE_ACT_PX calls onRight / onLeft; otherwise it springs
 * back. Vertical drags are left to the page (`touch-pan-y` on the row), so the
 * list still scrolls normally.
 */
function useSwipe({ onRight, onLeft }: { onRight: () => void; onLeft: () => void }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const locked = useRef<'x' | 'y' | null>(null);
  const swipedAt = useRef(0);

  const reset = () => {
    start.current = null;
    locked.current = null;
    setDragging(false);
    setDx(0);
  };

  return {
    dx,
    /** True right after a horizontal swipe, so its trailing click is not a tick. */
    justSwiped: () => Date.now() - swipedAt.current < 400,
    style: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      transition: dragging ? 'none' : 'transform 220ms cubic-bezier(.2,.8,.2,1)',
    } as CSSProperties,
    handlers: {
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.pointerType === 'mouse') return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        locked.current = null;
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const s0 = start.current;
        if (!s0 || s0.id !== e.pointerId) return;
        const x = e.clientX - s0.x;
        const y = e.clientY - s0.y;
        if (!locked.current) {
          if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
          locked.current = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
          if (locked.current === 'x') setDragging(true);
        }
        if (locked.current === 'x') setDx(Math.max(-140, Math.min(140, x)));
      },
      onPointerUp: () => {
        if (locked.current === 'x') {
          swipedAt.current = Date.now();
          if (dx > SWIPE_ACT_PX) onRight();
          else if (dx < -SWIPE_ACT_PX) onLeft();
        }
        reset();
      },
      onPointerCancel: reset,
    },
  };
}

// ── The card ────────────────────────────────────────────────────────────────

export function TodoCard() {
  const real = useTenantNotes();
  // PREVIEW (Sep 27 2026): a sample list — overdue, later today, tomorrow,
  // next week, untimed and done — is ON BY DEFAULT while the design is
  // reviewed; `?demo-todos=0` shows the tenant's real list. In sample mode
  // every tick, delete and add changes this list in memory only and never
  // reaches `tenant_notes`. Flip the default back (`=== '1'`) before this
  // widens past the canary.
  const demo = useSearchParams()?.get('demo-todos') !== '0';
  const [demoNotes, setDemoNotes] = useState<TenantNote[]>(() => buildDemoTodos());

  const isLoading = useSkeletonLoading(!demo && real.isLoading);
  const notes = isLoading ? SKELETON_NOTES : demo ? sortLikeTheHook(demoNotes) : real.notes;
  const isUnavailable = !demo && real.isUnavailable;
  const adding = !demo && real.addNote.isPending;
  const toggle = (n: TenantNote) =>
    demo
      ? setDemoNotes((all) =>
          all.map((x) =>
            x.id === n.id ? { ...x, is_done: !x.is_done, completed_at: x.is_done ? null : new Date().toISOString() } : x
          )
        )
      : real.toggleDone.mutate(n);
  const edit = (n: TenantNote, body: string, remindAt: string | null) =>
    demo
      ? setDemoNotes((all) => all.map((x) => (x.id === n.id ? { ...x, body, remind_at: remindAt } : x)))
      : real.editNote.mutate({ note: n, body, remindAt });
  const remove = (n: TenantNote) =>
    demo ? setDemoNotes((all) => all.filter((x) => x.id !== n.id)) : real.deleteNote.mutate(n);
  const add = (body: string, remindAt: string | null, done: () => void) => {
    if (demo) {
      const now = new Date().toISOString();
      setDemoNotes((all) => [
        { id: `demo-todo-new-${now}`, body, remind_at: remindAt, is_done: false, completed_at: null, created_at: now },
        ...all,
      ]);
      done();
    } else {
      real.addNote.mutate({ body, remindAt }, { onSuccess: done });
    }
  };
  const now = useMemo(() => new Date(), [notes]);


  // Composer.
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState('');
  const [remindAt, setRemindAt] = useState<Date | null>(null);
  const canAdd = body.trim().length > 0 && !adding && !isUnavailable;

  const submit = () => {
    if (!canAdd) return;
    add(body.trim(), remindAt ? remindAt.toISOString() : null, () => {
      setBody('');
      setRemindAt(null);
      inputRef.current?.focus();
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  // The add box and the list, drawn in the card and again, larger, in the
  // expanded dialog. Both read and write the same state.
  const composer = (
    <div className="px-4 pt-2.5">
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl border bg-[var(--pv-wash)] px-3 transition-colors focus-within:border-[var(--pv-accent)] focus-within:bg-[var(--pv-paper)]',
          'border-transparent'
        )}
      >
        <Plus className="size-3.5 shrink-0 text-[var(--pv-ink-3)]" strokeWidth={2.5} />
        <input
          ref={inputRef}
          value={body}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKey}
          disabled={isUnavailable}
          placeholder={isUnavailable ? 'Your list is not available yet' : 'Add a to-do and press Enter'}
          className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--pv-ink)] outline-none placeholder:text-[var(--pv-ink-3)]"
        />
        {remindAt && (
          <button
            type="button"
            onClick={() => setRemindAt(null)}
            className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--pv-accent-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--pv-accent-ink)]"
            title="Remove the time"
          >
            {describeWhen(remindAt)}
            <X className="size-2.5" strokeWidth={3} />
          </button>
        )}
        <ReminderPicker
          value={remindAt}
          onChange={(d) => {
            setRemindAt(d);
            inputRef.current?.focus();
          }}
        >
          <button
            type="button"
            aria-label={remindAt ? 'Change the reminder' : 'Add a reminder'}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors data-[state=open]:bg-[var(--pv-accent-bg)] data-[state=open]:text-[var(--pv-accent-ink)]',
              remindAt
                ? 'bg-[var(--pv-accent-bg)] text-[var(--pv-accent-ink)]'
                : 'text-[var(--pv-ink-3)] hover:bg-[var(--pv-line)] hover:text-[var(--pv-ink)]'
            )}
          >
            <AlarmClock className="size-3.5" strokeWidth={2.25} />
          </button>
        </ReminderPicker>
      </div>

    </div>
  );

  // Scrolls inside its container when long (no fade at the edge). A grid
  // of one stretched cell, so the AutoSkeleton wrapper still gives the empty
  // state its full height to centre in.
  // `inDialog`: the expanded dialog's rows show Edit / Delete icons instead of
  // the ⋮ menu (a dropdown there would open underneath the dialog).
  const listFor = (inDialog: boolean) => (
    <div
      className="relative mt-1.5 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-y-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <AutoSkeleton loading={isLoading} className="h-full">
      {notes.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-[var(--pv-accent-bg)] text-[var(--pv-accent-ink)]">
            <Check className="size-5" strokeWidth={2.5} />
          </span>
          <p className="text-[13px] font-medium text-[var(--pv-ink)]">A clear desk</p>
          <p className="max-w-[220px] text-[11.5px] text-[var(--pv-ink-3)]">
            Jot down anything you need to remember, and give it a time if you want a nudge.
          </p>
        </div>
      ) : (
        <>
          {/* One list (Sep 27 2026): done items stay in it, struck through,
              after the open ones — no folded "Done" section. */}
          <ul>
            {notes.map((n) => (
              <TodoItem
                  inDialog={inDialog}
                key={n.id}
                note={n}
                now={now}
                onToggle={() => toggle(n)}
                onDelete={() => remove(n)}
                  onEdit={(body, remindAt) => edit(n, body, remindAt)}
              />
            ))}
          </ul>
        </>
      )}
      </AutoSkeleton>
    </div>
  );

  return (
    <div className="flex min-h-[387px] flex-col overflow-hidden rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] lg:min-h-0">
      <header className="flex items-center justify-between gap-3 px-6 pt-4">
        <Eyebrow>To do</Eyebrow>
        <span className="flex items-center gap-0.5">
          <CardGrip />
          <ExpandButton label="Open the full list" onClick={() => setExpanded(true)} />
        </span>
      </header>

      {/* On the card the add box is only a doorway (Sep 29 2026): it looks
          like the field, and clicking it opens the full To do dialog with the
          real add box focused. Adding and managing happen there. */}
      <div className="px-4 pt-2.5">
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            window.setTimeout(() => inputRef.current?.focus(), 80);
          }}
          className="flex h-8 w-full cursor-text items-center gap-2 rounded-xl bg-[var(--pv-wash)] px-3 text-left transition-colors hover:bg-[var(--pv-line)]"
        >
          <Plus className="size-3.5 shrink-0 text-[var(--pv-ink-3)]" strokeWidth={2.5} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--pv-ink-3)]">Add a to-do</span>
          <AlarmClock className="size-3.5 shrink-0 text-[var(--pv-ink-3)]" strokeWidth={2.25} />
        </button>
      </div>
      {listFor(false)}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className={`pv flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 ${PHONE_SHEET}`}>
          <SheetGrabber onClose={() => setExpanded(false)} />
          <DialogHeader className="border-b border-[var(--pv-line)] px-6 pb-4 pt-5 text-left">
            <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--pv-ink)]">To do</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col pb-2 pt-1">
            {composer}
            {listFor(true)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
