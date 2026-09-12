"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { format } from "date-fns";
import { Car, Plus } from "lucide-react";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { bookingRows, dayNumber, prettyDay, vehicleName, type Perspective, type TimelineBlock, type TimelineBooking, type TimelineData, type TimelineVehicle } from "./model";

type Lane = ReturnType<typeof bookingRows>[number]["lanes"][number];
type GridRow = { id: string; label: string; detail: string; vehicle?: TimelineVehicle; lanes: Lane[]; blocks: TimelineBlock[] };
type Props = {
  data: TimelineData; bookings: TimelineBooking[]; blocks: TimelineBlock[]; perspective: Perspective;
  start: string; dates: string[]; compact: boolean; today: string; selectedDate: string | null;
  onDate: (date: string) => void; currency: string; scopedVehicle: boolean;
  renderBooking: (item: Lane, top: number) => ReactNode;
  renderBlock: (block: TimelineBlock, top: number) => ReactNode;
  extensionEnd?: string | null; onExtend?: () => void;
};

/** A single scroll surface owns both axes. Daily cells and intervals share the
 * same percentage coordinate system; identity columns never affect duration. */
export function DateGrid({ data, bookings, blocks, perspective, start, dates, compact, today, selectedDate, onDate, currency, scopedVehicle, renderBooking, renderBlock, extensionEnd, onExtend }: Props) {
  const rows = useMemo(() => {
    const result: GridRow[] = bookingRows(bookings, perspective, start, dates.length).map(group => {
      const b = group.bookings[0];
      return { id: group.id, label: perspective === "vehicle" ? vehicleName(b.vehicle) : perspective === "customer" ? b.customer.name : b.number,
        detail: perspective === "vehicle" ? b.vehicle.reg : group.bookings.length === 1 ? b.status : `${group.bookings.length} ${b.segment ? "periods" : "bookings"}`,
        vehicle: perspective === "vehicle" ? b.vehicle : undefined, lanes: group.lanes, blocks: [] };
    });
    // Keep the selected vehicle's actual daily cells visible even in a booking gap.
    if (scopedVehicle && data.vehicles[0] && !result.length) {
      const v = data.vehicles[0];
      result.push({ id: v.id, label: vehicleName(v), detail: v.reg, vehicle: v, lanes: [], blocks: [] });
    }
    blocks.forEach(block => {
      const id = perspective === "vehicle" && block.vehicleId ? block.vehicleId : `blocked:${block.vehicleId ?? "fleet"}`;
      let row = result.find(r => r.id === id);
      if (!row) {
        const v = data.vehicles.find(v => v.id === block.vehicleId);
        row = { id, label: block.vehicleId ? v ? vehicleName(v) : "Vehicle" : "All vehicles", detail: "Blocked dates", vehicle: perspective === "vehicle" ? v : undefined, lanes: [], blocks: [] };
        result.push(row);
      }
      row.blocks.push(block);
    });
    return result;
  }, [bookings, blocks, perspective, start, dates.length, data.vehicles, scopedVehicle]);
  const todayOffset = dayNumber(today) - dayNumber(start);
  const plusOffset = extensionEnd ? dayNumber(extensionEnd) + 1 - dayNumber(start) : -1;
  const identity = compact ? "0px" : "176px";
  return <div className="tl-axis" style={{ "--tl-days": dates.length, "--tl-min-day": compact ? "36px" : dates.length > 14 ? "34px" : "40px", "--tl-identity": identity } as CSSProperties}>
    <div className="tl-grid-header">
      <div className="tl-identity tl-identity-heading">{perspective === "rental" ? "Rental" : perspective === "vehicle" ? "Vehicle" : "Customer"}<small>{format(parseLocalDate(start), "MMM yyyy")}</small></div>
      <div className="tl-date-header">
        {dates.map((date, index) => <button key={date} type="button" className={cn("tl-date", date === today && "tl-date-today", date === selectedDate && "tl-date-selected", [0, 6].includes(parseLocalDate(date).getDay()) && "tl-weekend")}
          aria-label={`Show bookings on ${prettyDay(date)}${date === today ? ", today" : ""}`} aria-pressed={selectedDate === date} onClick={() => onDate(date)}
          onKeyDown={e => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); (e.currentTarget.parentElement?.children[index + (e.key === "ArrowRight" ? 1 : -1)] as HTMLElement)?.focus(); } }}>
          <span>{date === today ? "Today" : format(parseLocalDate(date), "EEE")}</span><strong>{format(parseLocalDate(date), "d")}</strong>
        </button>)}
      </div>
    </div>
    <div className="tl-grid-body">
      {rows.map(row => {
        const laneCount = Math.max(0, ...row.lanes.map(l => l.lane + 1));
        const caption = compact ? 21 : 0;
        const lineArea = Math.max(1, laneCount + row.blocks.length) * 24;
        const priced = !!row.vehicle;
        const height = Math.max(!compact && row.label.length > 22 && row.detail ? 60 : 0, caption + 20 + lineArea + (priced ? 20 : 0));
        return <div className="tl-grid-row" key={row.id} data-row-id={row.id} style={{ height }}>
          <div className="tl-identity" title={`${row.label}${row.detail ? ` · ${row.detail}` : ""}`}>
            {row.vehicle && (row.vehicle.photoUrl ? <img src={row.vehicle.photoUrl} alt="" className="tl-vehicle-thumb" loading="lazy" /> : <span className="tl-vehicle-placeholder"><Car size={17} /></span>)}
            <div><strong>{row.label}</strong>{row.detail && <small>{row.detail}</small>}</div>
          </div>
          <div className="tl-row-dates">
            <div className="tl-cells">{dates.map(date => {
              const price = scopedVehicle ? data.prices[date] ?? row.vehicle?.daily : row.vehicle?.daily;
              const priceKind = scopedVehicle && data.prices[date] != null ? "Custom daily price" : "Base daily rate";
              return <div key={date} data-cell-date={date} className={cn("tl-cell", [0, 6].includes(parseLocalDate(date).getDay()) && "tl-weekend", selectedDate === date && "tl-cell-selected")}>
                {priced && <span className="tl-cell-price" title={price != null ? `${priceKind}: ${formatCurrency(price, currency)} /day` : "Daily rate unavailable"}>{price != null ? formatCurrency(price, currency, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "—"}</span>}
              </div>;
            })}</div>
            {compact && <div className="tl-row-caption" title={row.label}>{row.label}</div>}
            {row.lanes.map(item => renderBooking(item, caption + 10 + item.lane * 24))}
            {row.blocks.map((block, index) => renderBlock(block, caption + 10 + (laneCount + index) * 24))}
            {onExtend && row.lanes.length > 0 && plusOffset >= 0 && plusOffset < dates.length && <button type="button" className="tl-extension-plus" aria-label="Add manual extension" title="Preview a manual extension" style={{ left: `calc(var(--tl-day) * ${plusOffset} + 4px)`, top: caption + 9 }} onClick={onExtend}><Plus size={16} /></button>}
          </div>
        </div>;
      })}
      {!rows.length && <div className="tl-grid-row tl-vacant-row"><div className="tl-identity" /><div className="tl-row-dates"><div className="tl-cells">{dates.map(date => <div className={cn("tl-cell", [0, 6].includes(parseLocalDate(date).getDay()) && "tl-weekend")} key={date} />)}</div></div></div>}
      {todayOffset >= 0 && todayOffset < dates.length && <div className="tl-today-track"><div className="tl-today-line" aria-label="Today indicator" style={{ left: `calc(var(--tl-day) * ${todayOffset + .5})` }} /></div>}
    </div>
  </div>;
}
