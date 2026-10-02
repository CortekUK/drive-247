"use client";

/**
 * Picking a rental's dates — a calendar built for one car.
 *
 * Opened from the Pickup or Return date on the When & where stage. Two months
 * side by side, and every day says whether THIS car can be out on it:
 *
 *   booked       another Pending or Active rental has the car (its ref on hover)
 *   maintenance  a block on this car marked maintenance or swap
 *   blocked      any other block on this car — manual, or a Turo reservation
 *   closed       a block for the whole fleet (no car) — the tenant is closed
 *
 * Pick a start day, then an end day; a range that would run across a taken day
 * is refused with the reason, before anything is saved. A time goes with each
 * end. "Use these dates" hands the two back to the stage, which shows the price
 * effect and saves with everything else — this dialog writes nothing.
 *
 * Reads are tenant-scoped (RLS is off on these tables — V2_PLAN §5).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { Pill } from "./_kit";

type Taken = { kind: "booked" | "maintenance" | "blocked" | "closed"; label: string };

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const fromYmd = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);

/** Every day this car cannot be out, keyed "yyyy-MM-dd". */
function useCarCalendar(vehicleId: string | null, rentalId: string) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["rental-dates-calendar-v2", tenant?.id, vehicleId, rentalId],
    queryFn: async () => {
      const [{ data: rentals, error: rErr }, { data: blocks, error: bErr }] = await Promise.all([
        supabase
          .from("rentals")
          .select("id, rental_number, start_date, end_date, status, customers!rentals_customer_id_fkey(name)")
          .eq("tenant_id", tenant!.id)
          .eq("vehicle_id", vehicleId!)
          .neq("id", rentalId)
          .in("status", ["Active", "Pending"]),
        supabase
          .from("blocked_dates")
          .select("start_date, end_date, reason, source_type, vehicle_id, turo_reservation_uid")
          .eq("tenant_id", tenant!.id)
          .or(`vehicle_id.eq.${vehicleId},vehicle_id.is.null`),
      ]);
      if (rErr) throw rErr;
      if (bErr) throw bErr;

      const map = new Map<string, Taken>();
      const mark = (start: string, end: string | null, t: Taken) => {
        const from = fromYmd(start);
        // Open-ended rentals hold the car for the next two years of calendar.
        const to = end ? fromYmd(end) : addDays(new Date(), 730);
        if (to < from) return;
        for (const d of eachDayOfInterval({ start: from, end: to })) {
          const k = ymd(d);
          // Booked outranks a block; a car block outranks a fleet-wide one.
          const rank = { booked: 3, maintenance: 2, blocked: 1, closed: 0 } as const;
          const had = map.get(k);
          if (!had || rank[t.kind] > rank[had.kind]) map.set(k, t);
        }
      };

      for (const b of (blocks ?? []) as any[]) {
        const kind: Taken["kind"] = !b.vehicle_id
          ? "closed"
          : b.source_type === "maintenance" || b.source_type === "swap"
            ? "maintenance"
            : "blocked";
        const label =
          kind === "closed"
            ? `Closed${b.reason ? ` — ${b.reason}` : ""}`
            : kind === "maintenance"
              ? `Maintenance${b.reason ? ` — ${b.reason}` : ""}`
              : b.turo_reservation_uid
                ? "Booked on Turo"
                : `Blocked${b.reason ? ` — ${b.reason}` : ""}`;
        mark(b.start_date, b.end_date ?? b.start_date, { kind, label });
      }
      for (const r of (rentals ?? []) as any[]) {
        mark(r.start_date, r.end_date, {
          kind: "booked",
          label: `Booked · ${r.rental_number ?? "rental"}${r.customers?.name ? ` · ${r.customers.name}` : ""}`,
        });
      }
      return map;
    },
    enabled: !!tenant?.id && !!vehicleId,
  });
}

/** Half-hour slots, as the app's other time pickers offer. */
const SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? "30" : "00";
  const value = `${String(h).padStart(2, "0")}:${m}`;
  const label = new Date(2000, 0, 1, h, Number(m)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { value, label };
});

const TAKEN_STYLE: Record<Taken["kind"], string> = {
  booked: "bg-destructive/10 text-destructive/70 line-through decoration-destructive/40",
  maintenance: "bg-warning/15 text-warning line-through decoration-warning/40",
  blocked: "bg-foreground/[0.06] text-muted-foreground line-through",
  closed: "bg-foreground/[0.06] text-muted-foreground line-through",
};

export function RentalDatesDialog({
  open,
  onOpenChange,
  vehicleId,
  vehicleName,
  rentalId,
  pickupAt,
  returnAt,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string | null;
  vehicleName: string;
  rentalId: string;
  /** "yyyy-MM-ddTHH:mm" */
  pickupAt: string;
  returnAt: string;
  onApply: (pickupAt: string, returnAt: string) => void;
}) {
  const { data: taken, isLoading } = useCarCalendar(open ? vehicleId : null, rentalId);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:00");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [hover, setHover] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Seed from what the stage holds, every time the dialog opens.
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setStart(pickupAt.slice(0, 10) || null);
    setEnd(returnAt.slice(0, 10) || null);
    setStartTime(pickupAt.slice(11, 16) || "10:00");
    setEndTime(returnAt.slice(11, 16) || "10:00");
    setMonth(startOfMonth(pickupAt ? fromYmd(pickupAt) : new Date()));
    setProblem(null);
    setSeeded(true);
  }
  if (!open && seeded) setSeeded(false);

  const today = ymd(new Date());

  /** The first taken day strictly inside (a, b], if any. */
  const firstConflict = (a: string, b: string): { day: string; t: Taken } | null => {
    if (!taken) return null;
    for (const d of eachDayOfInterval({ start: fromYmd(a), end: fromYmd(b) })) {
      const k = ymd(d);
      if (k === a) continue; // the pickup day itself is checked on click
      const t = taken.get(k);
      if (t) return { day: k, t };
    }
    return null;
  };

  const pick = (k: string) => {
    setProblem(null);
    const t = taken?.get(k);
    if (t) return setProblem(`${format(fromYmd(k), "EEE d MMM")} is taken — ${t.label}.`);
    if (k < today) return setProblem("That day has already gone.");
    if (!start || (start && end) || k <= start) {
      setStart(k);
      setEnd(null);
      return;
    }
    const clash = firstConflict(start, k);
    if (clash) {
      return setProblem(
        `The car is not free all the way through — ${format(fromYmd(clash.day), "EEE d MMM")}: ${clash.t.label}.`
      );
    }
    setEnd(k);
  };

  const preview = start && !end && hover && hover > start ? hover : end;
  const days = start && end ? differenceInCalendarDays(fromYmd(end), fromYmd(start)) : null;

  const Month = ({ base }: { base: Date }) => {
    const cells = eachDayOfInterval({
      start: startOfWeek(startOfMonth(base), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(base), { weekStartsOn: 1 }),
    });
    return (
      <div className="min-w-0 flex-1">
        <p className="mb-3 text-center font-heading text-sm font-semibold">{format(base, "MMMM yyyy")}</p>
        <div className="grid grid-cols-7 gap-1 text-center">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
            <span key={d} className="pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {d}
            </span>
          ))}
          {cells.map((d) => {
            const k = ymd(d);
            if (!isSameMonth(d, base)) return <span key={k} />;
            const t = taken?.get(k);
            const past = k < today;
            const isStart = k === start;
            const isEnd = k === end;
            const inRange = start && preview && k > start && k < preview;
            const cell = (
              <button
                key={k}
                type="button"
                onClick={() => pick(k)}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  "relative flex h-10 items-center justify-center rounded-xl text-sm tabular-nums transition-colors duration-200 ease-out motion-reduce:transition-none",
                  past && "cursor-default text-muted-foreground/40",
                  !past && t && cn("cursor-not-allowed", TAKEN_STYLE[t.kind]),
                  !past && !t && !isStart && !isEnd && !inRange && "hover:bg-primary/10",
                  inRange && "rounded-none bg-primary/10 text-foreground",
                  (isStart || isEnd || (k === preview && !end)) && "bg-primary font-semibold text-primary-foreground",
                  k === today && !isStart && !isEnd && "ring-1 ring-inset ring-foreground/20"
                )}
              >
                {format(d, "d")}
              </button>
            );
            return t && !past ? (
              <Tooltip key={k}>
                <TooltipTrigger asChild>{cell}</TooltipTrigger>
                <TooltipContent>{t.label}</TooltipContent>
              </Tooltip>
            ) : (
              cell
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl"
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            When is the {vehicleName} out?
            {days != null && <Pill tone="primary">{`${days} ${days === 1 ? "day" : "days"}`}</Pill>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Earlier months" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft />
          </Button>
          <div className={cn("flex min-w-0 flex-1 gap-6", isLoading && "opacity-50")}>
            <Month base={month} />
            <Month base={addMonths(month, 1)} />
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Later months" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight />
          </Button>
        </div>

        {/* legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          <Key className="bg-primary" label="Your dates" />
          <Key className="bg-destructive/20" label="Booked" />
          <Key className="bg-warning/30" label="Maintenance" />
          <Key className="bg-foreground/10" label="Blocked or closed" />
        </div>

        {problem && <p className="rounded-2xl bg-destructive/[0.07] px-4 py-2.5 text-xs text-destructive">{problem}</p>}

        {/* the two ends, each with its time */}
        <div className="grid grid-cols-2 gap-3">
          <End label="Pickup" day={start} time={startTime} setTime={setStartTime} active={!start || !!end} />
          <End label="Return" day={end} time={endTime} setTime={setEndTime} active={!!start && !end} />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!start || !end}
            onClick={() => {
              onApply(`${start}T${startTime}`, `${end}T${endTime}`);
              onOpenChange(false);
            }}
          >
            Use these dates
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-sm", className)} />
      {label}
    </span>
  );
}

function End({
  label,
  day,
  time,
  setTime,
  active,
}: {
  label: string;
  day: string | null;
  time: string;
  setTime: (t: string) => void;
  /** The end the next click on the calendar will set. */
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-3xl px-5 py-4 ring-1 transition-colors duration-200 ease-out motion-reduce:transition-none",
        active ? "bg-primary/[0.05] ring-primary/25" : "bg-muted/40 ring-foreground/5"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("mt-1 truncate font-heading text-lg font-semibold tracking-tight", !day && "text-base font-normal text-muted-foreground")}>
          {day ? format(fromYmd(day), "EEE d MMM yyyy") : `Pick the ${label.toLowerCase()} day`}
        </p>
      </div>
      <Select value={time} onValueChange={setTime}>
        <SelectTrigger aria-label={`${label} time`} className="h-10 shrink-0 gap-2 bg-background px-3.5 ring-1 ring-foreground/10">
          <Clock className="size-3.5 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {SLOTS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
