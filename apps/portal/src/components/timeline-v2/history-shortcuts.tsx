import { bookingBounds, dayNumber, onDay, prettyDay, type TimelineBooking } from "./model";

/** Date navigation through this record's real history; these are not availability rules. */
export function HistoryShortcuts({ bookings, today, onDate }: { bookings: TimelineBooking[]; today: string; onDate: (date: string) => void }) {
  const earlier = bookings.filter(b => bookingBounds(b)[1] <= dayNumber(today)).sort((a, b) => bookingBounds(b)[1] - bookingBounds(a)[1]);
  const current = bookings.filter(b => onDay(b, today));
  const next = bookings.filter(b => b.start > today).sort((a, b) => a.start.localeCompare(b.start));
  return <nav className="tl-history-shortcuts" aria-label="Record booking history">
    {[
      { label: "Earlier", value: `${earlier.length} ${earlier.length === 1 ? "booking" : "bookings"}`, date: earlier[0]?.start },
      { label: "Today", value: `${current.length} ${current.length === 1 ? "booking" : "bookings"}`, date: current.length ? today : undefined },
      { label: "Next", value: next[0] ? prettyDay(next[0].start).replace(/, \d{4}$/, "") : "None", date: next[0]?.start },
    ].map(item => <button key={item.label} type="button" disabled={!item.date} onClick={() => item.date && onDate(item.date)}><span>{item.label}</span><strong>{item.value}</strong></button>)}
  </nav>;
}
