"use client";

/**
 * Activity — the third tab of the right rail. REAL DATA, DERIVED.
 *
 * ── There is no rental activity table, and this is what was done about it ───
 *
 * The schema has `lead_activity` for leads and `vehicle_events` for vehicles.
 * It has nothing equivalent for rentals. `audit_logs` CAN be read per-rental
 * (`entity_type = 'rental'` + `entity_id`, and there is a composite index for
 * exactly that), but nothing in the monorepo has ever read it that way, no
 * edge function tags a rental event with it — so every server-side thing that
 * happens to a rental, which is most of them, is missing from it — and a good
 * share of the client rows that DO exist are `*_warning_shown` telemetry
 * recording that a dialog opened.
 *
 * So an "audit feed" here would have been a thin, misleading list presented as
 * the rental's history. What this tab does instead is what
 * `hooks/use-payg-timeline.ts` does for its own domain: it merges the
 * per-rental rows that genuinely record events, each of which carries a real
 * stored timestamp, and sorts them. Nothing is inferred, and nothing is
 * rendered that a row did not assert.
 *
 * Six sources, all scoped by `rental_id`:
 *
 *   the rental row     created, approved, deposit hold placed and released,
 *                      lockbox code sent, return reminder sent
 *   rental_agreements  envelope sent / signed / signing email delivered
 *   payments           money in, with method, and refunds
 *   key handovers      the car actually going out and coming back, + mileage
 *   bonzah policies    a policy being issued, with its number
 *   vehicle swaps      the car on the rental changing
 *   audit_logs         overlaid last, purely for the WHO and the reason —
 *                      never as the spine, and with the dialog-open telemetry
 *                      filtered out
 *
 * ── Actors ─────────────────────────────────────────────────────────────────
 *
 * Three tables carry a real staff id (`audit_logs.actor_id`,
 * `rental_key_handovers.handed_by`, `rental_vehicle_swaps.swapped_by`). Those
 * are resolved in ONE batched `app_users` read — never a PostgREST FK join,
 * because `audit_logs` has duplicate FK constraints on `tenant_id` and the
 * embed is ambiguous (the admin app hit this and left a comment about it).
 *
 * Every other row has no actor column, so those rows show a time and no name.
 * The prototype's three-tone actor ramp (operator / customer / system) is
 * therefore gone: on real rows it would have meant guessing who did something
 * from which table it landed in, which is exactly the kind of invented fact
 * this screen exists to avoid. Colour now says KIND, and destructive says a
 * genuine failure.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Check,
  CreditCard,
  RotateCcw,
  Lock,
  Unlock,
  KeyRound,
  ShieldCheck,
  FileSignature,
  Mail,
  Car,
  Bell,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { SHOW_MULTI_PERIOD } from "./multi-period";
import { money } from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

/** The three kinds the filter offers, matching the design. */
type Kind = "money" | "doc" | "change";

type Event = {
  id: string;
  /** ISO timestamp. Every event has one — that is what makes it an event. */
  at: string;
  kind: Kind;
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  /** A real staff name, where a row carries one. Never guessed. */
  by?: string | null;
  /** Formatted money, where the row carries an amount. */
  amount?: string;
  /** A genuine failure — not merely "not done yet". */
  bad?: boolean;
};

const FILTERS: { id: Kind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "money", label: "Money" },
  { id: "doc", label: "Documents" },
  { id: "change", label: "Changes" },
];

const KIND_TONE: Record<Kind, string> = {
  money: "text-primary",
  doc: "text-foreground/70",
  change: "text-muted-foreground/60",
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
};

const timeLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

/**
 * `deposit_hold_released` → "Deposit hold released".
 *
 * Audit actions are snake_case verbs written by client code. Rendering them
 * raw is how a feed starts reading as a database dump.
 */
const humanise = (action: string) =>
  action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Audit rows that record a DIALOG OPENING rather than a thing happening.
 *
 * A rental's history should not contain "someone was shown a warning". These
 * are real rows and they are genuinely useful telemetry — they are simply not
 * events on the rental.
 */
const isTelemetry = (action: string) =>
  /_(warning|dialog)_(shown|opened)$|_shown$|_viewed$/.test(action);

/* ══════════════════════════════════════════════════════════════════════════
   Reading the rows
   ══════════════════════════════════════════════════════════════════════════ */

function useRentalActivity(rental: Record<string, any>, tenantId: string | null | undefined) {
  const rentalId = rental?.id ?? null;

  return useQuery({
    queryKey: ["rental-activity-v2", rentalId, tenantId],
    queryFn: async (): Promise<Event[]> => {
      const [agreements, payments, handovers, policies, swaps, audits] = await Promise.all([
        supabase
          .from("rental_agreements")
          .select("id, agreement_type, document_status, envelope_sent_at, envelope_completed_at, email_delivered_at, email_delivery_status")
          .eq("rental_id", rentalId!)
          .eq("tenant_id", tenantId!),
        supabase
          .from("payments")
          .select("id, amount, method, status, payment_type, refund_status, paid_at, payment_date, created_at")
          .eq("rental_id", rentalId!)
          .eq("tenant_id", tenantId!),
        supabase
          .from("rental_key_handovers")
          .select("id, handover_type, handed_at, handed_by, mileage")
          .eq("rental_id", rentalId!)
          .eq("tenant_id", tenantId!),
        supabase
          .from("bonzah_insurance_policies")
          .select("id, policy_no, premium_amount, status, policy_issued_at, created_at")
          .eq("rental_id", rentalId!)
          .eq("tenant_id", tenantId!),
        supabase
          .from("rental_vehicle_swaps")
          .select("id, reason, swapped_by, created_at")
          .eq("rental_id", rentalId!)
          .eq("tenant_id", tenantId!),
        // The overlay. Flat columns only, and never an FK embed — `audit_logs`
        // carries duplicate tenant FK constraints, which makes the join
        // ambiguous to PostgREST.
        supabase
          .from("audit_logs")
          .select("id, action, actor_id, details, created_at")
          .eq("tenant_id", tenantId!)
          .eq("entity_type", "rental")
          .eq("entity_id", rentalId!)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const events: Event[] = [];
      const push = (e: Event | null) => {
        if (e && e.at) events.push(e);
      };

      /* ── the rental's own timestamps ──────────────────────────────── */

      push(
        rental.created_at
          ? { id: "r-created", at: rental.created_at, kind: "change", icon: Plus, text: "Rental created" }
          : null
      );
      push(
        rental.approved_at
          ? { id: "r-approved", at: rental.approved_at, kind: "change", icon: Check, text: "Booking approved" }
          : null
      );
      push(
        rental.deposit_hold_placed_at
          ? {
              id: "r-hold",
              at: rental.deposit_hold_placed_at,
              kind: "money",
              icon: Lock,
              text: "Deposit hold placed",
            }
          : null
      );
      push(
        rental.deposit_hold_release_requested_at
          ? {
              id: "r-hold-release",
              at: rental.deposit_hold_release_requested_at,
              kind: "money",
              icon: Unlock,
              text: "Deposit hold release requested",
            }
          : null
      );
      push(
        rental.lockbox_sent_at
          ? {
              id: "r-lockbox",
              at: rental.lockbox_sent_at,
              kind: "doc",
              icon: KeyRound,
              text: "Lockbox code sent to the customer",
            }
          : null
      );
      push(
        rental.return_reminder_sent_at
          ? {
              id: "r-return-reminder",
              at: rental.return_reminder_sent_at,
              kind: "doc",
              icon: Bell,
              text: "Return reminder sent",
            }
          : null
      );

      /* ── agreements ───────────────────────────────────────────────── */

      for (const a of agreements.data ?? []) {
        // An extension has its own agreement, and with one fixed period there
        // is no extension to have one — see `SHOW_MULTI_PERIOD`. The Agreement
        // stage hides the same rows for the same reason.
        if (!SHOW_MULTI_PERIOD && a.agreement_type === "extension") continue;
        const which = a.agreement_type === "extension" ? "Extension agreement" : "Agreement";
        push(
          a.envelope_sent_at
            ? {
                id: `ag-sent-${a.id}`,
                at: a.envelope_sent_at,
                kind: "doc",
                icon: FileSignature,
                text: `${which} sent for signature`,
              }
            : null
        );
        push(
          a.email_delivered_at
            ? {
                id: `ag-mail-${a.id}`,
                at: a.email_delivered_at,
                kind: "doc",
                icon: Mail,
                text: "Signing email delivered",
              }
            : null
        );
        push(
          a.envelope_completed_at
            ? {
                id: `ag-done-${a.id}`,
                at: a.envelope_completed_at,
                kind: "doc",
                icon: FileSignature,
                text: `${which} signed`,
              }
            : null
        );
      }

      /* ── payments ─────────────────────────────────────────────────── */

      for (const p of payments.data ?? []) {
        const when = p.paid_at ?? (p.payment_date ? `${p.payment_date}T12:00:00Z` : null) ?? p.created_at;
        if (!when) continue;
        const failed = ["failed", "cancelled", "canceled"].includes(String(p.status ?? "").toLowerCase());
        const refunded = !!p.refund_status && String(p.refund_status).toLowerCase() !== "none";
        push({
          id: `p-${p.id}`,
          at: when,
          kind: "money",
          icon: refunded ? RotateCcw : CreditCard,
          text: refunded
            ? `Payment refunded${p.method ? ` · ${p.method}` : ""}`
            : failed
              ? `Payment failed${p.method ? ` · ${p.method}` : ""}`
              : `Payment received${p.method ? ` · ${p.method}` : ""}`,
          amount: money(num(p.amount)),
          bad: failed,
        });
      }

      /* ── the car going out and coming back ────────────────────────── */

      for (const h of handovers.data ?? []) {
        if (!h.handed_at) continue;
        const out = String(h.handover_type) === "giving";
        push({
          id: `h-${h.id}`,
          at: h.handed_at,
          kind: "change",
          icon: KeyRound,
          text: `${out ? "Keys handed to the customer" : "Keys returned"}${
            h.mileage ? ` · ${Number(h.mileage).toLocaleString("en-US")} mi` : ""
          }`,
          by: h.handed_by ?? null,
        });
      }

      /* ── insurance ────────────────────────────────────────────────── */

      for (const pol of policies.data ?? []) {
        const when = pol.policy_issued_at ?? pol.created_at;
        if (!when) continue;
        push({
          id: `pol-${pol.id}`,
          at: when,
          kind: "doc",
          icon: ShieldCheck,
          text: `Policy issued${pol.policy_no ? ` · ${pol.policy_no}` : ""}`,
          amount: num(pol.premium_amount) > 0 ? money(num(pol.premium_amount)) : undefined,
        });
      }

      /* ── vehicle swaps ────────────────────────────────────────────── */

      for (const s of swaps.data ?? []) {
        if (!s.created_at) continue;
        push({
          id: `sw-${s.id}`,
          at: s.created_at,
          kind: "change",
          icon: Car,
          text: `Vehicle swapped${s.reason ? ` — ${s.reason}` : ""}`,
          by: s.swapped_by ?? null,
        });
      }

      /* ── the audit overlay ────────────────────────────────────────── */

      for (const a of audits.data ?? []) {
        if (!a.created_at || !a.action) continue;
        if (isTelemetry(a.action)) continue;
        const details = (a.details ?? {}) as Record<string, any>;
        const reason = typeof details.reason === "string" ? details.reason : null;
        push({
          id: `au-${a.id}`,
          at: a.created_at,
          kind: "change",
          icon: Pencil,
          text: `${humanise(a.action)}${reason ? ` — ${reason}` : ""}`,
          by: a.actor_id ?? null,
        });
      }

      /* ── put real names on the rows that carry an actor id ─────────── */

      const actorIds = Array.from(
        new Set(events.map((e) => e.by).filter((v): v is string => typeof v === "string" && v.length > 0))
      );
      if (actorIds.length > 0) {
        const { data: staff } = await supabase.from("app_users").select("id, name").in("id", actorIds);
        const names = new Map((staff ?? []).map((u: any) => [u.id, u.name as string | null]));
        for (const e of events) {
          if (e.by) e.by = names.get(e.by) ?? null;
        }
      }

      // Newest first — an operator opens this to see what just happened.
      return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    },
    enabled: !!rentalId && !!tenantId,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   The tab
   ══════════════════════════════════════════════════════════════════════════ */

export function RailActivity({ detail }: { detail: RentalDetailV2 }) {
  const { tenant } = useTenant();
  const [filter, setFilter] = useState<Kind | "all">("all");

  const { data: all = [], isLoading } = useRentalActivity(detail.rental, tenant?.id);

  const events = useMemo(
    () => all.filter((e) => filter === "all" || e.kind === filter),
    [all, filter]
  );

  return (
    <>
      {/* A long list is a long way to scroll back to change your mind, so the
          filter is pinned above it rather than riding inside it. */}
      <div className="flex shrink-0 gap-1 pb-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-3xl px-2 py-0.5 text-[11px] transition-colors",
              filter === f.id
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:text-primary"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-0.5 pt-2 text-[11px] text-muted-foreground">Reading what happened…</p>
        ) : events.length === 0 ? (
          <p className="px-0.5 pt-2 text-[11px] leading-relaxed text-muted-foreground">
            {all.length === 0
              ? "Nothing has been recorded against this rental yet. Events land here as the car goes out, money moves and paperwork is signed."
              : "Nothing of that kind on this rental."}
          </p>
        ) : (
          events.map((e, i) => {
            const day = dayLabel(e.at);
            const newDay = i === 0 || dayLabel(events[i - 1].at) !== day;
            return (
              <div key={e.id}>
                {newDay && (
                  <p className="px-0.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                    {day}
                  </p>
                )}

                {/* Icon, what, who · when, and money in its own column. The
                    icon is coloured by kind, and that is the only colour on a
                    healthy row; a failure turns the icon and the figure
                    destructive. */}
                <div className="flex gap-2.5 py-1.5">
                  <e.icon
                    className={cn("mt-0.5 size-3.5 shrink-0", e.bad ? "text-destructive" : KIND_TONE[e.kind])}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug">{e.text}</p>
                    <p className="mt-0.5 text-[11px] leading-none text-muted-foreground/60">
                      {e.by && <span className="font-medium text-foreground/70">{e.by} · </span>}
                      {timeLabel(e.at)}
                    </p>
                  </div>

                  {e.amount && (
                    <span
                      className={cn(
                        "shrink-0 text-[13px] font-medium tabular-nums",
                        e.bad && "text-destructive"
                      )}
                    >
                      {e.amount}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

export default RailActivity;
