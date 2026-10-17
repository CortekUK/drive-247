'use client';
import React from 'react';
import { activeFilterCount, NO_FILTERS, type HumanTicket, type SupportFilters, type SupportInboxState } from './use-support-inbox';
import { STATUS_LABEL, STATUS_ORDER } from './inbox-ui';

/**
 * The platform queue's filters: a sliders control INSIDE the search pill, and a
 * small panel that drops in right under the search, with the tickets still in
 * view below it — status, unread, starred, company, customer (the tenant user who
 * raised the ticket), ticket number and date created, in any combination.
 *
 * Every change applies at once (the ticket number after a short pause), so the
 * list underneath answers as you pick. Every filter narrows the server's own authorized list
 * (`trax_messaging_request('list')`); nothing is filtered in the browser.
 *
 * Motion is the app standard: 200ms, fade plus a 12px move, ease-out.
 */
export function FilterButton({ open, count, onClick }: { open: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" aria-expanded={open}
      aria-label={count ? `Filters, ${count} applied` : 'Filters'}
      className={`relative inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-primary outline-none transition-colors duration-200 ease-out motion-reduce:transition-none hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/30 ${open || count ? 'bg-primary/20' : 'bg-primary/10'}`}>
      {/* Sliders: three rails, each with its knob. */}
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
        <path d="M21 5h-7M10 5H3M21 12h-9M8 12H3M21 19h-5M12 19H3M14 3v4M8 10v4M16 17v4" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9.5px] font-semibold leading-none tabular-nums text-primary-foreground ring-2 ring-background">{count}</span>
      )}
    </button>
  );
}

export function FilterPanel({ inbox, open, onClose }: { inbox: SupportInboxState; open: boolean; onClose: () => void }) {
  const f = inbox.filters;
  const facets = inbox.facets;
  const set = (patch: Partial<SupportFilters>) => inbox.setFilters({ ...f, ...patch });
  /* The ticket number applies after a short pause, not on every keystroke. */
  const [reference, setReference] = React.useState(f.reference);
  React.useEffect(() => { setReference(f.reference); }, [f.reference]);
  React.useEffect(() => {
    if (reference.trim() === f.reference) return;
    const timer = window.setTimeout(() => inbox.setFilters({ ...f, reference: reference.trim() }), 400);
    return () => window.clearTimeout(timer);
  }, [reference, f, inbox]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-filter-picker]')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const toggle = <K extends 'statuses' | 'tenants' | 'requesters'>(key: K, value: string) => {
    const list = f[key] as string[];
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    const out = { ...f, [key]: next } as SupportFilters;
    // Narrowing the companies drops customers outside them.
    if (key === 'tenants' && next.length) {
      const keep = new Set((facets?.requesters ?? []).filter((p) => next.includes(p.tenantId)).map((p) => p.id));
      out.requesters = out.requesters.filter((id) => keep.has(id));
    }
    inbox.setFilters(out);
  };
  const people = (facets?.requesters ?? []).filter((p) => !f.tenants.length || f.tenants.includes(p.tenantId));
  const datesWrong = !!f.createdFrom && !!f.createdTo && f.createdFrom > f.createdTo;

  return (
    <div role="group" aria-label="Filter tickets"
      className="mt-2 space-y-2 rounded-xl border border-border/70 bg-background p-2.5 animate-in fade-in slide-in-from-top-3 duration-200 ease-out motion-reduce:animate-none">
      <div className="flex flex-wrap gap-1">
        {STATUS_ORDER.map((status: HumanTicket['status']) => (
          <Chip key={status} on={f.statuses.includes(status)} onClick={() => toggle('statuses', status)}>{STATUS_LABEL[status]}</Chip>
        ))}
        <Chip on={f.unread} onClick={() => set({ unread: !f.unread })}>Unread</Chip>
        <Chip on={f.starred} onClick={() => set({ starred: !f.starred })}>
          <svg aria-hidden viewBox="0 0 24 24" className="size-3" fill={f.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
          Starred
        </Chip>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Picker label="Company" all="All companies" selected={f.tenants} loading={!facets}
          items={(facets?.tenants ?? []).map((t) => ({ id: t.id, label: t.name, meta: String(t.count) }))}
          onToggle={(id) => toggle('tenants', id)} />
        <Picker label="Customer" all="All customers" selected={f.requesters} loading={!facets}
          items={people.map((p) => ({ id: p.id, label: p.name, meta: String(p.count) }))}
          onToggle={(id) => toggle('requesters', id)} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} placeholder="Ticket no." aria-label="Ticket number"
          className={`${FIELD} col-span-2 uppercase placeholder:normal-case`} />
        <input type="date" value={f.createdFrom} max={f.createdTo || undefined} aria-label="Created from" title="Created from"
          onChange={(e) => set({ createdFrom: e.target.value })} className={`${FIELD} ${f.createdFrom ? '' : 'text-muted-foreground'}`} />
        <input type="date" value={f.createdTo} min={f.createdFrom || undefined} aria-label="Created to" title="Created to"
          onChange={(e) => set({ createdTo: e.target.value })} className={`${FIELD} ${f.createdTo ? '' : 'text-muted-foreground'}`} />
      </div>
      {datesWrong && <p className="text-[11px] text-destructive">The start date is after the end date.</p>}
      {activeFilterCount(f) > 0 && (
        <div className="flex justify-end">
          <button type="button" onClick={() => { setReference(''); inbox.setFilters(NO_FILTERS); }}
            className="rounded-md px-1.5 py-0.5 text-[11.5px] text-muted-foreground transition-colors duration-200 hover:text-primary motion-reduce:transition-none">Clear filters</button>
        </div>
      )}
    </div>
  );
}

const FIELD = 'h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-[11.5px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20';

/** A compact multi-select: a field-sized button that drops a short checklist. */
function Picker({ label, all, items, selected, onToggle, loading }: { label: string; all: string; items: { id: string; label: string; meta?: string }[]; selected: string[]; onToggle: (id: string) => void; loading: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const names = selected.map((id) => items.find((i) => i.id === id)?.label).filter(Boolean) as string[];
  const shown = items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}
        className={`${FIELD} flex items-center gap-1 text-left ${names.length ? 'border-primary/40 text-primary' : 'text-muted-foreground'}`}>
        <span className="min-w-0 flex-1 truncate">{names.length === 0 ? all : names.length === 1 ? names[0] : `${names.length} ${label === 'Company' ? 'companies' : 'customers'}`}</span>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3 shrink-0"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div data-filter-picker className="absolute left-0 top-full z-30 mt-1 w-[220px] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-top-2 duration-200 ease-out motion-reduce:animate-none">
          {items.length > 6 && (
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find a ${label.toLowerCase()}`} aria-label={`Find a ${label.toLowerCase()}`}
              className="mb-1 h-7 w-full rounded-lg border border-input bg-background px-2 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:border-ring" />
          )}
          {!shown.length ? (
            <p className="px-1.5 py-1.5 text-[12px] text-muted-foreground">{loading ? 'Loading…' : 'Nothing matches.'}</p>
          ) : (
            <ul role="listbox" aria-multiselectable className="max-h-52 overflow-y-auto">
              {shown.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] transition-colors duration-200 hover:bg-primary/[0.06] motion-reduce:transition-none">
                    <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} className="size-3.5 shrink-0 accent-primary" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.meta && <span className="shrink-0 text-[11px] text-muted-foreground">{item.meta}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] transition-colors duration-200 ease-out motion-reduce:transition-none ${on ? 'border-primary/50 bg-primary/10 font-medium text-primary' : 'border-border text-foreground hover:bg-primary/[0.06]'}`}>
      {children}
    </button>
  );
}

/**
 * A single choice from a searchable list: the Company and Person fields of platform
 * support's New ticket. The same drop-down as the filter pickers, at form size.
 */
export function ChoicePicker({ label, placeholder, items, value, onChange, loading, disabled }: {
  label: string; placeholder: string; items: { id: string; label: string; meta?: string }[] | null;
  value: string; onChange: (id: string) => void; loading?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const chosen = items?.find((i) => i.id === value);
  const shown = (items ?? []).filter((i) => (i.label + ' ' + (i.meta ?? '')).toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div ref={box} className="relative min-w-0 space-y-1.5">
      <span className="block text-[12px] font-medium">{label}</span>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-full min-w-0 items-center gap-1 rounded-lg border border-input bg-background px-3 text-left text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60 ${chosen ? '' : 'text-muted-foreground'}`}>
        <span className="min-w-0 flex-1 truncate">{chosen ? chosen.label : loading ? 'Loading…' : placeholder}</span>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5 shrink-0"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div data-filter-picker className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-top-3 duration-200 ease-out motion-reduce:animate-none">
          {(items?.length ?? 0) > 6 && (
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find a ${label.toLowerCase()}`} aria-label={`Find a ${label.toLowerCase()}`}
              className="mb-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-[12.5px] outline-none placeholder:text-muted-foreground focus-visible:border-ring" />
          )}
          {!shown.length ? (
            <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">{loading || !items ? 'Loading…' : items.length ? 'Nothing matches.' : 'No one to choose here.'}</p>
          ) : (
            <ul role="listbox" className="max-h-60 overflow-y-auto">
              {shown.map((item) => (
                <li key={item.id} role="option" aria-selected={item.id === value}>
                  <button type="button" onClick={() => { onChange(item.id); setOpen(false); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors duration-200 hover:bg-primary/[0.06] motion-reduce:transition-none ${item.id === value ? 'font-medium text-primary' : ''}`}>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.meta && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{item.meta}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
