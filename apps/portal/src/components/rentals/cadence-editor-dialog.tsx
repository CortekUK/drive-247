"use client";

import { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import { RefreshCw, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Unit = "Daily" | "Weekly" | "Monthly";

interface CadenceEditorDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  anchorDate: Date;           // when the next renewal is due
  initialUnit: Unit;
  initialCount: number;
  rateLabel?: string;         // e.g. "$390.55 / period"
  onSave: (unit: Unit, count: number) => Promise<void> | void;
}

const PRESETS: { label: string; unit: Unit; count: number }[] = [
  { label: "Every week", unit: "Weekly", count: 1 },
  { label: "Every 2 weeks", unit: "Weekly", count: 2 },
  { label: "Every 10 days", unit: "Daily", count: 10 },
  { label: "Every month", unit: "Monthly", count: 1 },
  { label: "Every 3 months", unit: "Monthly", count: 3 },
];

const UNIT_NOUN: Record<Unit, string> = { Daily: "day", Weekly: "week", Monthly: "month" };

function cadenceLabel(unit: Unit, count: number): string {
  if (unit === "Daily" && count === 7) return "Every week";
  if (unit === "Daily" && count === 1) return "Every day";
  if (count === 1) return `Every ${UNIT_NOUN[unit]}`;
  return `Every ${count} ${UNIT_NOUN[unit]}s`;
}

function advance(d: Date, unit: Unit, count: number): Date {
  const n = new Date(d);
  if (unit === "Monthly") n.setMonth(n.getMonth() + count);
  else if (unit === "Weekly") n.setDate(n.getDate() + count * 7);
  else n.setDate(n.getDate() + count);
  return n;
}

function projected(anchor: Date, unit: Unit, count: number, n: number): Date[] {
  const out: Date[] = [];
  let d = new Date(anchor);
  for (let i = 0; i < n; i++) { out.push(new Date(d)); d = advance(d, unit, count); }
  return out;
}

const dkey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function MonthGrid({ year, month, highlights, todayKey }: { year: number; month: number; highlights: Set<string>; todayKey: string }) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex-1 min-w-[280px]">
      <div className="text-sm font-semibold text-center mb-2">{format(first, "MMMM yyyy")}</div>
      <div className="grid grid-cols-7 gap-2 mb-2 text-[10px] text-muted-foreground text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const k = `${year}-${month}-${d}`;
          const hit = highlights.has(k);
          const isToday = k === todayKey;
          return (
            <div key={i} className={cn(
              "aspect-square rounded-lg flex items-center justify-center text-sm font-medium transition-colors",
              hit ? "bg-violet-400/20 text-violet-700 dark:text-violet-200 ring-1 ring-violet-400/40" : "bg-foreground/[0.03] text-muted-foreground",
              isToday && !hit && "ring-1 ring-sky-400/50 text-foreground",
            )}>
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CadenceEditorDialog({ open, onOpenChange, anchorDate, initialUnit, initialCount, rateLabel, onSave }: CadenceEditorDialogProps) {
  const [unit, setUnit] = useState<Unit>(initialUnit);
  const [count, setCount] = useState<number>(initialCount);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setUnit(initialUnit); setCount(initialCount); } }, [open, initialUnit, initialCount]);

  const dates = useMemo(() => projected(anchorDate, unit, Math.max(1, count || 1), 12), [anchorDate, unit, count]);
  const highlights = useMemo(() => new Set(dates.map(dkey)), [dates]);
  const todayKey = dkey(new Date());

  // Render every month from the anchor month to the last projected date (cap 6).
  const months = useMemo(() => {
    const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const last = dates[dates.length - 1];
    const result: { year: number; month: number }[] = [];
    const cur = new Date(start);
    while (result.length < 6 && (cur.getFullYear() < last.getFullYear() || (cur.getFullYear() === last.getFullYear() && cur.getMonth() <= last.getMonth()))) {
      result.push({ year: cur.getFullYear(), month: cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
    return result.slice(0, 6);
  }, [anchorDate, dates]);

  const isPreset = (p: typeof PRESETS[number]) => p.unit === unit && p.count === count;

  const save = async () => {
    setSaving(true);
    try { await onSave(unit, Math.max(1, count || 1)); onOpenChange(false); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-violet-600" />Renewal cadence</DialogTitle>
          <DialogDescription>Set how often this rental auto-renews. The highlighted dates update live.</DialogDescription>
        </DialogHeader>

        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => { setUnit(p.unit); setCount(p.count); }}
              className={cn("px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                isPreset(p) ? "bg-violet-400/20 text-violet-700 dark:text-violet-200 border-violet-400/50" : "border-border hover:bg-muted")}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom interval */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3 bg-muted/20">
          <span className="text-sm text-muted-foreground pb-2">Or custom: every</span>
          <Input type="number" min={1} max={365} value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))} className="h-9 w-20" />
          <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Daily">days</SelectItem>
              <SelectItem value="Weekly">weeks</SelectItem>
              <SelectItem value="Monthly">months</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto text-sm">
            <span className="text-muted-foreground">Selected: </span>
            <span className="font-semibold text-violet-600">{cadenceLabel(unit, count)}</span>
            {rateLabel && <span className="text-muted-foreground"> · {rateLabel}</span>}
          </div>
        </div>

        {/* Upcoming dates summary */}
        <div className="text-xs text-muted-foreground">
          Next renewals: {dates.slice(0, 5).map((d) => format(d, "EEE dd MMM")).join("  ·  ")} …
        </div>

        {/* Calendar */}
        <div className="flex flex-wrap gap-6 max-h-[42vh] overflow-auto p-1">
          {months.map((m) => <MonthGrid key={`${m.year}-${m.month}`} year={m.year} month={m.month} highlights={highlights} todayKey={todayKey} />)}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-3 rounded bg-violet-400/30 ring-1 ring-violet-400/50" /> renewal date
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save cadence
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
