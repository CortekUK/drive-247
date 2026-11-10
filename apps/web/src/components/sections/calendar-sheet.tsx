"use client";

import { ArrowRight, Check, Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./calendar-sheet.css";

/*
 * The sheet a booking opens on the landing calendar (Ghulam, 2026-11-10: "when I click on any
 * box a sheet opens from the side to do the configurations of different kinds"; then "make it
 * minimal"). Made-up data, but every control works locally: the length changes the return
 * date, the handover switches, extras turn on and off, and the total follows. A service block
 * opens its own settings instead.
 *
 * Minimal: no boxes, icons or notes. Words, hairlines, plain switches and one button.
 *
 * Rendered into <body> when it opens over the page, because the calendar sits inside the
 * sliding track, whose transform would otherwise pin a fixed sheet to the track. On the wide
 * track it is docked instead: part of the calendar screen, always open.
 */

export type SheetState = "out" | "booked" | "pending" | "blocked" | "returning";
export type SheetBooking = {
  who: string;
  car: string;
  plate: string;
  rate: number;
  state: SheetState;
  start: { name: string; date: number };
  days: number;
};

const STATUS: Record<SheetState, string> = {
  out: "On rent",
  returning: "Back today",
  booked: "Booked",
  pending: "Awaiting payment",
  blocked: "Blocked",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayAfter = (start: SheetBooking["start"], n: number) => {
  const i = (DAY_NAMES.indexOf(start.name) + n) % 7;
  const date = start.date + n;
  return `${DAY_NAMES[i]} ${date > 30 ? date - 30 : date} Nov`;
};
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CalendarSheet({ booking, onClose, docked = false }: { booking: SheetBooking | null; onClose: () => void; docked?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes; the page behind stays still while the sheet is open over it.
  useEffect(() => {
    if (!booking || docked) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    document.documentElement.classList.add("cs-sheet-open");
    return () => {
      removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("cs-sheet-open");
    };
  }, [booking, onClose, docked]);

  // Docked: part of the calendar screen, always open, no scrim, no close.
  if (docked) {
    return booking ? (
      <div className="csh-root is-open is-docked">
        <Sheet key={`${booking.car}-${booking.who}`} booking={booking} onClose={onClose} docked />
      </div>
    ) : null;
  }
  if (!mounted) return null;
  return createPortal(
    <div className={`csh-root${booking ? " is-open" : ""}`} aria-hidden={!booking}>
      <div className="csh-scrim" onClick={onClose} />
      {booking && <Sheet key={`${booking.car}-${booking.who}`} booking={booking} onClose={onClose} />}
    </div>,
    document.body,
  );
}

function Sheet({ booking, onClose, docked = false }: { booking: SheetBooking; onClose: () => void; docked?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!docked) closeRef.current?.focus();
  }, [docked]);
  const blocked = booking.state === "blocked";

  return (
    <aside className="csh" role={docked ? "region" : "dialog"} aria-modal={docked ? undefined : true} aria-labelledby="csh-title">
      <header className="csh-head">
        <span className="csh-who">
          <small className={`csh-status is-${booking.state}`}>{STATUS[booking.state]}</small>
          <b id="csh-title">{blocked ? booking.car : booking.who}</b>
          <small>{blocked ? `${booking.plate} · in service` : `${booking.car} · ${booking.plate}`}</small>
        </span>
        {!docked && (
          <button ref={closeRef} type="button" className="csh-close" onClick={onClose} aria-label="Close">
            <X strokeWidth={1.75} />
          </button>
        )}
      </header>
      <div className="csh-body">{blocked ? <BlockSettings booking={booking} /> : <RentalSettings booking={booking} />}</div>
    </aside>
  );
}

/* ---------- A rental ---------- */

const EXTRAS = [
  { key: "insurance", label: "Insurance", perDay: 18 },
  { key: "driver", label: "Additional driver", perDay: 12 },
  { key: "seat", label: "Child seat", perDay: 8 },
] as const;
type ExtraKey = (typeof EXTRAS)[number]["key"];
const HANDOVER = ["In person", "Lockbox", "Delivery"] as const;

function RentalSettings({ booking }: { booking: SheetBooking }) {
  const { state } = booking;
  const [days, setDays] = useState(booking.days);
  const [handover, setHandover] = useState<(typeof HANDOVER)[number]>(state === "out" ? "Lockbox" : "In person");
  const [extras, setExtras] = useState<Record<ExtraKey, boolean>>({ insurance: state !== "pending", driver: false, seat: false });
  const [approved, setApproved] = useState(false);

  const perDay = booking.rate + EXTRAS.reduce((sum, e) => sum + (extras[e.key] ? e.perDay : 0), 0);
  const total = days * perDay + (handover === "Delivery" ? 35 : 0);
  const settled = state !== "pending" || approved;
  const paid = settled ? booking.days * (booking.rate + 18) : 0;
  const due = Math.max(0, total - paid);

  return (
    <>
      <Field label="Dates">
        <div className="csh-dates">
          <span>{dayAfter(booking.start, 0)}</span>
          <ArrowRight strokeWidth={1.5} />
          <span>{dayAfter(booking.start, days)}</span>
          <Stepper value={days} unit="days" min={1} onChange={setDays} />
        </div>
      </Field>

      <Field label="Handover">
        <Tabs options={HANDOVER} value={handover} onChange={setHandover} />
      </Field>

      <Field label="Extras">
        {EXTRAS.map(({ key, label, perDay: price }) => (
          <Toggle key={key} label={label} hint={`${money(price)}/day`} on={extras[key]} onChange={(v) => setExtras((x) => ({ ...x, [key]: v }))} />
        ))}
      </Field>

      <Field label="Checks">
        <ul className="csh-checks">
          <Done ok={paid > 0}>Paid</Done>
          <Done ok={settled}>Signed</Done>
          <Done ok={state !== "pending"}>ID</Done>
        </ul>
      </Field>

      <footer className="csh-foot">
        <p className="csh-total">
          <span>Total</span>
          <b>{money(total)}</b>
        </p>
        {state === "pending" && !approved ? (
          <button type="button" className="csh-primary" onClick={() => setApproved(true)}>
            Approve booking
          </button>
        ) : (
          <button type="button" className="csh-primary">
            {state === "out" || state === "returning" ? "Check in return" : due > 0 ? `Send link for ${money(due)}` : "Hand over keys"}
          </button>
        )}
      </footer>
    </>
  );
}

/* ---------- A service block ---------- */

const REASONS = ["Service", "Repair", "Cleaning"] as const;

function BlockSettings({ booking }: { booking: SheetBooking }) {
  const [reason, setReason] = useState<(typeof REASONS)[number]>("Service");
  const [days, setDays] = useState(booking.days);
  const [hide, setHide] = useState(true);
  const [remind, setRemind] = useState(true);

  return (
    <>
      <Field label="Reason">
        <Tabs options={REASONS} value={reason} onChange={setReason} />
      </Field>

      <Field label="Dates">
        <div className="csh-dates">
          <span>{dayAfter(booking.start, 0)}</span>
          <ArrowRight strokeWidth={1.5} />
          <span>{dayAfter(booking.start, days)}</span>
          <Stepper value={days} unit="days" min={1} onChange={setDays} />
        </div>
      </Field>

      <Field label="While blocked">
        <Toggle label="Hide from booking site" on={hide} onChange={setHide} />
        <Toggle label="Remind me the day before" on={remind} onChange={setRemind} />
      </Field>

      <footer className="csh-foot">
        <button type="button" className="csh-primary">
          Save
        </button>
      </footer>
    </>
  );
}

/* ---------- Parts ---------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="csh-field">
      <h3>{label}</h3>
      {children}
    </section>
  );
}

function Tabs<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="csh-tabs" role="radiogroup">
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? "is-on" : ""} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, unit, min, onChange }: { value: number; unit: string; min: number; onChange: (v: number) => void }) {
  return (
    <span className="csh-stepper">
      <button type="button" aria-label="One less" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        <Minus strokeWidth={1.75} />
      </button>
      <b>
        {value} {value === 1 ? unit.replace(/s$/, "") : unit}
      </b>
      <button type="button" aria-label="One more" onClick={() => onChange(Math.min(21, value + 1))}>
        <Plus strokeWidth={1.75} />
      </button>
    </span>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="csh-toggle" onClick={() => onChange(!on)}>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
      <i className={`csh-switch${on ? " is-on" : ""}`} aria-hidden />
    </button>
  );
}

function Done({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? "is-ok" : "is-wait"}>
      {ok ? <Check strokeWidth={2.5} /> : <i aria-hidden />}
      {children}
    </li>
  );
}
