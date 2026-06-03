"use client";

import { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import { RefreshCw, Loader2, CalendarCheck, SkipForward, MoveRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Unit = "Daily" | "Weekly" | "Monthly";
export interface ScheduleExceptions { skips: string[]; moves: Record<string, string>; }

interface CadenceEditorDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  anchorDate: Date;
  initialUnit: Unit;
  initialCount: number;
  initialExceptions?: ScheduleExceptions;
  rateLabel?: string;
  onSave: (data: { unit: Unit; count: number; anchorYmd: string; exceptions: ScheduleExceptions }) => Promise<void> | void;
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
const dkey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const keyToDate = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };

// Generate the renewal series applying skips (advance past) and moves (relocate one occurrence).
function project(anchor: Date, unit: Unit, count: number, skips: string[], moves: Record<string, string>, n: number) {
  const out: { displayKey: string; originalKey: string }[] = [];
  let d = new Date(anchor); let guard = 0;
  while (out.length < n && guard < 2000) {
    guard++;
    const orig = dkey(d);
    if (skips.includes(orig)) { d = advance(d, unit, count); continue; }
    out.push({ displayKey: moves[orig] || orig, originalKey: orig });
    d = advance(d, unit, count);
  }
  return out;
}

function MonthGrid({ year, month, active, skipped, movedFrom, nextKey, todayKey, onPick }: {
  year: number; month: number; active: Set<string>; skipped: Set<string>; movedFrom: Set<string>;
  nextKey: string; todayKey: string; onPick: (k: string) => void;
}) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
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
          const k = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isActive = active.has(k);
          const isSkipped = skipped.has(k);
          const isMovedFrom = movedFrom.has(k);
          const isNext = k === nextKey;
          const isToday = k === todayKey;
          return (
            <button key={i} type="button" onClick={() => onPick(k)} className={cn(
              "aspect-square rounded-lg flex items-center justify-center text-sm font-medium transition-colors",
              isActive ? "bg-violet-400/20 text-violet-700 dark:text-violet-200" : "bg-foreground/[0.03] text-muted-foreground hover:bg-foreground/[0.07]",
              isNext && "ring-2 ring-violet-500/60",
              isActive && !isNext && "ring-1 ring-violet-400/40",
              (isSkipped || isMovedFrom) && "line-through text-muted-foreground/50 bg-transparent",
              isToday && !isActive && "ring-1 ring-sky-400/50 text-foreground",
            )}>
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CadenceEditorDialog({ open, onOpenChange, anchorDate, initialUnit, initialCount, initialExceptions, rateLabel, onSave }: CadenceEditorDialogProps) {
  const [unit, setUnit] = useState<Unit>(initialUnit);
  const [count, setCount] = useState<number>(initialCount);
  const [anchor, setAnchor] = useState<Date>(anchorDate);
  const [skips, setSkips] = useState<string[]>(initialExceptions?.skips ?? []);
  const [moves, setMoves] = useState<Record<string, string>>(initialExceptions?.moves ?? {});
  const [selected, setSelected] = useState<string | null>(null);
  const [movingFrom, setMovingFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setUnit(initialUnit); setCount(initialCount); setAnchor(anchorDate);
      setSkips(initialExceptions?.skips ?? []); setMoves(initialExceptions?.moves ?? {});
      setSelected(null); setMovingFrom(null);
    }
  }, [open, initialUnit, initialCount, anchorDate, initialExceptions]);

  const series = useMemo(() => project(anchor, unit, Math.max(1, count || 1), skips, moves, 12), [anchor, unit, count, skips, moves]);
  const active = useMemo(() => new Set(series.map((s) => s.displayKey)), [series]);
  const displayToOriginal = useMemo(() => new Map(series.map((s) => [s.displayKey, s.originalKey])), [series]);
  const movedFromSet = useMemo(() => new Set(Object.keys(moves)), [moves]);
  const skipSet = useMemo(() => new Set(skips), [skips]);
  const nextKey = series[0]?.displayKey ?? dkey(anchor);
  const todayKey = dkey(new Date());

  const months = useMemo(() => {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const lastKey = series[series.length - 1]?.displayKey ?? dkey(anchor);
    const last = keyToDate(lastKey);
    const res: { year: number; month: number }[] = [];
    const cur = new Date(start);
    while (res.length < 6 && (cur.getFullYear() < last.getFullYear() || (cur.getFullYear() === last.getFullYear() && cur.getMonth() <= last.getMonth()))) {
      res.push({ year: cur.getFullYear(), month: cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
    return res;
  }, [anchor, series]);

  const onPick = (k: string) => {
    if (movingFrom) {
      // record the move: original grid date -> picked date
      setMoves((m) => ({ ...m, [movingFrom]: k }));
      setMovingFrom(null); setSelected(null);
      return;
    }
    setSelected(k);
  };

  const setAsNext = (k: string) => { setAnchor(keyToDate(k)); setSelected(null); };
  const skipDate = (origKey: string) => {
    setMoves((m) => { const c = { ...m }; delete c[origKey]; return c; });
    setSkips((s) => (s.includes(origKey) ? s : [...s, origKey]));
    setSelected(null);
  };
  const clearException = (origKey: string) => {
    setSkips((s) => s.filter((x) => x !== origKey));
    setMoves((m) => { const c = { ...m }; delete c[origKey]; return c; });
    setSelected(null);
  };

  const isPreset = (p: typeof PRESETS[number]) => p.unit === unit && p.count === count;

  const save = async () => {
    setSaving(true);
    try { await onSave({ unit, count: Math.max(1, count || 1), anchorYmd: dkey(anchor), exceptions: { skips, moves } }); onOpenChange(false); }
    finally { setSaving(false); }
  };

  // Context-aware action bar content for the selected/moving state.
  const selectedIsActive = selected != null && active.has(selected);
  const selectedOriginal = selected != null ? (displayToOriginal.get(selected) ?? selected) : null;
  const selectedHasException = selected != null && (skipSet.has(selected) || movedFromSet.has(selected));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-violet-600" />Renewal schedule</DialogTitle>
          <DialogDescription>Set the cadence, move the next renewal, or skip/move individual dates. Highlighted dates update live.</DialogDescription>
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
          <Input type="number" min={1} max={365} value={count} onChange={(e) => setCount(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))} className="h-9 w-20" />
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
            <span className="font-semibold text-violet-600 dark:text-violet-300">{cadenceLabel(unit, count)}</span>
            {rateLabel && <span className="text-muted-foreground"> · {rateLabel}</span>}
          </div>
        </div>

        {/* Action bar */}
        <div className="rounded-lg border p-3 bg-violet-500/[0.04] min-h-[52px] flex items-center">
          {movingFrom ? (
            <div className="flex items-center gap-3 text-sm">
              <MoveRight className="h-4 w-4 text-violet-600" />
              <span>Click a date to move the <strong>{format(keyToDate(movingFrom), "dd MMM")}</strong> renewal to it.</span>
              <Button variant="ghost" size="sm" onClick={() => setMovingFrom(null)} className="gap-1"><X className="h-3.5 w-3.5" />Cancel</Button>
            </div>
          ) : selected == null ? (
            <span className="text-sm text-muted-foreground">Tip: click a <span className="text-violet-600 dark:text-violet-300 font-medium">highlighted</span> date to skip/move it, or any other date to make it the next renewal.</span>
          ) : selectedHasException ? (
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <span><strong>{format(keyToDate(selected), "EEE dd MMM")}</strong> — {skipSet.has(selected) ? "skipped" : "moved"}.</span>
              <Button variant="outline" size="sm" onClick={() => clearException(selected)}>Undo</Button>
            </div>
          ) : selectedIsActive ? (
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span><strong>{format(keyToDate(selected), "EEE dd MMM")}</strong> renewal:</span>
              <Button variant="outline" size="sm" onClick={() => skipDate(selectedOriginal!)} className="gap-1"><SkipForward className="h-3.5 w-3.5" />Skip this</Button>
              <Button variant="outline" size="sm" onClick={() => { setMovingFrom(selectedOriginal); setSelected(null); }} className="gap-1"><MoveRight className="h-3.5 w-3.5" />Move…</Button>
              <Button variant="outline" size="sm" onClick={() => setAsNext(selected)} className="gap-1"><CalendarCheck className="h-3.5 w-3.5" />Make next renewal</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span><strong>{format(keyToDate(selected), "EEE dd MMM")}</strong>:</span>
              <Button variant="outline" size="sm" onClick={() => setAsNext(selected)} className="gap-1"><CalendarCheck className="h-3.5 w-3.5" />Set as next renewal</Button>
            </div>
          )}
        </div>

        {/* Calendar */}
        <div className="flex flex-wrap gap-6 max-h-[40vh] overflow-auto p-1">
          {months.map((m) => (
            <MonthGrid key={`${m.year}-${m.month}`} year={m.year} month={m.month}
              active={active} skipped={skipSet} movedFrom={movedFromSet} nextKey={nextKey} todayKey={todayKey} onPick={onPick} />
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="inline-flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-violet-400/30 ring-1 ring-violet-400/50" /> renewal</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded ring-1 ring-sky-400/50" /> today</span>
            <span className="inline-flex items-center gap-1"><span className="line-through">skip/moved</span></span>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save schedule
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
