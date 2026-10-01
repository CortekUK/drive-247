"use client";

/**
 * New invoice — three short screens, one column, the preview last.
 *
 *   1 · BASICS    Bill for (Rental · Fine · Customer), the amount, the due date.
 *   2 · DETAILS   only what that entity needs:
 *                   Rental    search → which part (the rental / an extension)
 *                   Fine      a new fine recorded right here (there is no
 *                             separate page for fines), or one already recorded
 *                   Customer  search
 *                 …then what the amount is for: its line item(s), starting as
 *                 one line carrying the amount from screen 1 — split it into
 *                 more lines if you need to — and notes.
 *   3 · PREVIEW   the invoice as the customer will read it, with the number it
 *                 will get; Save as draft, or Issue.
 *
 * The buttons live in the header row on every screen — no band across the
 * bottom — and the dialog is only as tall as its content.
 *
 * A Rental invoice from here is for EXTRAS on a rental (cleaning, late return,
 * mileage…): the rental's own bill and its extension bills come from the
 * rental flow itself.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format } from "date-fns";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Calendar } from "@/components/ui-v2/calendar";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import type { Entity } from "./finance-data";
import { DateField } from "./date-field";
import {
  PREVIEW_CUSTOMERS,
  PREVIEW_FINES,
  PREVIEW_RENTALS,
  createInvoice,
  nextInvoiceIdentity,
  type PreviewFine,
  type PreviewRental,
} from "./finance-mock";

type Line = { type: string; description: string; amount: string };
type DuePreset = "receipt" | "7" | "14" | "30" | "date" | "none";

const TODAY = "2026-09-28";

const ENTITY_OPTIONS: { key: Entity; label: string; hint: string; short: string }[] = [
  { key: "rental", label: "Rental", hint: "Extras on a rental — cleaning, late return, mileage.", short: "Extras on a rental" },
  { key: "fine", label: "Fine", hint: "A fine passed on to the customer.", short: "A fine to pass on" },
  { key: "customer", label: "Customer", hint: "Anything else — damage, an adjustment.", short: "Damage, adjustments" },
];


/**
 * The line types each entity may use. Fine-related types (the fine itself and
 * the admin fee for handling one) belong to Fine invoices only; rental and
 * customer invoices never offer them.
 */
const LINE_TYPES_FOR: Record<Entity, string[]> = {
  rental: [
    "Rental", "Insurance", "Extras", "Delivery Fee", "Collection Fee", "Cleaning", "Late Return",
    "Excess Mileage", "Fuel", "Damage", "Service Fee", "Tax", "Adjustment",
  ],
  fine: ["Fine", "Admin Fee", "Tax", "Adjustment"],
  customer: ["Damage", "Cleaning", "Fuel", "Excess Mileage", "Service Fee", "Tax", "Adjustment"],
};

/** What the amount is for, by default, for each entity. */
const FIRST_LINE: Record<Entity, string> = { rental: "Cleaning", fine: "Fine", customer: "Damage" };
const FINE_KINDS = ["Toll violation", "Parking violation", "Speeding", "Red light", "Other"];
const EMPTY_FINE = { ref: "", kind: "Toll violation", date: TODAY, customerId: "", rental: "" };
const STEP_NAMES = ["Basics", "Details", "Preview"] as const;
/** Search shows this many matches — no scroll box; typing narrows the rest. */
const SEARCH_ROWS = 4;


export function NewInvoiceDialog({
  open,
  onOpenChange,
  currencyCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currencyCode: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const money = (n: number) => formatCurrency(n, currencyCode);

  const [screen, setScreen] = useState<1 | 2 | 3>(1);

  // 1 · Basics
  const [entity, setEntity] = useState<Entity>("rental");
  const [amount, setAmount] = useState("");
  const [duePreset, setDuePreset] = useState<DuePreset>("14");
  const [dueDate, setDueDate] = useState(format(addDays(parseLocalDate(TODAY), 14), "yyyy-MM-dd"));

  // 2 · Details
  const [query, setQuery] = useState("");
  const [rental, setRental] = useState<PreviewRental | null>(null);
  const [ext, setExt] = useState<number | undefined>(undefined);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const fineMode = "new" as "new" | "existing";
  const [pickedFine, setPickedFine] = useState<PreviewFine | null>(null);
  const [newFine, setNewFine] = useState(EMPTY_FINE);
  const [lines, setLines] = useState<Line[]>([]);
  const [issued, setIssued] = useState(TODAY);
  const [notes, setNotes] = useState("");

  const clearPick = () => {
    setQuery("");
    setRental(null);
    setExt(undefined);
    setCustomerId(null);
    setPickedFine(null);
    setNewFine(EMPTY_FINE);
  };
  const close = (v: boolean) => {
    if (!v) {
      setScreen(1);
      setEntity("rental");
      setAmount("");
      setDuePreset("14");
      clearPick();
      setLines([]);
      setIssued(TODAY);
      setNotes("");
    }
    onOpenChange(v);
  };

  const amountValue = Number(amount);

  /** Into screen 2: the amount becomes the first line, typed for the entity. */
  const toDetails = () => {
    setLines((ls) =>
      ls.length > 0
        ? ls.map((l, i) => (i === 0 ? { ...l, amount: amountValue.toFixed(2) } : l))
        : [{ type: FIRST_LINE[entity], description: entity === "fine" ? newFine.kind : "", amount: amountValue.toFixed(2) }],
    );
    setScreen(2);
  };

  // The fine in play: one recorded here, or one already recorded.
  const newFineCustomer = PREVIEW_CUSTOMERS.find((c) => c.id === newFine.customerId) ?? null;
  const fine: PreviewFine | null =
    entity !== "fine"
      ? null
      : fineMode === "existing"
        ? pickedFine
        : newFineCustomer
          ? {
              ref: newFine.ref.trim() || "No notice no.",
              kind: newFine.kind,
              amount: amountValue,
              customer: newFineCustomer,
              rental: newFine.rental || null,
              date: newFine.date,
            }
          : null;

  const customer =
    entity === "rental"
      ? rental?.customer ?? null
      : entity === "fine"
        ? fine?.customer ?? null
        : PREVIEW_CUSTOMERS.find((c) => c.id === customerId) ?? null;
  const picked = entity === "rental" ? !!rental : entity === "fine" ? !!fine : !!customerId;

  const billed = lines
    .map((l) => ({ type: l.type, description: l.description.trim(), value: Number(l.amount) }))
    .filter((l) => l.value > 0);
  const total = billed.reduce((s, l) => s + l.value, 0);
  const due =
    duePreset === "none"
      ? null
      : duePreset === "receipt"
        ? issued
        : duePreset === "date"
          ? dueDate
          : format(addDays(parseLocalDate(issued), Number(duePreset)), "yyyy-MM-dd");
  const identity = nextInvoiceIdentity({ entity, rental, ext, fine, customer });

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    const hit = (...vals: string[]) => !q || vals.some((v) => v.toLowerCase().includes(q));
    if (entity === "rental")
      return PREVIEW_RENTALS.filter((r) => hit(r.ref, r.customer.name, r.vehicle)).map((r) => ({
        key: r.ref,
        title: r.ref,
        meta: r.customer.name,
        sub: `${r.vehicle} · ${r.period}`,
        pick: () => setRental(r),
      }));
    if (entity === "fine")
      return PREVIEW_FINES.filter((f) => hit(f.ref, f.kind, f.customer.name, f.rental ?? "")).map((f) => ({
        key: f.ref,
        title: f.ref,
        meta: money(f.amount),
        sub: `${f.kind} · ${f.customer.name}${f.rental ? ` · during ${f.rental}` : ""}`,
        pick: () => {
          setPickedFine(f);
          // A recorded fine brings its own amount.
          setLines((ls) => [{ type: "Fine", description: f.kind, amount: f.amount.toFixed(2) }, ...ls.slice(1)]);
        },
      }));
    return PREVIEW_CUSTOMERS.filter((c) => hit(c.name, c.account)).map((c) => ({
      key: c.id,
      title: c.name,
      meta: c.account,
      sub: "",
      pick: () => setCustomerId(c.id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, q, open]);

  const canNext =
    (screen === 1 && amountValue > 0 && (duePreset !== "date" || !!dueDate)) ||
    (screen === 2 && picked && !!customer && billed.length > 0);

  const finish = (issue: boolean) => {
    if (!customer || billed.length === 0) return;
    createInvoice({
      entity,
      rental: entity === "rental" ? rental ?? undefined : undefined,
      ext,
      fine: fine ? { ...fine, amount: total } : undefined,
      customer,
      lines: billed.map((l) => ({ type: l.type, description: l.description || undefined, amount: l.value })),
      issued,
      due,
      notes: notes.trim() || undefined,
      issue,
    });
    toast({
      title: issue ? `${identity.number} issued` : "Draft saved",
      description: issue ? `${money(total)} to ${customer.name}.` : "It stays editable until you issue it.",
    });
    close(false);
  };

  const pickedSummary =
    entity === "rental" && rental
      ? { title: rental.ref, meta: rental.customer.name, sub: `${rental.vehicle} · ${rental.period}` }
      : entity === "fine" && fineMode === "existing" && pickedFine
        ? { title: pickedFine.ref, meta: money(pickedFine.amount), sub: `${pickedFine.kind}${pickedFine.rental ? ` · during ${pickedFine.rental}` : ""}` }
        : entity === "customer" && customer
          ? { title: customer.name, meta: customer.account, sub: "" }
          : null;
  const forLine =
    entity === "rental"
      ? rental
        ? `Rental ${identity.ref}`
        : "—"
      : entity === "fine"
        ? fine
          ? `${fine.kind} · ${fine.ref}${fine.rental ? ` (during ${fine.rental})` : ""}`
          : "—"
        : customer
          ? `Account ${customer.account}`
          : "—";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col gap-0 bg-white p-0 sm:max-w-2xl dark:bg-card"
      >
        {/* Header: title, step, and the buttons — no footer band. */}
        <div className="flex items-start justify-between gap-4 px-9 pb-5 pt-8">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold">New invoice</DialogTitle>
            <DialogDescription className="mt-0.5">
              {screen} of 3 · {STEP_NAMES[screen - 1]}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => (screen === 1 ? close(false) : setScreen((s) => (s - 1) as 1 | 2))}>
              {screen === 1 ? "Cancel" : "Back"}
            </Button>
            {screen === 1 && (
              <Button size="sm" onClick={toDetails} disabled={!canNext}>
                Next
              </Button>
            )}
            {screen === 2 && (
              <Button size="sm" onClick={() => setScreen(3)} disabled={!canNext}>
                Preview
              </Button>
            )}
            {screen === 3 && (
              <>
                <Button variant="outline" size="sm" onClick={() => finish(false)}>
                  Save as draft
                </Button>
                <Button size="sm" onClick={() => finish(true)}>
                  Issue invoice
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="px-9 pb-9">
          {/* ── 1 · Basics ─────────────────────────────────────────────── */}
          {screen === 1 && (
            <div className="space-y-7">
              <div>
                <FieldLabel>Bill for</FieldLabel>
                {/* Three squarer tiles; the chosen one in the light accent. */}
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Bill for">
                  {ENTITY_OPTIONS.map((o) => {
                    const on = entity === o.key;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          if (o.key !== entity) {
                            setEntity(o.key);
                            clearPick();
                            setLines([]);
                          }
                        }}
                        className={cn(
                          "flex min-h-[104px] flex-col items-start justify-between rounded-lg border p-4 text-left transition-colors duration-200 ease-out motion-reduce:transition-none",
                          on
                            ? "border-primary/40 bg-primary/[0.06] text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                            : "border-border text-foreground hover:border-primary/25 hover:bg-primary/[0.03]",
                        )}
                      >
                        <span className="text-sm font-semibold">{o.label}</span>
                        <span className={cn("text-xs leading-snug", on ? "text-primary/80" : "text-muted-foreground")}>
                          {o.short}
                        </span>
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
                  issued={issued}
                  preset={duePreset}
                  date={dueDate}
                  onChange={(preset, date) => {
                    setDuePreset(preset);
                    if (date) setDueDate(date);
                  }}
                />
              </div>
            </div>
          )}

          {/* ── 2 · Details ────────────────────────────────────────────── */}
          {screen === 2 && (
            <div className="space-y-7">
              <Section title={ENTITY_OPTIONS.find((o) => o.key === entity)!.label}>
                {/* A fine is always recorded right here — there is no separate
                    page for fines, and no picking one recorded elsewhere. */}

                {entity === "fine" && fineMode === "new" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Violation</FieldLabel>
                      <Dropdown
                        ariaLabel="Violation"
                        value={newFine.kind}
                        onChange={(v) => {
                          setNewFine({ ...newFine, kind: v });
                          setLines((ls) => ls.map((l, i) => (i === 0 && l.type === "Fine" ? { ...l, description: v } : l)));
                        }}
                        options={FINE_KINDS.map((k) => ({ value: k, label: k }))}
                      />
                    </div>
                    <div>
                      <FieldLabel>Notice number</FieldLabel>
                      <Input placeholder="e.g. PCN-88213" value={newFine.ref} onChange={(e) => setNewFine({ ...newFine, ref: e.target.value })} />
                    </div>
                    <div>
                      <FieldLabel>Date of violation</FieldLabel>
                      <DateField ariaLabel="Date of violation" value={newFine.date} onChange={(v) => setNewFine({ ...newFine, date: v })} />
                    </div>
                    <div>
                      <FieldLabel>Customer</FieldLabel>
                      <Dropdown
                        ariaLabel="Customer"
                        value={newFine.customerId}
                        placeholder="Choose a customer"
                        onChange={(v) => setNewFine({ ...newFine, customerId: v, rental: "" })}
                        options={PREVIEW_CUSTOMERS.map((c) => ({ value: c.id, label: c.name, hint: c.account }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <FieldLabel>During rental</FieldLabel>
                      <Dropdown
                        ariaLabel="During rental"
                        value={newFine.rental}
                        disabled={!newFine.customerId}
                        onChange={(v) => setNewFine({ ...newFine, rental: v })}
                        options={[
                          { value: "", label: "No rental" },
                          ...PREVIEW_RENTALS.filter((r) => r.customer.id === newFine.customerId).map((r) => ({
                            value: r.ref,
                            label: r.ref,
                            hint: r.vehicle,
                          })),
                        ]}
                      />
                    </div>
                  </div>
                ) : pickedSummary ? (
                  <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium tabular-nums">{pickedSummary.title}</span>
                        <span className="truncate text-sm text-muted-foreground">{pickedSummary.meta}</span>
                      </div>
                      {pickedSummary.sub && <div className="truncate text-xs text-muted-foreground">{pickedSummary.sub}</div>}
                    </div>
                    <button type="button" onClick={clearPick} className="shrink-0 text-xs font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline">
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-8"
                        autoFocus
                        placeholder={
                          entity === "rental"
                            ? "R-number, customer or plate"
                            : entity === "fine"
                              ? "Notice number, customer or rental"
                              : "Name or account number"
                        }
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <div className="mt-2 overflow-hidden rounded-lg border">
                      {results.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-muted-foreground">Nothing matches “{query}”.</p>
                      ) : (
                        <div>
                          {results.slice(0, SEARCH_ROWS).map((r) => (
                            <button
                              key={r.key}
                              type="button"
                              onClick={r.pick}
                              className="block w-full border-b px-3 py-2 text-left transition-colors duration-200 ease-out last:border-b-0 hover:bg-muted/50 motion-reduce:transition-none"
                            >
                              <span className="flex items-baseline gap-2">
                                <span className="text-sm font-medium tabular-nums">{r.title}</span>
                                <span className="truncate text-sm text-muted-foreground">{r.meta}</span>
                              </span>
                              {r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}
                            </button>
                          ))}
                          {results.length > SEARCH_ROWS && (
                            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                              {results.length - SEARCH_ROWS} more — keep typing to narrow it down.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {entity === "fine" ? (
                      null
                    ) : (
                      <button
                        type="button"
                        className="mt-2 text-xs font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline"
                        onClick={() => {
                          close(false);
                          router.push(entity === "rental" ? "/rentals/new" : "/customers");
                        }}
                      >
                        Not here? {entity === "rental" ? "Create a rental" : "Create a customer"}
                      </button>
                    )}
                  </>
                )}

                {entity === "rental" && rental && rental.extensions > 0 && (
                  <div className="mt-4">
                    <FieldLabel>Belongs to</FieldLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {[undefined, ...Array.from({ length: rental.extensions }, (_, i) => i + 1)].map((n) => (
                        <button
                          key={String(n)}
                          type="button"
                          onClick={() => setExt(n)}
                          className={cn(
                            "rounded-md border px-3 py-1.5 text-sm transition-colors duration-200 ease-out motion-reduce:transition-none",
                            ext === n ? "border-primary/40 bg-primary/5 font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50",
                          )}
                        >
                          {n ? `Extension ${n}` : "The rental"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              {/* What the amount is for */}
              <Section title="What it's for">
                {/* Plain rows — no boxes. Click a line's name to change what it is;
                    the dashed + underneath adds a line by picking its type. */}
                <div>
                  {lines.map((line, i) => (
                    <div key={i} className="group flex items-start gap-3 border-b py-3">
                      <div className="min-w-0 flex-1">
                        <LineTypeMenu
                          types={LINE_TYPES_FOR[entity]}
                          onPick={(t) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, type: t } : l)))}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {line.type}
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </LineTypeMenu>
                        <input
                          className="mt-0.5 block w-full bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground/60 focus:text-foreground focus:outline-none"
                          placeholder="Add a description"
                          value={line.description}
                          onChange={(e) =>
                            setLines((ls) => ls.map((l, j) => (j === i ? { ...l, description: e.target.value } : l)))
                          }
                        />
                      </div>
                      <input
                        className="h-8 w-28 rounded-md border border-transparent bg-transparent px-2 text-right text-sm font-medium tabular-nums transition-colors duration-200 ease-out hover:border-border focus:border-input focus:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={`${line.type} amount`}
                        autoFocus={i > 0 && !line.amount}
                        value={line.amount}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((l, j) => (j === i ? { ...l, amount: e.target.value.replace(/[^0-9.]/g, "") } : l)),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${line.type}`}
                        disabled={lines.length === 1}
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-200 ease-out hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:invisible motion-reduce:transition-none"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}

                  <LineTypeMenu
                    layout="grid"
                    types={LINE_TYPES_FOR[entity]}
                    onPick={(t) => setLines((ls) => [...ls, { type: t, description: "", amount: "" }])}
                  >
                    <button
                      type="button"
                      aria-label="Add a line"
                      className="mt-3 flex h-11 w-full items-center justify-center rounded-lg border border-dashed text-muted-foreground transition-colors duration-200 ease-out hover:border-primary/40 hover:bg-primary/[0.04] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </LineTypeMenu>

                  <div className="mt-3 flex items-baseline justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold tabular-nums">{money(total)}</span>
                  </div>
                </div>
              </Section>

              <Section title="More">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Issue date</FieldLabel>
                    <DateField ariaLabel="Issue date" value={issued} onChange={setIssued} />
                  </div>
                </div>
                <div className="mt-3">
                  <FieldLabel>Notes</FieldLabel>
                  <Textarea rows={2} placeholder="Shown on the invoice" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </Section>
            </div>
          )}

          {/* ── 3 · Preview ────────────────────────────────────────────── */}
          {screen === 3 && (
            <article className="rounded-xl border bg-white p-7 text-sm text-neutral-800 dark:bg-card dark:text-foreground">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="text-base font-semibold text-neutral-900 dark:text-foreground">
                    {tenant?.company_name ?? "Your business"}
                  </div>
                  <div className="text-xs text-muted-foreground">{(tenant as { contact_email?: string } | null)?.contact_email}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Invoice</div>
                  <div className="mt-0.5 font-medium tabular-nums">{identity.number}</div>
                </div>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4">
                <PreviewField label="Bill to" value={customer?.name ?? "—"} sub={customer?.account} />
                <PreviewField label="Issued" value={format(parseLocalDate(issued), "MMM d, yyyy")} />
                <PreviewField label="For" value={forLine} />
                <PreviewField label="Due" value={due ? format(parseLocalDate(due), "MMM d, yyyy") : "No due date"} />
              </div>

              <div className="mt-7">
                <div className="flex justify-between border-b pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Description</span>
                  <span>Amount</span>
                </div>
                {billed.map((l, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-4 border-b py-2.5">
                    <div className="min-w-0">
                      <div>{l.type}</div>
                      {l.description && <div className="truncate text-xs text-muted-foreground">{l.description}</div>}
                    </div>
                    <span className="shrink-0 tabular-nums">{money(l.value)}</span>
                  </div>
                ))}
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between text-muted-foreground">
                  <span>Amount due</span>
                  <span className="tabular-nums">{money(total)}</span>
                </div>
              </div>

              {notes.trim() && (
                <div className="mt-7 border-t pt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{notes}</p>
                </div>
              )}
            </article>
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

/** A labelled fact in the preview. */
function PreviewField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/**
 * The app's dropdown (ui-v2 Select) in place of the browser's native menu.
 * Radix refuses an empty value, so "" (e.g. "No rental") travels as NONE.
 */
const NONE = "__none__";
function Dropdown({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; hint?: string }[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <Select
      value={value === "" ? (options.some((o) => o.value === "") ? NONE : undefined) : value}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-full" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* The light panel: white, hairline border, light-purple highlight —
          it sits on a white dialog, where the default dark panel reads as an
          OS menu. */}
      <SelectContent tone="surface">
        {options.map((o) => (
          <SelectItem key={o.value || NONE} value={o.value || NONE}>
            {o.label}
            {o.hint && <span className="ml-1.5 text-muted-foreground">{o.hint}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Due date: presets on top, a calendar underneath. A preset jumps the calendar
 * to its day and marks it ("In 7 days" → Oct 5 is circled), so the operator
 * sees exactly where it lands; picking a day on the calendar sets that date.
 * "No due date" clears the calendar.
 */
const DUE_PRESETS: [Exclude<DuePreset, "date">, string, number | null][] = [
  ["receipt", "On receipt", 0],
  ["7", "7 days", 7],
  ["14", "14 days", 14],
  ["30", "30 days", 30],
  ["none", "No due date", null],
];

function DueDatePicker({
  issued,
  preset,
  date,
  onChange,
}: {
  issued: string;
  preset: DuePreset;
  date: string;
  onChange: (preset: DuePreset, date?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const base = parseLocalDate(issued);
  const presetDays = DUE_PRESETS.find(([k]) => k === preset)?.[2];
  const selected: Date | undefined =
    preset === "none"
      ? undefined
      : preset === "date"
        ? parseLocalDate(date)
        : addDays(base, presetDays ?? 0);
  const [month, setMonth] = useState<Date>(selected ?? base);

  const label =
    preset === "none"
      ? "No due date"
      : `${format(selected!, "EEE, MMM d, yyyy")}${
          preset === "receipt" ? " · on receipt" : preset === "date" ? "" : ` · in ${presetDays} days`
        }`;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setMonth(selected ?? base);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm transition-colors duration-200 ease-out hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <span className={cn(preset === "none" && "text-muted-foreground")}>{label}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto flex-row gap-0 overflow-hidden rounded-xl bg-white p-0 dark:bg-card">
        {/* Presets down the left — each shows the day it lands on and moves the
            calendar there — and the calendar on the right, so the panel is
            exactly as wide as the two together. */}
        <div className="flex w-44 flex-col gap-1 border-r p-2">
          {DUE_PRESETS.map(([key, text, days]) => {
            const on = preset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  const d = days === null ? undefined : addDays(base, days);
                  onChange(key, d ? format(d, "yyyy-MM-dd") : undefined);
                  if (d) setMonth(d);
                }}
                className={cn(
                  "flex items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-200 ease-out motion-reduce:transition-none",
                  on ? "bg-primary/[0.08] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-foreground hover:bg-muted/60",
                )}
              >
                <span>{text}</span>
                {days !== null && (
                  <span className={cn("text-xs tabular-nums", on ? "text-primary/70" : "text-muted-foreground")}>
                    {format(addDays(base, days), "MMM d")}
                  </span>
                )}
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
            // A calendar pick that matches a preset reads as that preset.
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

/**
 * The line types, in a light panel: pick one to add or change a line.
 *
 *   grid  under the dashed + : drops BELOW it, exactly its width, squarer
 *         corners, the types in three columns so it stays short enough to fit.
 *   list  under a line's name : a narrow single column.
 */
function LineTypeMenu({
  types,
  onPick,
  layout = "list",
  children,
}: {
  /** The types this invoice's entity may use (LINE_TYPES_FOR). */
  types: string[];
  onPick: (type: string) => void;
  layout?: "grid" | "list";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const grid = layout === "grid";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        avoidCollisions={!grid}
        // No ring round the first type the moment it opens.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "gap-0 rounded-lg border bg-white p-1.5 shadow-sm dark:bg-card",
          grid ? "w-[var(--radix-popover-trigger-width)]" : "w-52",
        )}
      >
        <div className={cn(grid && "grid grid-cols-3 gap-0.5")}>
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onPick(t);
                setOpen(false);
              }}
              className="block w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-200 ease-out hover:bg-primary/[0.08] hover:text-primary focus-visible:bg-primary/[0.08] focus-visible:outline-none motion-reduce:transition-none"
            >
              {t}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
