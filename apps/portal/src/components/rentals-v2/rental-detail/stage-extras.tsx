"use client";

/**
 * The Extras stage of the rental control centre — real data, real actions.
 *
 * Everything that rides along on top of the hire itself. Two things qualify on a
 * rental that already exists, and v1's detail page is the arbiter of which:
 *
 *   add-ons            `rental_extras_selections` — the child seat, the toll
 *                      pass, the prepaid fuel; a tenant-authored catalogue, not
 *                      a fixed list
 *   additional drivers `rental_additional_drivers` — a second name on the
 *                      agreement and on the insurance, each with their own ID
 *                      check and their own signature
 *
 * Deliberately NOT here, because each is another stage's whole answer: the
 * insurance policy (Insurance), the security deposit and the discount
 * (Payments), the agreement the extras get written into (Agreement). The
 * prototype's Extras tab also carried the daily rate, the deposit and an
 * internal-notes box — the first two are Payments' and the third does not exist
 * (there is no notes column on `rentals`).
 *
 * ── the two axes that make extras awkward, and are real ────────────────────
 *
 *   billing_type   per_trip | per_day    how OFTEN it is charged
 *   max_quantity   null | n              null means a toggle, not a count
 *
 * A toll pass is one flat charge you either have or you don't; a child seat is
 * $12 a day and you can have three. Both are stored per SELECTION as
 * `price_at_booking` and `billing_type_at_booking` — snapshots, so re-pricing
 * the catalogue later cannot rewrite what a signed rental was charged. This
 * screen reads the snapshot, never the live catalogue.
 *
 * ── layout (Oct 2026, island UI — the Customer stage's grammar) ─────────────
 *
 * Full width, no scroll: Add-ons and Additional drivers as two full-width cards
 * sharing the pane's height; a long list scrolls inside its own card. The one
 * action sits on the description line, where every stage keeps it.
 *
 * ── editing, in place (Oct 2026) ─────────────────────────────────────────
 *
 * While the rental has not moved past its first four stages, both cards are
 * edited right here. Add-ons: the tenant's catalogue with a stepper per extra
 * (a toggle when max_quantity is 1); saving goes through
 * `update_rental_extras_v2`, which prices from the catalogue server-side and
 * re-raises the Extras charge in one transaction. Second drivers: added through
 * v1's `create-additional-drivers` (+ their ID link), removed tenant-scoped.
 * Once locked, both read as they were booked.
 *
 * ── why it used to be read-only ────────────────────────────────────────────
 *
 * `rental_extras_selections` has exactly two writers in the whole portal —
 * `rentals/new` and `rental-create-v2` — and both write once, at creation. There
 * is no path that adds an extra to a rental that already exists, because adding
 * one is not an insert: it is money owed, so it needs a ledger charge and a
 * re-issued agreement alongside. v1 shows the same list read-only, in a dialog.
 * So the button here says that plainly rather than doing nothing.
 */

import { useEffect, useMemo, useState } from "react";
import { differenceInDays } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  FileSignature,
  Loader2,
  Lock,
  Mail,
  Minus,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UserX,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import {
  useRentalAdditionalDrivers,
  type RentalAdditionalDriver,
} from "@/hooks/use-rental-additional-drivers";
import { Button } from "@/components/ui-v2/button";
import type { StageProps } from "./stages";
import { insetCls, listCls, Panel, Pill, StageAction, Surface } from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Add-ons
   ══════════════════════════════════════════════════════════════════════════ */

type ExtraSelection = {
  id: string;
  quantity: number;
  price_at_booking: number;
  billing_type_at_booking: "per_trip" | "per_day" | null;
  extra_id: string | null;
  rental_extras: { name: string | null; description: string | null; image_urls: string[] | null } | null;
};

/**
 * The extras on THIS rental, as v1 reads them
 * (`rentals/[id]/page.tsx:1352`) — same table, same join, same
 * `.eq("rental_id", …)` and nothing else.
 *
 * There is deliberately no tenant filter, and it is not an oversight:
 * `rental_extras_selections` carries no `tenant_id` column. The rental id is the
 * scope, and the screen only ever holds a rental id it has already read under a
 * tenant-scoped query — see `use-rental-detail-v2`, which will not return
 * another tenant's rental at all.
 */
function useRentalExtraSelections(rentalId: string | null) {
  return useQuery({
    queryKey: ["rental-extra-selections-v2", rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_extras_selections")
        .select(
          "id, quantity, price_at_booking, billing_type_at_booking, extra_id, rental_extras(name, description, image_urls)"
        )
        .eq("rental_id", rentalId!);

      if (error) throw error;
      return (data ?? []) as unknown as ExtraSelection[];
    },
    enabled: !!rentalId,
  });
}

/** What one line comes to across the whole hire. Mirrors v1's reducer exactly. */
const lineTotal = (s: ExtraSelection, days: number) =>
  s.quantity * Number(s.price_at_booking) * (s.billing_type_at_booking === "per_day" ? days : 1);

/* ══════════════════════════════════════════════════════════════════════════
   Additional drivers
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The two statuses a second driver carries, and they are genuinely independent:
 * a driver can be identity-verified and still not have signed, or have signed
 * and never been checked. Showing one chip for both would hide whichever is
 * behind.
 *
 * A rejected check is `destructive` — it is a real fault, not drift. `sent` and
 * `pending` are primary, not amber: on this screen amber means "out of date" and
 * nothing else, and a driver who has simply not got round to it yet is not that.
 */
function verifyPill(status: RentalAdditionalDriver["verification_status"]) {
  switch (status) {
    case "verified":
      return (
        <Pill tone="success">
          <ShieldCheck />
          ID verified
        </Pill>
      );
    case "pending":
      return (
        <Pill tone="primary">
          <Clock />
          ID in review
        </Pill>
      );
    case "rejected":
      return (
        <Pill tone="warning">
          <UserX />
          ID rejected
        </Pill>
      );
    default:
      return <Pill tone="neutral">ID not started</Pill>;
  }
}

function signPill(status: RentalAdditionalDriver["signing_status"]) {
  switch (status) {
    case "signed":
      return (
        <Pill tone="success">
          <CheckCircle2 />
          Signed
        </Pill>
      );
    case "sent":
      return (
        <Pill tone="primary">
          <Mail />
          Awaiting signature
        </Pill>
      );
    case "declined":
      return (
        <Pill tone="warning">
          <XCircle />
          Declined
        </Pill>
      );
    default:
      return (
        <Pill tone="neutral">
          <FileSignature />
          Not sent
        </Pill>
      );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   The stage
   ══════════════════════════════════════════════════════════════════════════ */

/** The tenant's own extras catalogue — what can be put on a rental. */
type CatalogueExtra = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  billing_type: "per_trip" | "per_day" | null;
  max_quantity: number | null;
  image_urls: string[] | null;
};

function useExtrasCatalogue() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["rental-extras-catalogue-v2", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_extras")
        .select("id, name, description, price, billing_type, max_quantity, image_urls")
        .eq("tenant_id", tenant!.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CatalogueExtra[];
    },
    enabled: !!tenant?.id,
  });
}

/** May this rental's extras still change? The database's answer, never a guess. */
function useExtrasEditable(rentalId: string) {
  return useQuery({
    queryKey: ["rental-extras-editable-v2", rentalId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("update_rental_extras_v2", {
        p_rental_id: rentalId,
        p_selections: [],
        p_dry_run: true,
      });
      if (error) throw error;
      return data as { ok: boolean; reason?: string };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

export function StageExtras({ detail }: StageProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currency = tenant?.currency_code || "USD";

  const rental = detail.rental;
  const { data: selections, isLoading: extrasLoading } = useRentalExtraSelections(rental.id);
  const { data: drivers, isLoading: driversLoading } = useRentalAdditionalDrivers(rental.id);
  const { data: catalogue } = useExtrasCatalogue();
  const editable = useExtrasEditable(rental.id);
  const canEdit = editable.data?.ok === true;

  const [resending, setResending] = useState<string | null>(null);

  /** The day count per_day extras multiply by — the charge's own rule. */
  const days = rental.end_date
    ? Math.max(1, differenceInDays(parseLocalDate(rental.end_date), parseLocalDate(rental.start_date)))
    : 1;

  const extras = selections ?? [];
  const extrasTotal = extras.reduce((sum, s) => sum + lineTotal(s, days), 0);

  /* ── the add-ons draft: extra_id → quantity ──────────────────────────── */
  const saved = useMemo(() => {
    const m: Record<string, number> = {};
    (selections ?? []).forEach((s) => s.extra_id && (m[s.extra_id] = (m[s.extra_id] ?? 0) + s.quantity));
    return m;
    // Keyed on the query's own data, which is stable between renders — `extras`
    // is a fresh [] each render while loading and would reset the draft forever.
  }, [selections]);
  const [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(normalise(draft)) !== JSON.stringify(normalise(saved));
  const draftTotal = (catalogue ?? []).reduce(
    (sum, e) => sum + (draft[e.id] ?? 0) * Number(e.price) * (e.billing_type === "per_day" ? days : 1),
    0
  );
  const setQty = (e: CatalogueExtra, q: number) =>
    setDraft((d) => ({ ...d, [e.id]: Math.max(0, e.max_quantity != null ? Math.min(q, e.max_quantity) : q) }));

  const saveExtras = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("update_rental_extras_v2", {
        p_rental_id: rental.id,
        p_selections: Object.entries(draft)
          .filter(([, q]) => q > 0)
          .map(([extra_id, quantity]) => ({ extra_id, quantity })),
        p_dry_run: false,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason ?? "Nothing was saved.");
      return data as { extras_total: number };
    },
    onSuccess: (data) => {
      toast({ title: `Extras saved — ${formatCurrency(Number(data.extras_total) || 0, currency)} across the hire.` });
      void queryClient.invalidateQueries({ queryKey: ["rental-extra-selections-v2", rental.id] });
    },
    onError: (e: Error) => toast({ title: "Nothing was saved", description: e.message, variant: "destructive" }),
  });

  /* ── second drivers ─────────────────────────────────────────────────── */
  const driversKey = ["rental-additional-drivers", tenant?.id, rental.id];
  const [newDriver, setNewDriver] = useState({ name: "", email: "", phone: "" });
  const addDriver = useMutation({
    mutationFn: async () => {
      const name = newDriver.name.trim();
      if (!name) throw new Error("A driver needs a name.");
      // v1's own route, as the create flow uses it: create the row server-side
      // (tenant-checked there), then send their ID link if there is an email.
      const { data, error } = await supabase.functions.invoke("create-additional-drivers", {
        body: {
          rental_id: rental.id,
          drivers: [{ name, email: newDriver.email.trim() || undefined, phone: newDriver.phone.trim() || undefined }],
        },
      });
      if (error) throw error;
      if (data && (data as any).success === false) throw new Error((data as any).error || "The driver was not added.");
      const created = ((data as any)?.drivers ?? [])[0];
      if (created?.email) {
        await supabase.functions.invoke("send-additional-driver-invite", { body: { driver_id: created.id } });
      }
      return name;
    },
    onSuccess: (name) => {
      toast({ title: `${name} is on the rental.`, description: newDriver.email ? "Their ID link is on its way." : undefined });
      setNewDriver({ name: "", email: "", phone: "" });
      void queryClient.invalidateQueries({ queryKey: driversKey });
      void queryClient.invalidateQueries({ queryKey: ["rental-extras-overview-drivers-v2"] });
    },
    onError: (e: Error) => toast({ title: "The driver was not added", description: e.message, variant: "destructive" }),
  });
  const removeDriver = useMutation({
    mutationFn: async (d: RentalAdditionalDriver) => {
      const { error } = await supabase
        .from("rental_additional_drivers")
        .delete()
        .eq("id", d.id)
        .eq("rental_id", rental.id)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      return d.name;
    },
    onSuccess: (name) => {
      toast({ title: `${name} is off the rental.` });
      void queryClient.invalidateQueries({ queryKey: driversKey });
      void queryClient.invalidateQueries({ queryKey: ["rental-extras-overview-drivers-v2"] });
    },
    onError: (e: Error) => toast({ title: "The driver was not removed", description: e.message, variant: "destructive" }),
  });

  /** Resend a second driver's ID link — v1's `send-additional-driver-invite`. */
  const resend = async (driver: RentalAdditionalDriver) => {
    if (!driver.email) {
      toast({ title: "Cannot resend", description: "This driver has no email address on file.", variant: "destructive" });
      return;
    }
    setResending(driver.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-additional-driver-invite", {
        body: { driver_id: driver.id },
      });
      if (error) throw error;
      if (data && (data as any).success === false) throw new Error((data as any).error || "Failed to send invite");
      toast({ title: "Verification link sent", description: `Resent to ${driver.email}.` });
    } catch (err) {
      toast({
        title: "Couldn't send verification link",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResending(null);
    }
  };

  const inputCls =
    "h-9 min-w-0 rounded-2xl bg-background px-3 text-sm outline-none ring-1 ring-foreground/10 placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40";

  return (
    <Panel
      fill
      title="Extras"
      description="What rides along on top of the car — add-ons, and anyone else driving it."
      action={
        !canEdit && editable.data ? (
          <StageAction icon={Lock} label="Locked" onClick={() => {}} disabledReason={editable.data.reason ?? null} />
        ) : null
      }
    >
      {/* Island layout, the Customer stage's grammar: two full-width cards
          stacked down the pane, sharing its height. While the rental can
          still change, both are edited right here — no dialog. */}
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* ── add-ons ──────────────────────────────────────────────────────── */}
        <Surface className="relative flex min-h-0 flex-1 flex-col p-5">
          <div className="flex items-center gap-2.5">
            <h3 className="font-heading text-sm font-semibold">Add-ons</h3>
            <span className="flex-1 text-xs text-muted-foreground">
              {canEdit ? "From your catalogue, priced as it stands today" : "Priced as they were on the day"}
            </span>
            <span className="text-xs text-muted-foreground">
              {days} day{days === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold text-foreground">
                {formatCurrency(canEdit ? draftTotal : extrasTotal, currency)}
              </span>
            </span>
          </div>

          {canEdit ? (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto no-scrollbar">
              {(catalogue ?? []).length === 0 ? (
                <Empty>No extras in your catalogue yet — add them in Settings.</Empty>
              ) : (
                <div className={listCls}>
                  {(catalogue ?? []).map((e) => {
                    const q = draft[e.id] ?? 0;
                    const perDay = e.billing_type === "per_day";
                    const toggle = e.max_quantity === 1;
                    return (
                      <div key={e.id} className={cn("flex items-center gap-4 px-5 py-3 transition-colors duration-200 ease-out", q > 0 && "bg-primary/[0.05]")}>
                        <Thumb src={e.image_urls?.[0]} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{e.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatCurrency(Number(e.price), currency)} {perDay ? "a day" : "one-off"}
                            {e.description ? ` · ${e.description}` : ""}
                          </p>
                        </div>
                        {toggle ? (
                          <Button size="sm" variant={q > 0 ? "default" : "outline"} onClick={() => setQty(e, q > 0 ? 0 : 1)}>
                            {q > 0 ? "Added" : "Add"}
                          </Button>
                        ) : (
                          <div className="flex items-center gap-1 rounded-full bg-background p-0.5 ring-1 ring-foreground/10">
                            <Button size="icon-sm" variant="ghost" aria-label={`One fewer ${e.name}`} disabled={q === 0} onClick={() => setQty(e, q - 1)}>
                              <Minus />
                            </Button>
                            <span className="w-6 text-center text-sm font-semibold tabular-nums">{q}</span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`One more ${e.name}`}
                              disabled={e.max_quantity != null && q >= e.max_quantity}
                              onClick={() => setQty(e, q + 1)}
                            >
                              <Plus />
                            </Button>
                          </div>
                        )}
                        <span className={cn("w-20 shrink-0 text-right text-sm", q > 0 ? "font-semibold" : "text-muted-foreground")}>
                          {q > 0 ? formatCurrency(q * Number(e.price) * (perDay ? days : 1), currency) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : extrasLoading ? (
            <Empty>Reading what was added…</Empty>
          ) : extras.length === 0 ? (
            <Empty>Nothing was added — just the car.</Empty>
          ) : (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto no-scrollbar">
              <div className={listCls}>
                {extras.map((s) => {
                  const perDay = s.billing_type_at_booking === "per_day";
                  return (
                    <div key={s.id} className="flex items-center gap-4 px-5 py-3">
                      <Thumb src={s.rental_extras?.image_urls?.[0]} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {s.rental_extras?.name ?? "An extra that has since been deleted"}
                          {s.quantity > 1 && <span className="ml-1.5 text-muted-foreground">&times;{s.quantity}</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.quantity > 1 ? `${s.quantity} × ` : ""}
                          {formatCurrency(Number(s.price_at_booking), currency)}
                          {perDay ? ` a day × ${days} day${days === 1 ? "" : "s"}` : " one-off"}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold">{formatCurrency(lineTotal(s, days), currency)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {canEdit && dirty && (
            <div className="mt-3 flex shrink-0 items-center gap-3 rounded-3xl bg-muted/50 px-5 py-2.5">
              <span className="flex-1 text-xs text-muted-foreground">
                Extras <span className="font-semibold text-foreground">{formatCurrency(extrasTotal, currency)} → {formatCurrency(draftTotal, currency)}</span>
                {" "}· raised as a charge on this rental
              </span>
              <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
                Undo
              </Button>
              <Button size="sm" disabled={saveExtras.isPending} onClick={() => saveExtras.mutate()}>
                {saveExtras.isPending ? "Saving…" : "Save extras"}
              </Button>
            </div>
          )}
        </Surface>

        {/* ── additional drivers ───────────────────────────────────────────── */}
        <Surface className="flex min-h-0 flex-1 flex-col p-5">
          <div className="flex items-center gap-2.5">
            <h3 className="font-heading text-sm font-semibold">Additional drivers</h3>
            <span className="flex-1 text-xs text-muted-foreground">Each needs their own ID check and signature</span>
            {drivers && drivers.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {drivers.length} driver{drivers.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {driversLoading ? (
            <Empty>Reading the drivers on this rental…</Empty>
          ) : !drivers || drivers.length === 0 ? (
            <Empty>{detail.customerName ?? "The customer"} is the only driver on this rental.</Empty>
          ) : (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto no-scrollbar">
              <div className={listCls}>
                {drivers.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[d.email, d.phone, d.license_number ? `Licence ${d.license_number}` : null].filter(Boolean).join(" · ") ||
                          "No contact details on file"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {verifyPill(d.verification_status)}
                      {signPill(d.signing_status)}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resend(d)}
                        disabled={!d.email || resending === d.id || d.verification_status === "verified"}
                        title={!d.email ? "No email address on file for this driver." : d.verification_status === "verified" ? "Already verified." : undefined}
                      >
                        {resending === d.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        {d.verification_status === "unverified" || d.verification_status === "rejected" ? "Send ID link" : "Resend ID link"}
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Take ${d.name} off the rental`}
                          title={`Take ${d.name} off the rental`}
                          disabled={removeDriver.isPending}
                          onClick={() => removeDriver.mutate(d)}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add one, right here. */}
          {canEdit && (
            <form
              className="mt-3 grid shrink-0 grid-cols-[1.3fr_1.3fr_1fr_auto] items-center gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                addDriver.mutate();
              }}
            >
              <input className={inputCls} placeholder="Name" value={newDriver.name} onChange={(e) => setNewDriver((d) => ({ ...d, name: e.target.value }))} />
              <input className={inputCls} type="email" placeholder="Email — for their ID link" value={newDriver.email} onChange={(e) => setNewDriver((d) => ({ ...d, email: e.target.value }))} />
              <input className={inputCls} type="tel" placeholder="Phone" value={newDriver.phone} onChange={(e) => setNewDriver((d) => ({ ...d, phone: e.target.value }))} />
              <Button size="sm" type="submit" disabled={!newDriver.name.trim() || addDriver.isPending}>
                {addDriver.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
                Add driver
              </Button>
            </form>
          )}
        </Surface>
      </div>
    </Panel>
  );
}

/** extra_id → quantity, without zeros and in a stable order — for comparing. */
const normalise = (m: Record<string, number>) =>
  Object.keys(m)
    .filter((k) => m[k] > 0)
    .sort()
    .map((k) => [k, m[k]]);

/** The extra's own photo (its first catalogue image); a quiet tile without one. */
function Thumb({ src }: { src: string | null | undefined }) {
  return (
    <span className="relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground/50">
      {src ? (
        // A plain <img>: these come from the storage host, not a next/image remote.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <Package className="size-4" />
      )}
    </span>
  );
}

/** An empty card's body: one quiet line, centred in the space it fills. */
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(insetCls, "mt-4 flex min-h-16 flex-1 items-center justify-center px-6 text-center")}>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
