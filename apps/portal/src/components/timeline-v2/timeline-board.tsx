"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { addMonths, format, getDaysInMonth, startOfMonth } from "date-fns";
import { ArrowRight, CalendarDays, Car, Check, ChevronLeft, ChevronRight, CircleSlash, Filter, ListFilter, Maximize2, Plus, RotateCcw, Search, User, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { getStatusColor } from "@/lib/calendar-utils";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { bookingLanes, dayNumber, onDay, positionBooking, prettyDay, primaryLabel, recordId, shiftDay, STATUSES, vehicleLabel, vehicleName, type Perspective, type Period, type TimelineBlock, type TimelineBooking, type TimelineData } from "./model";
import "./timeline.css";
import { HistoryShortcuts } from "./history-shortcuts";
import { DateGrid } from "./date-grid";

export type TimelineRange = { start: string; days: number; period: Period };
export type TimelineView = { perspective: Perspective; search: string; records: string[]; statuses: string[]; selectedDate: string | null; selectedBooking: string | null };
export const initialTimelineView = (perspective: Perspective = "rental"): TimelineView => ({ perspective, search: "", records: [], statuses: [], selectedDate: null, selectedBooking: null });
export type TimelineBoardProps = {
  data: TimelineData; range: TimelineRange; onRange: (r: TimelineRange) => void; today: string;
  currency: string; timezone?: string | null; compact?: boolean; perspective?: Perspective;
  fixedPerspective?: boolean; loading?: boolean; error?: string | null; onRetry?: () => void;
  onExpand?: () => void; onBlock?: (date: string) => void; onOpenRental?: (id: string) => void;
  extensionEnd?: string | null; onExtend?: () => void; heading?: string;
  itemLabel?: "booking" | "period";
  viewState?: readonly [TimelineView, Dispatch<SetStateAction<TimelineView>>];
};

function BookingInfo({ booking: b, currency, onOpen }: { booking: TimelineBooking; currency: string; onOpen?: () => void }) {
  return <div className="tl-booking-info">
    <div className="tl-info-top"><strong>{b.number}</strong><Status status={b.status} /></div>
    {b.segment && <p className="tl-segment-name">{b.segment}{b.preview && <span className="tl-preview-tag">Unsaved preview</span>}</p>}
    <dl><div><dt><Car size={14} /> Vehicle</dt><dd>{vehicleName(b.vehicle)}{b.vehicle.reg && <small>{b.vehicle.reg}</small>}</dd></div>
      <div><dt><User size={14} /> Customer</dt><dd>{b.customer.name}</dd></div>
      <div><dt>From</dt><dd>{prettyDay(b.start)}{b.pickupTime && <small>{b.pickupTime.slice(0, 5)}</small>}</dd></div>
      <div><dt>Until</dt><dd>{b.end ? prettyDay(b.end) : "Open-ended"}{b.returnTime && <small>{b.returnTime.slice(0, 5)}</small>}</dd></div>
      {b.amount != null && <div><dt>Recorded total</dt><dd>{formatCurrency(b.amount, currency)}</dd></div>}
    </dl>
    {b.note && <p className="tl-info-note">{b.note}</p>}
    {onOpen && <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onOpen}>Open rental <ArrowRight size={14} /></Button>}
  </div>;
}
export function Status({ status }: { status: string }) {
  const colors = getStatusColor(status);
  return <span className={cn("tl-status", colors.bg, colors.text)}><span aria-hidden="true">●</span>{status}</span>;
}

function BookingLine({ booking, perspective, position, top, currency, onOpen, selected, onSelect }: {
  booking: TimelineBooking; perspective: Perspective; position: NonNullable<ReturnType<typeof positionBooking>>; top: number;
  currency: string; onOpen?: (id: string) => void; selected: boolean; onSelect: (id: string) => void;
}) {
  const colors = getStatusColor(booking.status);
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={v => { setOpen(v); if (v) onSelect(booking.id); }}>
    <Tooltip>
      <TooltipTrigger asChild><PopoverTrigger asChild>
        <button type="button" data-booking-id={booking.id} className={cn("tl-booking", selected && "tl-booking-selected", booking.preview && "tl-booking-preview", ["Cancelled", "Rejected"].includes(booking.status) && "tl-booking-cancelled", position.continuesBefore && "tl-continues-before", position.continuesAfter && "tl-continues-after")}
          style={{ left: `calc(var(--tl-day) * ${position.offset})`, width: `calc(var(--tl-day) * ${position.span})`, top }}
          aria-label={`${primaryLabel(booking, perspective)}, ${booking.number}, ${booking.status}, ${prettyDay(booking.start)} to ${booking.end ? prettyDay(booking.end) : "open-ended"}${booking.preview ? ", unsaved preview" : ""}`}>
          <span className="tl-booking-stroke" aria-hidden="true" />
          {position.continuesBefore ? <ChevronLeft size={12} className="tl-endpoint tl-endpoint-start tl-continuation" aria-label="Started before this window" /> : <span className={cn("tl-endpoint tl-endpoint-start tl-endpoint-dot", colors.text)} aria-hidden="true" />}
          {position.continuesAfter ? <ChevronRight size={12} className="tl-endpoint tl-endpoint-end tl-continuation" aria-label="Continues after this window" /> : <span className={cn("tl-endpoint tl-endpoint-end tl-endpoint-dot", colors.text)} aria-hidden="true" />}
          {booking.segment && !position.continuesBefore && position.span >= 1 && <span className="tl-segment-marker" aria-hidden="true">{booking.segment === "Original rental" ? "Original" : booking.segment.replace("Extension ", "")}</span>}
        </button>
      </PopoverTrigger></TooltipTrigger>
      {!open && <TooltipContent side="top" className="tl-info-popover"><BookingInfo booking={booking} currency={currency} /></TooltipContent>}
    </Tooltip>
    <PopoverContent side="bottom" align="start" collisionPadding={16} className="tl-info-popover">
      <BookingInfo booking={booking} currency={currency} onOpen={onOpen ? () => onOpen(booking.rentalId) : undefined} />
    </PopoverContent>
  </Popover>;
}

function BlockLine({ block, data, start, days, top }: { block: TimelineBlock; data: TimelineData; start: string; days: number; top: number }) {
  const from = Math.max(dayNumber(block.start), dayNumber(start)) - dayNumber(start);
  const to = Math.min(dayNumber(block.end) + 1, dayNumber(start) + days) - dayNumber(start);
  const label = block.vehicleId ? vehicleName(data.vehicles.find(v => v.id === block.vehicleId) ?? { id: "", reg: "", make: "", model: "Vehicle", daily: null, weekly: null, monthly: null }) : "All vehicles";
  if (to <= from) return null;
  return <Popover><PopoverTrigger asChild><button type="button" className="tl-block" aria-label={`${label} · Blocked${block.preview ? " · Unsaved preview" : ""}, ${prettyDay(block.start)} to ${prettyDay(block.end)}`} style={{ left: `calc(var(--tl-day) * ${from})`, width: `calc(var(--tl-day) * ${to - from})`, top }}>
    <span className="tl-block-pattern" aria-hidden="true"><CircleSlash size={11} /></span>
  </button></PopoverTrigger><PopoverContent className="tl-info-popover"><strong className="text-sm">{label} · Blocked dates</strong><p className="mt-2 text-xs">{prettyDay(block.start)} — {prettyDay(block.end)}</p><p className="mt-2 text-xs text-muted-foreground">{block.reason || "No reason recorded"}</p>{block.preview && <p className="tl-info-note">Unsaved preview. Fleet availability has not changed.</p>}</PopoverContent></Popover>;
}

export function TimelineBoard({ data, range, onRange, today, currency, timezone, compact = false, perspective: initialPerspective = "rental", fixedPerspective, loading, error, onRetry, onExpand, onBlock, onOpenRental, extensionEnd, onExtend, heading, viewState, itemLabel = "booking" }: TimelineBoardProps) {
  const localView = useState(() => initialTimelineView(initialPerspective));
  const [{ perspective, search, records, statuses, selectedDate, selectedBooking }, setView] = viewState ?? localView;
  const setPerspective = (value: Perspective) => setView(v => ({ ...v, perspective: value }));
  const setSearch = (value: string) => setView(v => ({ ...v, search: value }));
  const setRecords = (value: string[]) => setView(v => ({ ...v, records: value }));
  const setStatuses = (value: string[]) => setView(v => ({ ...v, statuses: value }));
  const setSelectedDate = (value: string | null) => setView(v => ({ ...v, selectedDate: value }));
  const setSelectedBooking = (value: string | null) => setView(v => ({ ...v, selectedBooking: value }));
  const [recordSearch, setRecordSearch] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(range.start);
  const [draftEnd, setDraftEnd] = useState(shiftDay(range.start, range.days - 1));
  const [rangeError, setRangeError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const priorExtensionEnd = useRef(extensionEnd);
  useEffect(() => {
    if (priorExtensionEnd.current === extensionEnd) return;
    priorExtensionEnd.current = extensionEnd;
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      scroll?.scrollTo?.({ left: scroll.scrollWidth - scroll.clientWidth });
    });
    return () => cancelAnimationFrame(frame);
  }, [extensionEnd]);
  const dates = useMemo(() => Array.from({ length: range.days }, (_, i) => shiftDay(range.start, i)), [range.start, range.days]);
  const filtered = useMemo(() => data.bookings.filter(b => (!records.length || records.includes(recordId(b, perspective))) && (!statuses.length || statuses.includes(b.status)) && (!search.trim() || [b.number, b.customer.name, vehicleName(b.vehicle), b.vehicle.reg].some(v => v.toLowerCase().includes(search.trim().toLowerCase())))), [data.bookings, records, statuses, search, perspective]);
  const lanes = useMemo(() => bookingLanes(filtered, range.start, range.days), [filtered, range]);
  const blocks = data.blocks.filter(b => b.start <= dates[dates.length - 1] && b.end >= range.start && (perspective !== "vehicle" || !records.length || b.vehicleId == null || records.includes(b.vehicleId)));
  const options = useMemo(() => {
    const map = new Map(data.bookings.map(b => [recordId(b, perspective), { id: recordId(b, perspective), label: perspective === "rental" ? b.number : perspective === "customer" ? b.customer.name : vehicleLabel(b.vehicle) }]));
    if (perspective === "vehicle") data.vehicles.forEach(v => map.set(v.id, { id: v.id, label: vehicleLabel(v) }));
    return [...map.values()].filter(v => v.id).sort((a, b) => a.label.localeCompare(b.label));
  }, [data, perspective]);
  const matchingOptions = options.filter(o => o.label.toLowerCase().includes(recordSearch.toLowerCase()));
  const isFiltered = !!(records.length || statuses.length || search);
  const reset = () => { setRecordSearch(""); setSearch(""); setRecords([]); setStatuses([]); };
  const move = (start: string, days = range.days, period = range.period) => {
    const date = parseLocalDate(start);
    onRange(period === "month" ? { start: format(startOfMonth(date), "yyyy-MM-dd"), days: getDaysInMonth(date), period } : { start, days, period });
    setSelectedDate(null); scrollRef.current?.scrollTo?.({ left: 0 });
  };
  const step = (direction: number) => move(range.period === "month" ? format(addMonths(parseLocalDate(range.start), direction), "yyyy-MM-dd") : shiftDay(range.start, direction * range.days));
  const toggle = (value: string, list: string[], set: (s: string[]) => void) => set(list.includes(value) ? list.filter(x => x !== value) : [...list, value]);
  const dayBookings = selectedDate ? filtered.filter(b => onDay(b, selectedDate)) : [];
  const dayBlocks = selectedDate ? blocks.filter(b => b.start <= selectedDate && b.end >= selectedDate) : [];
  const plusOffset = extensionEnd ? dayNumber(extensionEnd) + 1 - dayNumber(range.start) : -1;
  return <section className={cn("rental-timeline", compact && "tl-compact")} aria-label={heading || "Rental timeline"} data-testid="timeline">
    <div className="tl-toolbar">
      <div className="tl-toolbar-heading"><h3>{heading || "Booking calendar"}</h3>{onExpand && <Button size="icon-sm" variant="ghost" onClick={onExpand} aria-label="Expand timeline" className="ml-auto"><Maximize2 size={16} /></Button>}</div>
      <div className="tl-controls">
        {!fixedPerspective && <div className="tl-perspectives" role="group" aria-label="Timeline perspective">{(["rental", "vehicle", "customer"] as Perspective[]).map(p => <button type="button" key={p} aria-pressed={perspective === p} onClick={() => { setPerspective(p); setRecords([]); setRecordSearch(""); }}>{p === "rental" ? <ListFilter size={14} /> : p === "vehicle" ? <Car size={14} /> : <User size={14} />}{p[0].toUpperCase() + p.slice(1)}</button>)}</div>}
        {!compact && <label className="tl-search"><Search size={15} /><input aria-label="Search timeline" value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${perspective}s…`} />{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}</label>}
        <Popover><PopoverTrigger asChild><Button size="sm" variant="outline" aria-label="Filter timeline"><Filter size={14} />Filters{records.length + statuses.length > 0 && <span className="tl-count">{records.length + statuses.length}</span>}</Button></PopoverTrigger>
          <PopoverContent align="end" className="tl-filter-popover" collisionPadding={12}>
            <div className="tl-popover-heading"><strong>Filter timeline</strong><button type="button" onClick={reset}>Reset</button></div>
            {compact && <label className="tl-search"><Search size={14} /><input aria-label="Search timeline" placeholder="Search bookings…" value={search} onChange={e => setSearch(e.target.value)} /></label>}
            <p className="tl-field-label">Booking status</p><div className="tl-status-filters">{STATUSES.map(s => <button type="button" key={s} aria-pressed={statuses.includes(s)} onClick={() => toggle(s, statuses, setStatuses)} className={statuses.includes(s) ? "is-active" : ""}>{statuses.includes(s) && <Check size={12} />}{s}</button>)}</div>
            {!fixedPerspective && <><p className="tl-field-label">Select {perspective}s <small>All when none selected</small></p><label className="tl-search"><Search size={14} /><input aria-label="Find records" placeholder={`Find a ${perspective}…`} value={recordSearch} onChange={e => setRecordSearch(e.target.value)} /></label><div className="tl-record-options">{matchingOptions.map(o => <label key={o.id}><input type="checkbox" checked={records.includes(o.id)} onChange={() => toggle(o.id, records, setRecords)} /><span>{o.label}</span></label>)}{!matchingOptions.length && <p className="tl-info-note">{recordSearch ? "No matching records." : "No records in this window."}</p>}</div></>}
          </PopoverContent>
        </Popover>
        {onBlock && <Button size="sm" variant="outline" onClick={() => onBlock(selectedDate || today)}><CircleSlash size={14} />Block dates</Button>}
      </div>
      <div className="tl-navigation">
        <div className="tl-period-nav"><Button variant="outline" size="icon-sm" aria-label="Previous period" onClick={() => step(-1)}><ChevronLeft size={15} /></Button><Button variant="outline" size="sm" onClick={() => move(shiftDay(today, compact ? -1 : -2))}>Today</Button><Button variant="outline" size="icon-sm" aria-label="Next period" onClick={() => step(1)}><ChevronRight size={15} /></Button></div>
        <Popover open={rangeOpen} onOpenChange={open => { setRangeOpen(open); if (open) { setDraftStart(range.start); setDraftEnd(dates[dates.length - 1]); setRangeError(""); } }}><PopoverTrigger asChild><button type="button" className="tl-range-label" aria-label="Choose date range">{format(parseLocalDate(range.start), "MMM d")} <span>—</span> {format(parseLocalDate(dates[dates.length - 1]), "MMM d, yyyy")}<CalendarDays size={13} /></button></PopoverTrigger><PopoverContent className="tl-filter-popover" align="start"><strong className="text-sm">Choose date range</strong><div className="tl-date-fields"><label>From<input type="date" value={draftStart} onChange={e => setDraftStart(e.target.value)} /></label><label>Through<input type="date" value={draftEnd} min={draftStart} onChange={e => setDraftEnd(e.target.value)} /></label></div>{rangeError && <p role="alert" className="tl-form-error">{rangeError}</p>}<Button size="sm" className="mt-3 w-full" onClick={() => { const count = dayNumber(draftEnd) - dayNumber(draftStart) + 1; if (!Number.isFinite(count) || count < 1 || count > 93) return setRangeError("Choose a range of 1 to 93 days."); move(draftStart, count, "custom"); setRangeOpen(false); }}>Show dates</Button></PopoverContent></Popover>
        {!compact && <div className="tl-periods" role="group" aria-label="Date window">{([['week', 7, 'Week'], ['fortnight', 14, '2 weeks'], ['month', getDaysInMonth(parseLocalDate(range.start)), 'Month']] as const).map(([p, days, label]) => <button type="button" key={p} aria-pressed={range.period === p && range.days === days} onClick={() => move(range.start, days, p)}>{label}</button>)}</div>}
      </div>
      {isFiltered && <div className="tl-active-filters">{search && <button onClick={() => setSearch("")}>“{search}” <X size={12} /></button>}{statuses.map(s => <button key={s} onClick={() => toggle(s, statuses, setStatuses)}>{s} <X size={12} /></button>)}{records.map(id => <button key={id} onClick={() => toggle(id, records, setRecords)}>{options.find(o => o.id === id)?.label || "Selected record"} <X size={12} /></button>)}<button type="button" className="tl-reset" onClick={reset}>Clear all</button></div>}
    </div>
    {fixedPerspective && initialPerspective !== "rental" && !loading && !error && <HistoryShortcuts bookings={filtered} today={today} onDate={date => move(shiftDay(date, -1))} />}
    <div className="tl-window-meta"><span><span className="tl-live-dot" />{loading ? "Loading bookings…" : `${lanes.length} ${itemLabel}${lanes.length === 1 ? "" : "s"} in view`}</span><span>{timezone || "Calendar dates"}</span></div>
    {error ? <div className="tl-state" role="alert"><CircleSlash /><strong>Timeline unavailable</strong><p>{error}</p>{onRetry && <Button size="sm" variant="outline" onClick={onRetry}><RotateCcw size={14} />Try again</Button>}</div> : loading ? <div className="tl-loading" aria-label="Loading timeline" aria-busy="true">{[0, 1, 2, 3].map(n => <div key={n} style={{ marginLeft: `${n * 8}%`, width: `${65 - n * 7}%` }} />)}</div> : <>
      <TooltipProvider delayDuration={350}>
        <div className="tl-scroll" ref={scrollRef} tabIndex={0} aria-label="Scrollable booking timeline">
          <DateGrid data={data} bookings={filtered} blocks={blocks} perspective={perspective}
            start={range.start} dates={dates} compact={compact} today={today} selectedDate={selectedDate}
            onDate={setSelectedDate} currency={currency} scopedVehicle={!!fixedPerspective && initialPerspective === "vehicle"}
            extensionEnd={extensionEnd} onExtend={onExtend}
            renderBooking={({ booking, position }, top) => <BookingLine key={booking.id} booking={booking} perspective={perspective} position={position} top={top} currency={currency} onOpen={onOpenRental} selected={booking.id === selectedBooking} onSelect={setSelectedBooking} />}
            renderBlock={(block, top) => <BlockLine key={block.id} block={block} data={data} start={range.start} days={range.days} top={top} />}
          />
        </div>
      </TooltipProvider>
      {!lanes.length && <div className="tl-empty"><CalendarDays size={21} /><div><strong>{isFiltered ? "No bookings match these filters" : "A clear window"}</strong><p>{isFiltered ? "Try another record, status or search." : "No bookings during these dates. Explore another period."}</p></div>{isFiltered ? <Button size="sm" variant="outline" onClick={reset}>Reset filters</Button> : data.bookings.length > 0 && <Button size="sm" variant="outline" onClick={() => move(shiftDay(data.bookings[0].start, -1))}>Find a booking</Button>}</div>}
      {onExtend && (plusOffset < 0 || plusOffset >= range.days) && <Button size="sm" variant="outline" className="m-3" onClick={() => move(shiftDay(extensionEnd!, -2))}>Go to rental end <ArrowRight size={14} /></Button>}
      <div className="tl-footer"><span><span className="tl-legend-line" />{itemLabel === "period" ? "Rental period" : "Booking"}{(blocks.length > 0 || !!onBlock) && <><span className="tl-legend-block" />Blocked</>}</span><span>{compact ? "Select a line for details" : "Select a date for its bookings · Select a line for details"}</span></div>
      {selectedDate && <div className="tl-day-detail" aria-live="polite"><div className="tl-popover-heading"><div><span className="tl-eyebrow">ON THIS DATE</span><h4>{prettyDay(selectedDate)}</h4></div><button type="button" onClick={() => setSelectedDate(null)} aria-label="Close date details"><X size={16} /></button></div><p>{dayBookings.length} {itemLabel}{dayBookings.length === 1 ? "" : "s"}{dayBlocks.length ? ` · ${dayBlocks.length} blocked periods` : ""}</p><div className="tl-day-list">{dayBookings.map(b => <Popover key={b.id}><PopoverTrigger asChild><button type="button" className="tl-day-item"><span><strong>{b.segment || b.number}</strong><small>{vehicleName(b.vehicle)} · {b.customer.name}</small></span><Status status={b.status} /><ChevronRight size={15} /></button></PopoverTrigger><PopoverContent className="tl-info-popover"><BookingInfo booking={b} currency={currency} onOpen={onOpenRental ? () => onOpenRental(b.rentalId) : undefined} /></PopoverContent></Popover>)}{dayBlocks.map(b => <div key={b.id} className="tl-day-item"><CircleSlash size={14} /><span><strong>Blocked · {b.vehicleId ? vehicleName(data.vehicles.find(v => v.id === b.vehicleId) || { id: "", reg: "", make: "Vehicle", model: "", daily: null, weekly: null, monthly: null }) : "All vehicles"}</strong><small>{b.reason || "No reason recorded"}</small></span></div>)}{!dayBookings.length && !dayBlocks.length && <p className="tl-info-note">No bookings or blocked periods on this date.</p>}</div></div>}
    </>}
  </section>;
}
