'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, Star, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SegmentedControl } from '@/components/announcements/segmented-control';
import { cn } from '@/lib/utils';
import {
  CONTACT_STATUSES,
  EDITABLE_FIELDS,
  EMAIL_RE,
  EMPTY_DRAFT,
  STATUS_LABEL,
  STATUS_TEXT,
  companyOf,
  draftOf,
  planImport,
  sourceLabel,
  type ContactDraft,
  type ContactRequest,
  type ContactStatus,
  type ImportPlan,
} from './contact-model';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/* ------------------------------- Details -------------------------------- */

export function ContactDetailDialog({
  item,
  onClose,
  onStatus,
  onFavorite,
  onEdit,
  onDelete,
  onSaveNotes,
}: {
  item: ContactRequest | null;
  onClose: () => void;
  onStatus: (r: ContactRequest, s: ContactStatus) => void;
  onFavorite: (r: ContactRequest) => void;
  onEdit: (r: ContactRequest) => void;
  onDelete: (r: ContactRequest) => void;
  onSaveNotes: (r: ContactRequest, notes: string) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setNotes(item?.notes ?? ''), [item?.id, item?.notes]);
  const last = useRef<ContactRequest | null>(null);
  if (item) last.current = item;
  const r = item ?? last.current;
  if (!r) return null;

  const details: [string, string | null][] = [
    ['Email', r.email],
    ['Phone', r.phone],
    ['Company', companyOf(r)],
    ['Fleet size', r.fleet_size],
    ['Current platform', r.current_platform],
    ['Main booking source', r.main_booking_source],
    ['Budget', r.budget],
    ['Readiness', r.readiness],
    ['Biggest challenge', r.challenge],
    ['Promo code', r.promo_code],
    ['Came from', `${sourceLabel(r.source)}${r.is_test ? ' (test lead)' : ''}`],
    ['Campaign / form', r.source_detail],
    ['Submitted', fmtDateTime(r.created_at)],
  ];
  const notesDirty = (r.notes ?? '') !== notes;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()} className="flex max-h-[88vh] w-[96vw] max-w-[680px] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
          <DialogHeader className="min-w-0 space-y-1 text-left">
            <DialogTitle className="truncate text-xl">{r.contact_name}</DialogTitle>
            <DialogDescription className={cn('text-sm font-medium', STATUS_TEXT[r.status])}>{STATUS_LABEL[r.status] ?? r.status}</DialogDescription>
          </DialogHeader>
          <div className="flex shrink-0 items-center gap-1">
            <IconAction label={r.is_favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => onFavorite(r)}>
              <Star className={cn('size-4', r.is_favorite && 'fill-amber-400 text-amber-400')} />
            </IconAction>
            <IconAction label="Edit" onClick={() => onEdit(r)}>
              <Pencil className="size-4" />
            </IconAction>
            <IconAction label="Delete" onClick={() => onDelete(r)} danger>
              <Trash2 className="size-4" />
            </IconAction>
          </div>
        </div>

        <div className="min-h-0 space-y-6 overflow-y-auto px-6 pb-6 [scrollbar-width:thin]">
          <SegmentedControl
            size="sm"
            ariaLabel="Status"
            options={CONTACT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            value={r.status}
            onChange={(s) => onStatus(r, s)}
          />

          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                {/* One column on a phone, so a long email wraps there rather than being cut off. */}
                <dd className="mt-0.5 truncate text-sm text-foreground max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]">
                  {label === 'Email' && value ? (
                    <a href={`mailto:${value}`} className="text-primary hover:underline">
                      {value}
                    </a>
                  ) : label === 'Phone' && value ? (
                    <a href={`tel:${value}`} className="hover:underline">
                      {value}
                    </a>
                  ) : (
                    value || <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {r.message && (
            <div>
              <p className="text-xs text-muted-foreground">Message</p>
              <p className="mt-1 whitespace-pre-wrap rounded-2xl bg-muted/50 px-4 py-3 text-sm leading-relaxed text-foreground">{r.message}</p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Notes</p>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Call notes, next steps…" className="min-h-[96px] rounded-2xl" />
            {notesDirty && (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setNotes(r.notes ?? '')}>
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    await onSaveNotes(r, notes);
                    setSaving(false);
                  }}
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  Save notes
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IconAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        danger && 'hover:bg-destructive/10 hover:text-destructive',
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------ Add / edit ------------------------------ */

export function ContactFormDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  /** null = new request. */
  initial: ContactRequest | null;
  onClose: () => void;
  onSave: (draft: ContactDraft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(initial ? draftOf(initial) : EMPTY_DRAFT);
    setTried(false);
  }, [open, initial]);

  const nameMissing = !draft.contact_name.trim();
  const emailBad = !EMAIL_RE.test(draft.email.trim());
  const set = (k: keyof ContactDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setTried(true);
    if (nameMissing || emailBad) return;
    setBusy(true);
    const ok = await onSave(draft);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-[680px] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="px-6 pb-4 pt-6 text-left">
          <DialogTitle>{initial ? 'Edit request' : 'New request'}</DialogTitle>
          <DialogDescription>{initial ? initial.contact_name : 'Someone who got in touch another way: a call, an email, an event.'}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-2 [scrollbar-width:thin]">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {EDITABLE_FIELDS.filter((f) => !('long' in f)).map((f) => {
              const invalid = tried && ((f.key === 'contact_name' && nameMissing) || (f.key === 'email' && emailBad));
              return (
                <label key={f.key} className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {f.label}
                    {'required' in f && <span className="text-destructive"> *</span>}
                  </span>
                  <Input
                    autoFocus={f.key === 'contact_name'}
                    type={f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'text'}
                    value={draft[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    aria-invalid={invalid || undefined}
                    className={cn('rounded-full', invalid && 'ring-2 ring-destructive/50')}
                  />
                </label>
              );
            })}
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="text-xs font-medium text-muted-foreground">Status</span>
            <SegmentedControl
              size="sm"
              ariaLabel="Status"
              options={CONTACT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              value={draft.status}
              onChange={(s) => setDraft((d) => ({ ...d, status: s }))}
            />
          </div>
          {EDITABLE_FIELDS.filter((f) => 'long' in f).map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
              <Textarea value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} className="min-h-[80px] rounded-2xl" />
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 px-6 pb-6 pt-4">
          <p className="text-xs text-destructive">{tried && (nameMissing || emailBad) ? 'A name and a valid email are needed.' : ''}</p>
          <div className="flex gap-2">
            <Button variant="ghost" className="rounded-full" onClick={onClose}>
              Cancel
            </Button>
            <Button className="rounded-full" disabled={busy} onClick={() => void save()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {initial ? 'Save changes' : 'Add request'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Import -------------------------------- */

export function ImportDialog({
  open,
  existingEmails,
  onClose,
  onImport,
}: {
  open: boolean;
  existingEmails: Set<string>;
  onClose: () => void;
  onImport: (rows: ImportPlan['rows']) => Promise<boolean>;
}) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setPlan(null);
      setFileName('');
    }
  }, [open]);

  const read = async (file: File) => {
    setFileName(file.name);
    setPlan(planImport(await file.text(), existingEmails));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw] max-w-[520px] gap-5 rounded-3xl p-6">
        <DialogHeader className="text-left">
          <DialogTitle>Import requests</DialogTitle>
          <DialogDescription>A CSV with at least Name and Email columns. A file exported from here imports back as it is.</DialogDescription>
        </DialogHeader>

        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void read(f);
          }}
          className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
        >
          <Upload className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{fileName || 'Choose a CSV file'}</span>
          <span className="text-xs text-muted-foreground">{fileName ? 'Click to pick another' : 'or drop it here'}</span>
        </button>

        {plan && (
          <div className="space-y-2 text-sm">
            <p className="text-foreground">
              <span className="font-semibold">{plan.rows.length}</span> {plan.rows.length === 1 ? 'request' : 'requests'} ready to import
              {plan.skipped.length > 0 && <span className="text-muted-foreground">, {plan.skipped.length} skipped</span>}
            </p>
            {plan.skipped.length > 0 && (
              <ul className="max-h-[120px] space-y-0.5 overflow-y-auto rounded-2xl bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground [scrollbar-width:thin]">
                {plan.skipped.slice(0, 50).map((s) => (
                  <li key={s.line}>
                    Line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
            {plan.unknownHeaders.length > 0 && (
              <p className="text-xs text-muted-foreground">Ignored columns: {plan.unknownHeaders.join(', ')}</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            disabled={busy || !plan || plan.rows.length === 0}
            onClick={async () => {
              if (!plan) return;
              setBusy(true);
              const ok = await onImport(plan.rows);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Import{plan && plan.rows.length ? ` ${plan.rows.length}` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
