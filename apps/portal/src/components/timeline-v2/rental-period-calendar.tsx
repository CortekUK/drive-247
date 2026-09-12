"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui-v2/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { prettyDay, shiftDay, vehicleName, type TimelineBooking } from "./model";
import { movePeriodMonth, periodMonth, rentalPeriodDays } from "./rental-period-days";
import "./rental-period-calendar.css";

/** The V2 chart accents form one indigo/violet family. Period sequence, rather
 * than the currently visible dates or array position, owns the shade. */
function tone(period: TimelineBooking): CSSProperties {
  const sequence = Number(period.segment?.match(/#(\d+)/)?.[1] ?? 0);
  const shades = [
    ["chart-4", "248 68% 51%", .20], ["chart-3", "247 92% 60%", .38],
    ["chart-2", "241 100% 69%", .17], ["chart-5", "246 61% 42%", .30],
    ["chart-3", "247 92% 60%", .44], ["chart-2", "241 100% 69%", .23],
    ["chart-4", "248 68% 51%", .33], ["chart-5", "246 61% 42%", .40],
  ] as const;
  const [token, fallback, tint] = shades[sequence % shades.length];
  return { "--rp-tone": `var(--${token}, ${fallback})`, "--rp-tint": Math.min(tint + Math.floor(sequence / shades.length) * .025, .5) } as CSSProperties;
}
const dateRange = (p: TimelineBooking) => `${prettyDay(p.start)} → ${p.end ? prettyDay(p.end) : "Open-ended"}`;

type Props = {
  periods: TimelineBooking[]; month: string; onMonth: (month: string) => void;
  today: string; currentEnd?: string | null; onExtend?: () => void; onDiscard?: () => void;
  currency: string; timezone?: string | null;
};

/** Dedicated to Payment Plan. The sidebar always contains the actual dates;
 * only management actions and supporting information live in the dialog. */
export function RentalPeriodCalendar({ periods, month, onMonth, today, currentEnd, onExtend, onDiscard, currency, timezone }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const manageButton = useRef<HTMLButtonElement | null>(null);
  const days = rentalPeriodDays(periods, month);
  const firstMonth = periodMonth(periods[0].start);
  const lastMonth = periodMonth(currentEnd || periods.at(-1)!.end || periods[0].start);
  const selectedDay = days.find(day => day.date === selected);
  const previews = periods.filter(p => p.preview);
  const fullDate = (date: string) => format(parseLocalDate(date), "EEEE, MMMM d, yyyy");
  const move = (value: string) => { setSelected(null); onMonth(value); };
  const openDetails = (date: string | null, trigger: HTMLElement) => { opener.current = trigger; setSelected(date); setManageOpen(true); };
  const dateKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const grid = event.currentTarget.parentElement;
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 1;
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns } as Record<string, number>)[event.key];
    if (step) { event.preventDefault(); (grid?.children[index + step] as HTMLElement)?.focus(); }
  };
  return <section className="rp-calendar" aria-label="Rental period calendar" data-testid="rental-period-calendar">
    <Dialog open={manageOpen} onOpenChange={setManageOpen}>
      <div className="rp-month-nav">
        <h3>{format(parseLocalDate(month), "MMMM")} <span>{format(parseLocalDate(month), "yyyy")}</span></h3>
        <div className="rp-calendar-controls">
          {firstMonth !== lastMonth && <><Button size="icon-xs" variant="ghost" aria-label="Previous rental month" disabled={month <= firstMonth} onClick={() => move(movePeriodMonth(month, -1))}><ChevronLeft size={14} /></Button><Button size="icon-xs" variant="ghost" aria-label="Next rental month" disabled={month >= lastMonth} onClick={() => move(movePeriodMonth(month, 1))}><ChevronRight size={14} /></Button></>}
          <DialogTrigger asChild><Button ref={manageButton} size="xs" variant="outline" className="rp-manage-trigger" onClick={event => { opener.current = event.currentTarget; setSelected(null); }}>Manage</Button></DialogTrigger>
        </div>
      </div>
      <TooltipProvider delayDuration={250}>
        <div className="rp-date-boxes" aria-label={format(parseLocalDate(month), "MMMM yyyy")}>
          {days.map((day, index) => {
            const label = day.periods.map(({ period }) => `${period.segment}${period.preview ? ", unsaved preview" : ""}`).join(" and ") || "No rental period";
            return <Tooltip key={day.date}><TooltipTrigger asChild>
              <button type="button" data-rental-date={day.date} data-periods={day.periods.map(p => p.period.id).join(" ")} className={cn("rp-date-box", day.periods.length > 0 && "rp-occupied", day.date === today && "rp-today", day.date === selected && "rp-selected")}
                style={tone(day.periods[0]?.period ?? periods[0])} aria-label={`${fullDate(day.date)}, ${label}${day.date === today ? ", today" : ""}`} aria-pressed={day.date === selected} aria-current={day.date === today ? "date" : undefined} aria-haspopup="dialog"
                onClick={event => openDetails(day.date, event.currentTarget)} onKeyDown={event => dateKeyDown(event, index)}>
                <span className="rp-box-fills" aria-hidden="true">{day.periods.map(({ period, from, to }) => <span key={period.id} style={{ ...tone(period), left: `${from * 100}%`, width: `${(to - from) * 100}%` }} />)}</span>
                <strong>{format(parseLocalDate(day.date), "d")}</strong>
              </button>
            </TooltipTrigger>{!manageOpen && <TooltipContent className="rp-date-tooltip" side="top"><strong>{fullDate(day.date)}{day.date === today ? " · Today" : ""}</strong>{day.periods.length ? day.periods.map(({ period }) => <span key={period.id} style={tone(period)}><i className="rp-period-swatch" aria-hidden="true" />{period.segment}{period.preview ? " · Unsaved preview" : ""}</span>) : <span>No rental period</span>}</TooltipContent>}</Tooltip>;
          })}
        </div>
      </TooltipProvider>
      {previews.length > 0 && <p className="rp-preview-summary" role="status">{previews.length} unsaved {previews.length === 1 ? "extension preview" : "extension previews"}</p>}
      <DialogContent className="tl-dialog rp-manage-dialog sm:max-w-[520px] max-h-[85svh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); (opener.current?.isConnected ? opener.current : manageButton.current)?.focus(); }}>
        <DialogHeader><DialogTitle>Rental periods</DialogTitle><DialogDescription>{periods[0].number} · Review period details and extension actions.</DialogDescription></DialogHeader>
        {selectedDay && <div className="rp-selected-date" aria-live="polite"><strong>{fullDate(selectedDay.date)}</strong><p>{selectedDay.periods.map(p => p.period.segment).join(" · ") || "This date is outside the recorded rental periods."}</p></div>}
        <div className="rp-period-key" aria-label="Rental period colors and dates">
          {periods.map(period => <div key={period.id} className="rp-period-key-item" style={tone(period)}>
            <span className="rp-period-swatch" aria-hidden="true" /><div><strong>{period.segment}<small className="rp-source-label">{period.preview ? "Unsaved preview" : "Recorded"}</small></strong><p>{dateRange(period)}</p>
              {(period.pickupTime || period.returnTime) && <p>Start {period.pickupTime?.slice(0, 5) || "time not set"} · End {period.returnTime?.slice(0, 5) || "time not set"}</p>}
              {period.note && <p>{period.note}</p>}{period.amount != null && <p>Recorded total: {formatCurrency(period.amount, currency)}</p>}
              <button type="button" className="rp-show-period" onClick={() => { onMonth(periodMonth(period.start)); setSelected(period.start); setManageOpen(false); }}>Show dates</button>
            </div>
          </div>)}
        </div>
        <p className="rp-record-context">{vehicleName(periods[0].vehicle)} · {periods[0].customer.name}<br />{periods[0].status}{timezone ? ` · ${timezone}` : ""}</p>
        {(onExtend || previews.length > 0) && <p className="rp-preview-notice">New extensions are <strong>unsaved previews</strong>. Billing and availability stay unchanged.</p>}
        <DialogFooter className="rp-manage-actions">
          {onDiscard && <Button size="sm" variant="ghost" onClick={onDiscard}>Discard local previews</Button>}
          <Button size="sm" variant="outline" onClick={() => setManageOpen(false)}>Done</Button>
          {onExtend && <Button size="sm" className="rp-extension-action" data-extension-date={currentEnd ? shiftDay(currentEnd, 1) : undefined} onClick={onExtend}><Plus size={14} />Preview manual extension</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
