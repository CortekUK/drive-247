"use client";

/**
 * Add a charge — the Payments stage's own, in the Finances "New invoice"
 * grammar: two short screens, one column, the buttons in the header row and no
 * footer band, the dialog only as tall as its content.
 *
 *   1 · BASICS    what it is for (Fine · Damage · Cleaning · Other), the
 *                 amount, the due date.
 *   2 · DETAILS   a fine's notice — violation, notice number, the day it
 *                 happened — or, for anything else, what happened. Then notes,
 *                 and one line saying exactly what will be added.
 *
 * The customer, rental and car are this rental's: there is nothing to pick.
 *
 * What it writes — the same rows v1's AddFineDialog writes, nothing new:
 *   Fine      a `fines` row, then its `ledger_entries` Charge (category Fine,
 *             reference FINE-<id>) so the balance carries it.
 *   the rest  one `ledger_entries` Charge, category **Other**. Damage and
 *             Cleaning are not allocator categories (see UNSETTLEABLE in
 *             payments-model): a charge filed under them could never be paid.
 *             So they are filed as Other and named in `reference`, which the
 *             charge row shows as its note.
 */

import { useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronDown, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Calendar } from "@/components/ui-v2/calendar";
import { DateField } from "@/components/finances-v2/date-field";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { parseLocalDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

type Kind = "fine" | "damage" | "cleaning" | "other";
type DuePreset = "receipt" | "7" | "14" | "30" | "date";

const KINDS: { key: Kind; label: string; short: string }[] = [
  { key: "fine", label: "Fine", short: "A toll or ticket to pass on" },
  { key: "damage", label: "Damage", short: "Repairs the renter owes" },
  { key: "cleaning", label: "Cleaning", short: "Cleaning, fuel, smoking" },
  { key: "other", label: "Other", short: "Late return, anything else" },
];

/** `fines.type` values v1 already uses. */
const VIOLATIONS = ["Parking Citation", "Toll", "Speeding", "Red Light", "Other"];
const STEP_NAMES = ["Basics", "Details"] as const;

const todayIso = () => format(new Date(), "yyyy-MM-dd");

export function AddChargeDialogV2({
  open,
  onOpenChange,
  rental,
  rentalRef,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: Record<string, any>;
  /** "R-4f3bbe", for the confirmation line. */
  rentalRef: string;
  onAdded: () => void;
}) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: tenant?.currency_code || "USD" });

  const [screen, setScreen] = useState<1 | 2>(1);
  const [kind, setKind] = useState<Kind>("fine");
  const [amount, setAmount] = useState("");
  const [preset, setPreset] = useState<DuePreset>("14");
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 14), "yyyy-MM-dd"));
  const [violation, setViolation] = useState(VIOLATIONS[0]);
  const [notice, setNotice] = useState("");
  const [happened, setHappened] = useState(todayIso());
  const [what, setWhat] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const close = (v: boolean) => {
    if (!v) {
      setScreen(1);
      setKind("fine");
      setAmount("");
      setPreset("14");
      setNotice("");
      setWhat("");
      setNotes("");
      setHappened(todayIso());
    }
    onOpenChange(v);
  };

  const value = Number(amount);
  const due =
    preset === "date" ? dueDate : format(addDays(new Date(), preset === "receipt" ? 0 : Number(preset)), "yyyy-MM-dd");
  const label = kind === "fine" ? violation : KINDS.find((k) => k.key === kind)!.label;
  const canNext = value > 0;
  const canSave = canNext && (kind === "fine" || what.trim().length > 0);

  const save = async () => {
    if (!tenant?.id) return;
    setSaving(true);
    try {
      const base = {
        tenant_id: tenant.id,
        customer_id: rental.customer_id,
        vehicle_id: rental.vehicle_id,
        rental_id: rental.id,
      };
      if (kind === "fine") {
        const { data: fine, error } = await supabase
          .from("fines")
          .insert({
            ...base,
            type: violation,
            reference_no: notice.trim() || null,
            issue_date: happened,
            due_date: due,
            amount: value,
            notes: notes.trim() || null,
            status: "Open",
          })
          .select("id")
          .single();
        if (error) throw error;
        const { error: le } = await supabase.from("ledger_entries").insert({
          ...base,
          entry_date: todayIso(),
          due_date: due,
          type: "Charge",
          category: "Fine",
          amount: value,
          remaining_amount: value,
          reference: `FINE-${fine.id}`,
        });
        if (le) throw le;
      } else {
        const name = KINDS.find((k) => k.key === kind)!.label;
        const reference = [kind === "other" ? null : name, what.trim() || null, notes.trim() || null]
          .filter(Boolean)
          .join(" · ");
        const { error } = await supabase.from("ledger_entries").insert({
          ...base,
          entry_date: todayIso(),
          due_date: due,
          type: "Charge",
          category: "Other",
          amount: value,
          remaining_amount: value,
          reference: reference || name,
        });
        if (error) throw error;
      }
      toast({ title: `${label} added`, description: `${usd(value)} is now owed on ${rentalRef}.` });
      void qc.invalidateQueries({ queryKey: ["rental-payments-ledger-v2"] });
      onAdded();
      close(false);
    } catch (e: any) {
      toast({ title: "I couldn't add that charge", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={false} className="flex flex-col gap-0 bg-white p-0 sm:max-w-2xl dark:bg-card">
        {/* Header: title, step, and the buttons — no footer band. */}
        <div className="flex items-start justify-between gap-4 px-9 pb-5 pt-8">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold">Add a charge</DialogTitle>
            <DialogDescription className="mt-0.5">
              {screen} of 2 · {STEP_NAMES[screen - 1]}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => (screen === 1 ? close(false) : setScreen(1))}>
              {screen === 1 ? "Cancel" : "Back"}
            </Button>
            {screen === 1 ? (
              <Button size="sm" onClick={() => setScreen(2)} disabled={!canNext}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={save} disabled={!canSave || saving}>
                {saving && <Loader2 className="animate-spin" />}
                Add charge
              </Button>
            )}
          </div>
        </div>

        <div className="px-9 pb-9">
          {/* ── 1 · Basics ─────────────────────────────────────────────── */}
          {screen === 1 && (
            <div className="space-y-7">
              <div>
                <FieldLabel>What is it for</FieldLabel>
                <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="What is it for">
                  {KINDS.map((o) => {
                    const on = kind === o.key;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setKind(o.key)}
                        className={cn(
                          "flex min-h-[96px] flex-col items-start justify-between rounded-lg border p-4 text-left transition-colors duration-200 ease-out motion-reduce:transition-none",
                          on
                            ? "border-primary/40 bg-primary/[0.06] text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                            : "border-border text-foreground hover:border-primary/25 hover:bg-primary/[0.03]"
                        )}
                      >
                        <span className="text-sm font-semibold">{o.label}</span>
                        <span className={cn("text-xs leading-snug", on ? "text-primary/80" : "text-muted-foreground")}>{o.short}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <FieldLabel>Amount</FieldLabel>
                <Input
                  className="h-12 text-2xl font-semibold tabular-nums"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>

              <div>
                <FieldLabel>Due date</FieldLabel>
                <DueDatePicker
                  preset={preset}
                  date={dueDate}
                  onChange={(p, d) => {
                    setPreset(p);
                    if (d) setDueDate(d);
                  }}
                />
              </div>
            </div>
          )}

          {/* ── 2 · Details ────────────────────────────────────────────── */}
          {screen === 2 && (
            <div className="space-y-7">
              <Section title={kind === "fine" ? "The notice" : KINDS.find((k) => k.key === kind)!.label}>
                {kind === "fine" ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <FieldLabel>Violation</FieldLabel>
                      <Select value={violation} onValueChange={setViolation}>
                        <SelectTrigger className="h-9 w-full" aria-label="Violation">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent tone="surface">
                          {VIOLATIONS.map((v) => (
                            <SelectItem key={v} value={v}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <FieldLabel>Notice number</FieldLabel>
                      <Input placeholder="e.g. PCN-88213" value={notice} onChange={(e) => setNotice(e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>Date of violation</FieldLabel>
                      <DateField ariaLabel="Date of violation" value={happened} onChange={setHappened} />
                    </div>
                  </div>
                ) : (
                  <div>
                    <FieldLabel>What happened</FieldLabel>
                    <Input
                      autoFocus
                      placeholder={
                        kind === "damage"
                          ? "e.g. Scratch on the rear bumper"
                          : kind === "cleaning"
                            ? "e.g. Returned with pet hair"
                            : "e.g. Returned 3 hours late"
                      }
                      value={what}
                      onChange={(e) => setWhat(e.target.value)}
                    />
                  </div>
                )}
              </Section>

              <div>
                <FieldLabel>Notes</FieldLabel>
                <Textarea rows={3} placeholder="Only your team sees this." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {/* Exactly what will be added — the preview, in one line. */}
              <div className="flex items-baseline justify-between gap-4 rounded-lg border px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  Adds <span className="font-medium text-foreground">{label}</span> to {rentalRef}, due{" "}
                  {format(parseLocalDate(due), "MMM d, yyyy")}
                </span>
                <span className="text-lg font-semibold tabular-nums">{usd(value)}</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-sm font-medium">{children}</div>;
}

/** Due date, as Finances: presets down the left, a calendar on the right. */
const DUE_PRESETS: [Exclude<DuePreset, "date">, string, number][] = [
  ["receipt", "On receipt", 0],
  ["7", "7 days", 7],
  ["14", "14 days", 14],
  ["30", "30 days", 30],
];

function DueDatePicker({
  preset,
  date,
  onChange,
}: {
  preset: DuePreset;
  date: string;
  onChange: (preset: DuePreset, date?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const base = parseLocalDate(todayIso());
  const presetDays = DUE_PRESETS.find(([k]) => k === preset)?.[2];
  const selected = preset === "date" ? parseLocalDate(date) : addDays(base, presetDays ?? 0);
  const [month, setMonth] = useState<Date>(selected);
  const label = `${format(selected, "EEE, MMM d, yyyy")}${
    preset === "receipt" ? " · on receipt" : preset === "date" ? "" : ` · in ${presetDays} days`
  }`;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setMonth(selected);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm transition-colors duration-200 ease-out hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <span>{label}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto flex-row gap-0 overflow-hidden rounded-xl bg-white p-0 dark:bg-card">
        <div className="flex w-44 flex-col gap-1 border-r p-2">
          {DUE_PRESETS.map(([key, text, days]) => {
            const on = preset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  const d = addDays(base, days);
                  onChange(key, format(d, "yyyy-MM-dd"));
                  setMonth(d);
                }}
                className={cn(
                  "flex items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-200 ease-out motion-reduce:transition-none",
                  on ? "bg-primary/[0.08] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-foreground hover:bg-muted/60"
                )}
              >
                <span>{text}</span>
                <span className={cn("text-xs tabular-nums", on ? "text-primary/70" : "text-muted-foreground")}>
                  {format(addDays(base, days), "MMM d")}
                </span>
              </button>
            );
          })}
        </div>
        <Calendar
          mode="single"
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          disabled={{ before: base }}
          onSelect={(d) => {
            if (!d) return;
            const diff = Math.round((d.getTime() - base.getTime()) / 86_400_000);
            const match = DUE_PRESETS.find(([, , days]) => days === diff);
            onChange(match ? match[0] : "date", format(d, "yyyy-MM-dd"));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
