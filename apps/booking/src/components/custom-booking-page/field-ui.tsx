"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";
import { useRootTheme } from "./theme-toggle";

/* ========================================================================== *
 * Booking-form field primitives.
 *
 * These replace the native `<select>` and `<input type="date">`. A browser
 * paints those popups with OS chrome no stylesheet can reach: on the dark
 * theme that meant a white list of near-invisible options, and a native
 * calendar glyph rendered on top of the custom one. Everything here is real
 * markup, so every colour token actually applies.
 *
 * POSITIONING is Radix Popover's — Floating UI underneath — and not ours.
 * The hand-rolled version this replaced measured the trigger, then guessed the
 * menu's height as 280px because the portal had not rendered yet, decided from
 * that guess that there was no room below, and flipped upward. A two-option
 * menu is about 100px tall, so it landed ~186px too high — at the top of the
 * hero, nowhere near the field that opened it — and nothing ever re-measured
 * to correct it. Radix measures after mount, flips only on a real collision,
 * and re-anchors on scroll and resize.
 *
 * Every field owns its own Popover.Root and its own generated id, so no
 * trigger reference or anchor is ever shared between two dropdowns.
 *
 * Values are unchanged — dates stay `yyyy-MM-dd` and times `HH:mm`, exactly
 * what the reservation engine parses. This file is presentation only; it knows
 * nothing about booking rules.
 * ========================================================================== */

/** Placement shared by every dropdown here. */
const POPPER = {
  side: "bottom",
  align: "start",
  sideOffset: 8,
  collisionPadding: 16,
  avoidCollisions: true,
} as const;

/**
 * The portal lands on `document.body`, outside `.cbp`, so the design tokens
 * have to travel with it — hence the `cbp` class on the content — and so does
 * the light/dark choice, which lives as `data-theme` on the page root.
 */
/* ---------------------------------------------------------- field shell -- */

/**
 * The trigger. One shell for every field so heights, padding and icon
 * alignment cannot drift apart. `asChild` on the Radix trigger means this
 * button IS the anchor — there is no wrapper element between them.
 */
const FieldButton = ({
  label, icon, value, sub, placeholder, isStatic, id, ...rest
}: {
  label: string;
  icon: string;
  value: string;
  sub?: string;
  placeholder?: boolean;
  isStatic?: boolean;
  id?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    id={id}
    className="cbp-fld"
    data-static={isStatic ? "true" : "false"}
    aria-label={label}
    tabIndex={isStatic ? -1 : 0}
    {...rest}
  >
    <Icon name={icon} className="cbp-fld-icon" />
    <span className="cbp-fld-body">
      <span className="cbp-fld-value" data-placeholder={placeholder ? "true" : "false"}>{value}</span>
      {sub && <span className="cbp-fld-sub">{sub}</span>}
    </span>
    {!isStatic && <Icon name="chevron" className="cbp-fld-caret" />}
  </button>
);

/** A field with nothing to choose — one option, already answered. */
export function FieldShell(props: {
  label: string; icon: string; value: string; sub?: string; placeholder?: boolean;
}) {
  return <FieldButton {...props} isStatic />;
}

/* -------------------------------------------------------------- select --- */

export interface CbpOption {
  value: string;
  label: string;
  /** Right-aligned meta — a delivery fee, say. */
  sub?: string;
  /** Second line under the field's value when this option is chosen. */
  detail?: string;
}

/**
 * An accessible listbox. Keyboard: Up/Down/Home/End move, Enter/Space choose,
 * Escape closes (Radix), and typing jumps to the first matching label.
 *
 * Focus deliberately stays on the trigger — `onOpenAutoFocus` is prevented —
 * so the combobox pattern holds: the trigger keeps focus and points at the
 * active option through `aria-activedescendant`.
 */
export function CbpSelect({
  label, icon, options, value, onChange, placeholder = "Select",
}: {
  label: string;
  icon: string;
  options: CbpOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;
  const listRef = useRef<HTMLDivElement | null>(null);
  const typed = useRef({ str: "", at: 0 });
  const theme = useRootTheme(open);

  const selected = options.find(o => o.value === value) ?? null;
  const selectedIndex = Math.max(0, options.findIndex(o => o.value === value));

  useEffect(() => { if (open) setActive(selectedIndex); }, [open, selectedIndex]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optId(active))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); commit(active); }
    else if (e.key === "Tab") { setOpen(false); }
    else if (e.key.length === 1) {
      // Type-ahead, the behaviour a native select has and a div does not.
      const now = Date.now();
      typed.current.str = now - typed.current.at > 800 ? e.key : typed.current.str + e.key;
      typed.current.at = now;
      const q = typed.current.str.toLowerCase();
      const hit = options.findIndex(o => o.label.toLowerCase().startsWith(q));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <FieldButton
          label={label} icon={icon}
          value={selected?.label ?? placeholder}
          sub={selected?.detail}
          placeholder={!selected}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? optId(active) : undefined}
          onKeyDown={onKeyDown}
        />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          {...POPPER}
          className="cbp-pop cbp-pop--list cbp"
          data-theme={theme}
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <div ref={listRef} id={listId} role="listbox" aria-label={label} className="cbp-pop-list">
            {options.map((o, i) => (
              <div
                key={o.value}
                id={optId(i)}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                data-selected={o.value === value}
                className="cbp-opt"
                onPointerEnter={() => setActive(i)}
                onClick={() => commit(i)}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.sub && <span className="cbp-opt-sub">{o.sub}</span>}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------------------------------------------------------- date picker -- */

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** `yyyy-MM-dd` without timezone drift — never `toISOString`, which shifts. */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parseIso = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** "2 Sept 2026" for the field — short enough not to truncate in its column,
 *  and unambiguous about day versus month, which a numeric format is not. */
const pretty = (s: string) => {
  const d = parseIso(s);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
};

/** The long form, for a day cell's accessible name. */
const prettyLong = (s: string) => {
  const d = parseIso(s);
  return d
    ? d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";
};

export function CbpDatePicker({
  label, value, min, onChange,
}: {
  label: string;
  value: string;
  /** `yyyy-MM-dd`; earlier days are shown but not selectable. */
  min?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const theme = useRootTheme(open);

  const selected = parseIso(value);
  const [cursor, setCursor] = useState<Date>(() => selected ?? new Date());
  useEffect(() => { if (open && selected) setCursor(selected); }, [open, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const minDate = min ? parseIso(min) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Monday-first grid, including the leading/trailing days that fill the weeks.
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  const prevBlocked = minDate
    ? new Date(cursor.getFullYear(), cursor.getMonth(), 0) < minDate
    : false;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <FieldButton
          label={label} icon="calendar"
          value={value ? pretty(value) : "Select date"}
          placeholder={!value}
          aria-haspopup="dialog"
          aria-expanded={open}
        />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          {...POPPER}
          className="cbp-pop cbp-pop--cal cbp"
          data-theme={theme}
          aria-label={label}
        >
          <div className="cbp-cal">
            <div className="cbp-cal-head">
              <button
                type="button" className="cbp-cal-nav" aria-label="Previous month"
                disabled={prevBlocked}
                onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
              >
                <Icon name="chevronLeft" className="h-4 w-4" />
              </button>
              <span className="cbp-cal-title" aria-live="polite">
                {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
              </span>
              <button
                type="button" className="cbp-cal-nav" aria-label="Next month"
                onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
              >
                <Icon name="chevronRight" className="h-4 w-4" />
              </button>
            </div>

            <div className="cbp-cal-grid" role="grid" id={`${uid}-grid`}>
              {DOW.map(d => <span key={d} className="cbp-cal-dow">{d}</span>)}
              {days.map(d => {
                const key = iso(d);
                const outside = d.getMonth() !== cursor.getMonth();
                const disabled = !!minDate && d < minDate;
                return (
                  <button
                    key={key}
                    type="button"
                    className="cbp-cal-day"
                    disabled={disabled}
                    data-selected={key === value}
                    data-today={d.getTime() === today.getTime()}
                    data-outside={outside}
                    aria-label={prettyLong(key)}
                    aria-current={key === value ? "date" : undefined}
                    onClick={() => { onChange(key); setOpen(false); }}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
