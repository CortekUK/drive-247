'use client';

/**
 * The team's internal notes about a company (tenant_admin_notes), as sticky
 * notes in the right column of its page. Never shown to the company.
 *
 * The page shows ONE sticky (ScratchSticky): the newest note, written on
 * freely and saved as you type; a blank canary one when there is none. Its
 * corner icons start a fresh sticky, remove this one, or open the board — a
 * dialog of every note, where the author can pin, edit or delete their own.
 * Saved notes take one of a few pastel colours picked from their id, so a
 * note keeps its colour without the table storing one.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Layers, Loader2, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Note {
  id: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  author_id: string;
  author: { name: string | null; email: string | null } | null;
}

/* ---------------------------------------------------------------- the look */

/** The pastel pad a saved note can come from. Dark mode keeps the hue, faint. */
const PAPERS = [
  'bg-[#ffe3ec] dark:bg-[#ff8fb1]/[0.12]', // blush
  'bg-[#dcf5e6] dark:bg-[#6ee7a8]/[0.11]', // mint
  'bg-[#dcecff] dark:bg-[#7cb8ff]/[0.12]', // sky
  'bg-[#ece4ff] dark:bg-[#b49cff]/[0.13]', // lilac
  'bg-[#ffe9d4] dark:bg-[#ffb36b]/[0.12]', // peach
];
/** The blank pad a new note is written on: the classic canary. */
const CANARY = 'bg-[#fff3a6] dark:bg-[#ffe066]/[0.12]';

/** A note's colour, from its id: stable without storing it. */
function paperFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PAPERS[Math.abs(h) % PAPERS.length];
}

/** A slight tilt, alternating, so a pile looks stuck on rather than printed. */
const TILTS = ['-rotate-[0.8deg]', 'rotate-[0.7deg]', '-rotate-[0.4deg]', 'rotate-[1deg]'];

/** Square-ish corners, a soft lifted shadow and a strip of tape at the top. */
const STICKY =
  'relative rounded-[4px] text-foreground shadow-[0_1px_1px_rgba(0,0,0,0.04),0_8px_16px_-10px_rgba(0,0,0,0.35)] dark:shadow-none dark:ring-1 dark:ring-white/10 ' +
  'before:pointer-events-none before:absolute before:-top-1.5 before:left-1/2 before:h-3.5 before:w-12 before:-translate-x-1/2 before:-rotate-2 ' +
  'before:rounded-[2px] before:bg-white/70 before:shadow-[0_1px_1px_rgba(0,0,0,0.06)] dark:before:bg-white/15';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const authorOf = (n: Note) => n.author?.name || n.author?.email || 'A team member';

/* ------------------------------------------------------------------- panel */

export function NotesPanel({ tenantId, className }: { tenantId: string; className?: string }) {
  const me = useAuthStore((s) => s.user);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const loadNotes = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from('tenant_admin_notes')
      .select('id, body, is_pinned, created_at, updated_at, author_id, author:app_users!tenant_admin_notes_author_id_fkey(name, email)')
      .eq('tenant_id', tenantId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(`Couldn't load notes: ${error.message}`);
      setNotes([]);
      return;
    }
    setNotes(data ?? []);
  }, [tenantId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  return (
    <section className={cn('flex min-h-[200px] flex-col', className)}>
      {/* One sticky, written on freely; it saves itself. */}
      <ScratchSticky
        key={tenantId}
        tenantId={tenantId}
        me={me?.id ?? null}
        notes={notes}
        onChanged={loadNotes}
        onShowAll={() => setShowAll(true)}
      />

      {/* The whole board, to work on. */}
      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 rounded-3xl p-7">
          <DialogHeader className="mb-5">
            <DialogTitle>Internal notes</DialogTitle>
            <DialogDescription>For the Drive247 team only. The company never sees these.</DialogDescription>
          </DialogHeader>
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
              <NewSticky tenantId={tenantId} authorId={me?.id ?? null} onAdded={loadNotes} compact />
              {(notes ?? []).map((n, i) => (
                <BoardSticky key={n.id} note={n} tilt={TILTS[i % TILTS.length]} mine={n.author_id === me?.id} onChanged={loadNotes} />
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ---------------------------------------------------------- scratch sticky */

/**
 * The one sticky on the page. It shows the newest note; typing edits it and
 * saves after a pause (a blank sticky becomes a new note on the first pause).
 * Corner icons: a fresh sticky, remove this one, and the whole board when
 * there is more than one. Someone else's note is read-only.
 */
function ScratchSticky({
  tenantId,
  me,
  notes,
  onChanged,
  onShowAll,
}: {
  tenantId: string;
  me: string | null;
  notes: Note[] | null;
  onChanged: () => Promise<void>;
  onShowAll: () => void;
}) {
  // Which note is on the sticky: undefined = follow the newest, null = blank.
  const [currentId, setCurrentId] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const lastSaved = useRef('');
  // A note this sticky just created: don't reload its text over what is
  // still being typed.
  const created = useRef<string | null>(null);

  const current =
    currentId === null ? null : notes?.find((n) => n.id === currentId) ?? (currentId === undefined ? notes?.[0] ?? null : null);
  const mine = !current || current.author_id === me;

  // Load the note's text when the sticky switches to another note.
  useEffect(() => {
    if (current && current.id === created.current) return;
    setText(current?.body ?? '');
    lastSaved.current = current?.body ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Save after a pause in typing.
  useEffect(() => {
    if (!mine || !me || text === lastSaved.current || !text.trim()) return;
    const timer = setTimeout(async () => {
      setStatus('saving');
      const db = supabase as any;
      if (current) {
        const { error } = await db.from('tenant_admin_notes').update({ body: text.trim() }).eq('id', current.id);
        if (error) {
          toast.error(`Couldn't save the note: ${error.message}`);
          setStatus('idle');
          return;
        }
      } else {
        const { data, error } = await db
          .from('tenant_admin_notes')
          .insert({ tenant_id: tenantId, author_id: me, body: text.trim() })
          .select('id')
          .single();
        if (error) {
          toast.error(`Couldn't save the note: ${error.message}`);
          setStatus('idle');
          return;
        }
        created.current = data.id;
        setCurrentId(data.id);
      }
      lastSaved.current = text;
      setStatus('saved');
      await onChanged();
    }, 800);
    return () => clearTimeout(timer);
  }, [text, mine, me, current, tenantId, onChanged]);

  const remove = async () => {
    if (!current) {
      setText('');
      return;
    }
    const { error } = await (supabase as any).from('tenant_admin_notes').delete().eq('id', current.id);
    if (error) {
      toast.error(`Couldn't remove the note: ${error.message}`);
      return;
    }
    setCurrentId(null);
    setStatus('idle');
    await onChanged();
  };

  const count = notes?.length ?? 0;

  return (
    <div className={cn(STICKY, current ? paperFor(current.id) : CANARY, 'group flex min-h-0 flex-1 flex-col')}>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus('idle');
        }}
        readOnly={!mine}
        placeholder="Jot an internal note… Only the Drive247 team sees it."
        className="min-h-0 flex-1 resize-none bg-transparent px-4 pb-10 pt-5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-[#8a7a2a]/60 dark:placeholder:text-[#ffe680]/40"
      />
      <div className="absolute inset-x-3 bottom-2 flex items-center gap-1 text-[11px]">
        <span className="min-w-0 flex-1 truncate opacity-55">
          {status === 'saving'
            ? 'Saving…'
            : current
              ? `${authorOf(current)} · ${day(current.updated_at)}${status === 'saved' ? ' · saved' : ''}`
              : ''}
        </span>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {count > 1 && (
            <IconAction label={`All ${count} notes`} onClick={onShowAll}>
              <Layers />
            </IconAction>
          )}
          {(current || text) && (
            <IconAction label="New sticky" onClick={() => { setCurrentId(null); setStatus('idle'); }}>
              <Plus />
            </IconAction>
          )}
          {mine && (current || text) && (
            <IconAction label="Remove" onClick={() => void remove()}>
              <Trash2 />
            </IconAction>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- new sticky */

function NewSticky({
  tenantId,
  authorId,
  onAdded,
  compact,
}: {
  tenantId: string;
  authorId: string | null;
  onAdded: () => Promise<void>;
  /** On the board: the same size as the notes beside it. */
  compact?: boolean;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!body.trim() || !authorId || saving) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from('tenant_admin_notes')
      .insert({ tenant_id: tenantId, author_id: authorId, body: body.trim() });
    setSaving(false);
    if (error) {
      toast.error(`Couldn't add the note: ${error.message}`);
      return;
    }
    setBody('');
    await onAdded();
  };

  return (
    <div className={cn(STICKY, CANARY, 'flex shrink-0 flex-col', compact ? 'min-h-[150px]' : 'h-[132px]')}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Enter adds; Shift+Enter is a new line.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void add();
          }
        }}
        placeholder="Jot an internal note… Only the Drive247 team sees it."
        disabled={saving}
        className="min-h-0 flex-1 resize-none bg-transparent px-3.5 pb-9 pt-4 text-[13px] leading-snug text-foreground outline-none placeholder:text-[#8a7a2a]/60 dark:placeholder:text-[#ffe680]/40"
      />
      {body.trim() && (
        <button
          type="button"
          onClick={() => void add()}
          disabled={saving || !authorId}
          aria-label="Add note"
          title="Add note (Enter)"
          className="absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-full bg-foreground/85 text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- board sticky */

function BoardSticky({ note, tilt, mine, onChanged }: { note: Note; tilt: string; mine: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const edited = new Date(note.updated_at).getTime() - new Date(note.created_at).getTime() > 1000;

  const update = async (patch: Partial<Pick<Note, 'body' | 'is_pinned'>>) => {
    setBusy(true);
    const { error } = await (supabase as any).from('tenant_admin_notes').update(patch).eq('id', note.id);
    setBusy(false);
    if (error) {
      toast.error(`Couldn't save: ${error.message}`);
      return false;
    }
    await onChanged();
    return true;
  };

  const remove = async () => {
    if (!window.confirm('Delete this note?')) return;
    setBusy(true);
    const { error } = await (supabase as any).from('tenant_admin_notes').delete().eq('id', note.id);
    setBusy(false);
    if (error) {
      toast.error(`Couldn't delete: ${error.message}`);
      return;
    }
    await onChanged();
  };

  return (
    <div className={cn(STICKY, paperFor(note.id), editing ? 'rotate-0' : tilt, 'group flex min-h-[150px] flex-col p-3.5 pt-4')}>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="min-h-[80px] flex-1 resize-none bg-transparent text-[13px] leading-snug outline-none"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={busy || !draft.trim() || draft.trim() === note.body}
              onClick={async () => {
                if (await update({ body: draft.trim() })) setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="flex-1 whitespace-pre-wrap text-[13px] leading-snug">
            {note.is_pinned && <Pin className="mr-1 inline size-3 -translate-y-px opacity-60" aria-label="Pinned" />}
            {note.body}
          </p>
          <div className="mt-3 flex items-end justify-between gap-2">
            <p className="min-w-0 text-[11px] leading-tight opacity-55">
              <span className="block truncate">{authorOf(note)}</span>
              {day(note.created_at)}
              {edited && ' · edited'}
            </p>
            {mine && (
              <div className="-mb-1 -mr-1 flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <IconAction label={note.is_pinned ? 'Unpin' : 'Pin to top'} disabled={busy} onClick={() => void update({ is_pinned: !note.is_pinned })}>
                  {note.is_pinned ? <PinOff /> : <Pin />}
                </IconAction>
                <IconAction label="Edit" disabled={busy} onClick={() => { setDraft(note.body); setEditing(true); }}>
                  <Pencil />
                </IconAction>
                <IconAction label="Delete" disabled={busy} onClick={() => void remove()}>
                  <Trash2 />
                </IconAction>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-6 items-center justify-center rounded-full opacity-60 outline-none transition hover:bg-black/5 hover:opacity-100 disabled:opacity-30 dark:hover:bg-white/10 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
