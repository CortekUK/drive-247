'use client';

/**
 * Reminders — the third card of the "On your desk" band.
 *
 * One list, holding two things: a note the operator typed, and a reminder with a
 * time beside it. That is the whole card, and the shape is the team lead's:
 * "iske andar note bhi aa jaayega, reminder bhi hum set... bas uska aage time aa
 * raha hoga — ek hi list kaafi hai inke liye."
 *
 * It also replaces something. V1 has a whole Reminders TAB, and the lead cut it:
 * in the life of the application "sirf do bandon ne do martaba hi banaye honge
 * reminders", so a tab for it earns nothing. The v1 route is NOT deleted — it is
 * hidden from lean tenants by the `reminders` key in
 * `lib/lean-areas.ts`, because that table holds 642 rows across 19 other
 * tenants who are still using it. This card is the canary's replacement for it,
 * on a different table, and the two never meet.
 *
 * ── WHAT THIS CARD DELIBERATELY DOES NOT SHOW ────────────────────────────────
 *
 * Urgent SYSTEM events — a failed agreement, a declined card, anything the
 * product noticed rather than the operator wrote — were discussed for this card
 * and then explicitly parked, in the same meeting that specified it:
 *
 *   "abhi nahi, baad mein faisla karenge ki yahan par humne kaunsi important
 *    cheezein yahan show karwani hai... abhi ke liye sirf notes add kare aur
 *    apne reminder ke saath time laga ke yahan rakh sake. Bas aur kuch nahi."
 *
 * So the absence is a decision, not an oversight. Do not add a "failed payments"
 * or "unsigned agreements" row here without that decision being made — and note
 * that the band already carries those: "Attention required now", immediately to
 * the left, is exactly that surface and is live. Two cards showing the same
 * emergency is how neither of them gets believed.
 *
 * ── VISUALS ──────────────────────────────────────────────────────────────────
 * A row is the `TodoRow` from `./home/ui`, and the composer is its `AddNote`,
 * rebuilt here because both of those are static mock chrome (a `<label>` with no
 * input; a button that does nothing). The pixels are deliberately the same, so
 * dropping this into the band is a data change and not a redesign. Everything
 * paints from the `--pv-*` tokens the band's `.pv` scope provides.
 */

import { useMemo, useRef, useState } from 'react';
import { Check, Clock, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from './home/ui';
import {
  MAX_NOTE_LENGTH,
  useTenantNotes,
  type TenantNote,
} from '@/hooks/use-tenant-notes';

/* ── The time column ───────────────────────────────────────────────────────── */

interface RemindLabel {
  text: string;
  /** Past its time and still open. */
  overdue: boolean;
  /** Falls on today's date. */
  today: boolean;
}

/** Local midnight for `d`, so "is this today" is a calendar question, not a 24h one. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A reminder's time, as short as it can be while still being unambiguous.
 *
 * Today is just the clock, because the date is the one thing you already know.
 * Everything inside the next week gets a weekday; past that, a date. 24h and
 * hand-built rather than `toLocaleTimeString`, to match the 24h clock the rest
 * of the board runs on and to keep the column four characters wide.
 *
 * Returns `null` for an unparseable timestamp rather than rendering "Invalid
 * Date" at an operator.
 */
function formatRemindAt(iso: string, now: Date): RemindLabel | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  const overdue = d.getTime() < now.getTime();

  if (days === 0) return { text: time, overdue, today: true };
  if (days === 1) return { text: `Tmrw ${time}`, overdue, today: false };
  if (days > 1 && days < 7) return { text: `${WEEKDAYS[d.getDay()]} ${time}`, overdue, today: false };
  if (days === -1) return { text: `Yest ${time}`, overdue, today: false };

  return { text: `${d.getDate()} ${MONTHS[d.getMonth()]}`, overdue, today: false };
}

/* ── A row ─────────────────────────────────────────────────────────────────── */

function NoteRow({
  note,
  now,
  onToggle,
  onDelete,
}: {
  note: TenantNote;
  now: Date;
  onToggle: (note: TenantNote) => void;
  onDelete: (note: TenantNote) => void;
}) {
  const when = note.remind_at ? formatRemindAt(note.remind_at, now) : null;

  return (
    <div className="group flex w-full items-start gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--pv-wash)]">
      {/* The box is the button. `TodoRow` wrapped its in a <label> with nothing
          to label; a real control needs to be reachable by keyboard and to
          announce its own state. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={note.is_done}
        aria-label={note.is_done ? `Mark "${note.body}" as not done` : `Mark "${note.body}" as done`}
        onClick={() => onToggle(note)}
        className={cn(
          'mt-px flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
          note.is_done
            ? 'border-[var(--pv-clear)] bg-[var(--pv-clear)] text-white'
            : 'border-[var(--pv-line-2)] group-hover:border-[var(--pv-accent)]',
        )}
      >
        {note.is_done && <Check className="size-2.5" strokeWidth={3.5} />}
      </button>

      {/* Two lines, then clamped. The operator wrote this, so it wraps rather
          than truncating at the first ellipsis — but a 500-character note must
          not be allowed to push every other row off the card. */}
      <span
        title={note.body}
        className={cn(
          'min-w-0 flex-1 break-words text-[13.5px] leading-tight',
          note.is_done ? 'text-[var(--pv-ink-3)] line-through' : 'font-medium text-[var(--pv-ink)]',
        )}
      >
        <span className="line-clamp-2">{note.body}</span>
      </span>

      {when && !note.is_done && (
        <span
          className={cn(
            'shrink-0 pt-px text-[11px] font-medium tabular-nums',
            when.overdue
              ? 'text-[var(--pv-late)]'
              : when.today
                ? 'text-[var(--pv-wait)]'
                : 'text-[var(--pv-ink-3)]',
          )}
        >
          {when.text}
        </span>
      )}

      {/* Always in the layout, only visible on hover or focus — so revealing it
          cannot shove the time column sideways under the cursor. */}
      <button
        type="button"
        aria-label={`Delete "${note.body}"`}
        onClick={() => onDelete(note)}
        className="mt-px shrink-0 text-[var(--pv-ink-3)] opacity-0 transition-opacity hover:text-[var(--pv-late)] focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="size-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}

/* ── The composer ──────────────────────────────────────────────────────────── */

/**
 * `datetime-local` gives a wall-clock string with no zone ("2026-09-08T14:30").
 * `new Date()` reads that in the browser's zone, which is the operator's, and
 * `toISOString()` stores the instant. Returns null on anything unparseable, so a
 * half-typed date is dropped rather than saved as a wrong time.
 */
function toIsoOrNull(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function Composer({
  onAdd,
  disabled,
}: {
  onAdd: (body: string, remindAt: string | null) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [when, setWhen] = useState('');
  const [wantsTime, setWantsTime] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setBody('');
    setWhen('');
    setWantsTime(false);
    setError(null);
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    if (wantsTime && when && toIsoOrNull(when) === null) {
      setError('That time doesn’t look right.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onAdd(trimmed, wantsTime ? toIsoOrNull(when) : null);
      // The text box empties and keeps focus; the time does not carry over to
      // the next note. Writing a list is bursty, so the composer stays open.
      setBody('');
      setWhen('');
      setWantsTime(false);
      inputRef.current?.focus();
    } catch {
      // The draft stays in the box. An operator who typed a note and watched it
      // vanish has lost the one thing this card exists to keep.
      setError('Couldn’t save that. Your note is still here — try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          // The input mounts on this render; focus it once it exists.
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="group mt-auto flex w-full items-center gap-2.5 border-t border-[var(--pv-line)] px-6 py-4 text-left transition-colors hover:bg-[var(--pv-wash)]"
      >
        <span className="flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border border-dashed border-[var(--pv-line-2)] text-[var(--pv-ink-3)] group-hover:border-[var(--pv-accent)] group-hover:text-[var(--pv-accent)]">
          <Plus className="size-2.5" strokeWidth={3} />
        </span>
        <span className="text-[12px] text-[var(--pv-ink-3)] group-hover:text-[var(--pv-ink-2)]">
          Add a note
        </span>
      </button>
    );
  }

  return (
    <div className="mt-auto border-t border-[var(--pv-line)] px-6 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border border-dashed border-[var(--pv-line-2)] text-[var(--pv-ink-3)]">
          <Plus className="size-2.5" strokeWidth={3} />
        </span>
        <input
          ref={inputRef}
          value={body}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') close();
          }}
          placeholder="Write a note…"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] leading-tight text-[var(--pv-ink)] outline-none placeholder:text-[var(--pv-ink-3)]"
        />
        <button
          type="button"
          onClick={() => setWantsTime((v) => !v)}
          aria-pressed={wantsTime}
          aria-label={wantsTime ? 'Remove the time' : 'Give it a time'}
          className={cn(
            'shrink-0 transition-colors',
            wantsTime
              ? 'text-[var(--pv-accent)]'
              : 'text-[var(--pv-ink-3)] hover:text-[var(--pv-ink-2)]',
          )}
        >
          <Clock className="size-3.5" strokeWidth={2.25} />
        </button>
      </div>

      {/* The time is opt-in, because most rows are notes. A note with no time is
          still a note — that is why `remind_at` is nullable. */}
      {wantsTime && (
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') close();
          }}
          className="mt-2.5 w-full rounded-md border border-[var(--pv-line)] bg-[var(--pv-wash)] px-2 py-1 text-[11.5px] tabular-nums text-[var(--pv-ink-2)] outline-none focus:border-[var(--pv-accent)]"
        />
      )}

      {error && <p className="mt-2 text-[11px] leading-tight text-[var(--pv-late)]">{error}</p>}

      <div className="mt-2.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!body.trim() || saving || disabled}
          className="rounded-md bg-[var(--pv-accent)] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={close}
          className="text-[11px] text-[var(--pv-ink-3)] transition-colors hover:text-[var(--pv-ink-2)]"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-[var(--pv-ink-3)]">Enter to save</span>
      </div>
    </div>
  );
}

/* ── The card ──────────────────────────────────────────────────────────────── */

export function RemindersCard() {
  const { notes, openCount, isLoading, isEnabled, addNote, toggleDone, deleteNote } =
    useTenantNotes();

  // One clock for the whole render, frozen with `useMemo`, so two rows cannot
  // disagree about whether a reminder has passed mid-paint. Same reasoning as
  // the NOW divider in home-bands.tsx. There is nothing to hydrate against —
  // the list only exists after a client-side read.
  const now = useMemo(() => new Date(), []);

  const count = openCount > 0 ? `${openCount} open` : undefined;

  return (
    <Card title="Reminders" count={count} tall>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isLoading ? (
          // Three grey lines rather than a spinner: the card is about to be a
          // list, so it should be shaped like one while it waits.
          <div className="space-y-3 px-5 py-3.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="size-[15px] shrink-0 rounded-[5px] bg-[var(--pv-line)]" />
                <span
                  className="h-2.5 rounded-full bg-[var(--pv-line)]"
                  style={{ width: `${70 - i * 14}%` }}
                />
              </div>
            ))}
          </div>
        ) : notes.length === 0 ? (
          /**
           * The resting state, and it must read as calm rather than broken.
           *
           * This is what a new operator sees on day one, and it is also what
           * everybody sees until ops/tenant_notes.sql is applied — a read
           * failure resolves to an empty list, by design. So there is no error
           * copy, no warning colour and no retry button: nothing here is wrong,
           * there is simply nothing written down yet.
           */
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-8 text-center">
            <p className="text-sm font-medium">Nothing written down</p>
            <p className="text-[11px] text-[var(--pv-ink-3)]">
              Notes you make, and reminders with a time, land here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--pv-line)]">
            {notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                now={now}
                onToggle={(n) => toggleDone.mutate(n)}
                onDelete={(n) => deleteNote.mutate(n)}
              />
            ))}
          </div>
        )}
      </div>

      <Composer
        disabled={!isEnabled}
        onAdd={async (body, remindAt) => {
          await addNote.mutateAsync({ body, remindAt });
        }}
      />
    </Card>
  );
}

export default RemindersCard;
