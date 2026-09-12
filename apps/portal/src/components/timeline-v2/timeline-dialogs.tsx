"use client";

import { useRef, useState } from "react";
import { ArrowRight, CalendarPlus, CircleSlash } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { dayNumber, extensionValidation, prettyDay, shiftDay, vehicleLabel, type TimelineBooking, type TimelineVehicle } from "./model";

export function ManualExtensionDialog({ booking, currentEnd, sequence, onClose, onPreview }: { booking: TimelineBooking; currentEnd: string; sequence: number; onClose: () => void; onPreview: (end: string, note: string) => void }) {
  const opener = useRef(typeof document === "undefined" ? null : document.activeElement as HTMLElement);
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const start = shiftDay(currentEnd, 1);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="tl-dialog sm:max-w-[480px] rounded-2xl gap-5 max-h-[90svh] overflow-y-auto" onCloseAutoFocus={e => { e.preventDefault(); opener.current?.focus(); }}>
    <DialogHeader><span className="tl-heading-icon mb-2"><CalendarPlus size={19} /></span><DialogTitle>Manual extension #{sequence}</DialogTitle><DialogDescription>Explore the next period for {booking.number}.</DialogDescription></DialogHeader>
    <div className="rounded-xl border border-border bg-muted/30 p-3.5"><p className="text-sm font-medium">{booking.customer.name}</p><p className="mt-1 text-xs text-muted-foreground">{vehicleLabel(booking.vehicle)}</p><div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs"><span className="text-muted-foreground">Current end date</span><strong className="font-medium">{prettyDay(currentEnd)}</strong></div></div>
    <form noValidate onSubmit={e => { e.preventDefault(); const message = extensionValidation(currentEnd, end); if (message) return setError(message); onPreview(end, note.trim()); }}>
      <div className="tl-date-fields !mt-0"><label>Extension starts<input type="date" value={start} readOnly aria-describedby="extension-boundary-note" /></label><label>New end date<input type="date" value={end} min={start} onChange={e => { setEnd(e.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? "extension-date-error" : undefined} required autoFocus /></label></div>
      {error && <p id="extension-date-error" role="alert" className="tl-form-error">{error}</p>}
      <p id="extension-boundary-note" className="tl-info-note">The preview continues on the next calendar date. The original booking stays visible.</p>
      <label className="tl-form-field mt-4">Note <span className="font-normal text-muted-foreground">Optional</span><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="A note for this extension…" /></label>
      <div className="tl-plan-note mt-4"><strong>Unsaved preview</strong><p>No dates, availability, charges or agreements will change. Reloading or closing this view discards the preview.</p></div>
      <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Preview extension <ArrowRight size={14} /></Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export type NewBlock = { vehicleId: string; startDate: string; endDate: string; reason: string };
export function BlockDatesDialog({ vehicles, vehicleId, start, previewOnly = false, onClose, onConfirm }: { vehicles: TimelineVehicle[]; vehicleId?: string; start: string; previewOnly?: boolean; onClose: () => void; onConfirm: (block: NewBlock) => Promise<void> }) {
  const opener = useRef(typeof document === "undefined" ? null : document.activeElement as HTMLElement);
  const [target, setTarget] = useState(vehicleId || "");
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(start);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="tl-dialog sm:max-w-[460px] rounded-2xl gap-5 max-h-[90svh] overflow-y-auto" showCloseButton={!busy} onCloseAutoFocus={e => { e.preventDefault(); opener.current?.focus(); }}>
    <DialogHeader><span className="tl-heading-icon mb-2"><CircleSlash size={18} /></span><DialogTitle>Block vehicle dates</DialogTitle><DialogDescription>Choose the vehicle and the dates it will be unavailable.</DialogDescription></DialogHeader>
    <form noValidate onSubmit={async e => {
      e.preventDefault();
      if (!vehicles.some(v => v.id === target)) return setError("Choose a vehicle from this account.");
      if (!Number.isFinite(dayNumber(from)) || !Number.isFinite(dayNumber(to)) || to < from) return setError("Choose a valid range. The end cannot precede the start.");
      setBusy(true); setError("");
      try { await onConfirm({ vehicleId: target, startDate: from, endDate: to, reason }); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "The dates could not be blocked. Please try again."); } finally { setBusy(false); }
    }}>
      <label className="tl-form-field">Vehicle<select value={target} onChange={e => setTarget(e.target.value)} disabled={!!vehicleId || busy} required><option value="">Select a vehicle</option>{vehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}</select></label>
      <div className="tl-date-fields"><label>From<input type="date" required value={from} onChange={e => setFrom(e.target.value)} disabled={busy} /></label><label>Through<input type="date" required min={from} value={to} onChange={e => setTo(e.target.value)} disabled={busy} /></label></div>
      <label className="tl-form-field mt-4">Reason <span className="font-normal text-muted-foreground">Optional</span><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Maintenance, personal use…" maxLength={200} disabled={busy} /></label>
      <p className="tl-plan-note mt-4">{previewOnly ? "Unsaved preview. This only adds a local blocked period; fleet availability does not change." : "Both dates are included. This updates the existing vehicle availability record; it does not cancel or move any booking."}</p>
      {error && <p role="alert" className="tl-form-error">{error}</p>}
      <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Blocking dates…" : previewOnly ? "Preview blocked dates" : "Block dates"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
