/**
 * The stages of a rental, and the one place they are defined.
 *
 * Imported by BOTH the left rail (`shared/layout/app-sidebar-v2.tsx`) and the
 * screen (`rental-detail-v2.tsx`). That is the whole point of the file: the
 * rail and the panel cannot disagree about what stages exist, what they are
 * called, or which one is showing, because neither of them owns the list.
 *
 * A stage is not a nav label. It is a decision the rental carries — who is
 * renting, which car, when and where — so the rail renders each one as its
 * ANSWER where it has one, and as its QUESTION where it does not. `stageValues`
 * below is where those answers are computed, and it is the only file three
 * other stage authors have to touch to light their own line up.
 */

import type { ComponentType } from "react";
import {
  User,
  Car,
  CalendarDays,
  Package,
  FileSignature,
  ShieldCheck,
  CreditCard,
  KeyRound,
} from "lucide-react";
import type { RentalDetailV2 } from "./use-rental-detail-v2";

export type StageId =
  | "customer"
  | "vehicle"
  | "when"
  | "extras"
  | "agreement"
  | "insurance"
  | "payments"
  | "handover";

export type Stage = {
  id: StageId;
  /** Shown on the left of the rail row, and as the panel's title. */
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** What the stage asks while the rental has no answer for it. */
  prompt: string;
};

/**
 * What EVERY stage component is handed. This is the contract four authors
 * build against, so it is small on purpose.
 *
 * It lives here rather than in `rental-detail-v2.tsx` for one boring reason: a
 * stage importing its props type from the screen that renders it is a module
 * cycle, which survives only as long as everybody remembers to write `import
 * type`. Here there is nothing to remember.
 *
 * `detail` is non-null. The screen resolves loading, not-found and
 * no-such-tenant BEFORE it mounts a stage, so no stage has to render a skeleton
 * or guard for a missing rental — the two states a stage handles are "this
 * rental has an answer for me" and "it does not yet".
 */
export type StageProps = {
  /** The rental row with its joined customer and vehicle, plus derived facts. */
  detail: RentalDetailV2;
  /** Move to another stage. The URL is the source of truth; this just sets it. */
  onStage: (stage: StageId) => void;
  /** Re-read the rental after a mutation lands. Returns once the read settles. */
  refetch: () => void;
};

/**
 * In the order an operator actually works a rental: who, then which car, then
 * when and where, then what rides along, then the paperwork, then the day
 * itself. The order is also the accent ramp in `StageItem` — the first decision
 * carries the most tint — so reordering this array changes how the rail reads,
 * not just where things sit.
 */
export const STAGES: readonly Stage[] = [
  { id: "customer", label: "Customer", icon: User, prompt: "Who is renting?" },
  { id: "vehicle", label: "Vehicle", icon: Car, prompt: "Which car goes out?" },
  { id: "when", label: "When & where", icon: CalendarDays, prompt: "When and where?" },
  { id: "extras", label: "Extras", icon: Package, prompt: "Anything on top?" },
  { id: "agreement", label: "Agreement", icon: FileSignature, prompt: "Send the contract?" },
  { id: "insurance", label: "Insurance", icon: ShieldCheck, prompt: "Add cover?" },
  { id: "payments", label: "Payments", icon: CreditCard, prompt: "What's owed?" },
  { id: "handover", label: "Handover", icon: KeyRound, prompt: "Where is the car?" },
] as const;

/** The stage a rental opens on when the URL says nothing. */
export const DEFAULT_STAGE: StageId = "customer";

const STAGE_IDS = new Set<string>(STAGES.map((s) => s.id));

/**
 * `?stage=…` → a stage, or the default.
 *
 * Never throws and never renders a blank screen for a typo'd or stale link: an
 * unrecognised value resolves to the Customer stage, exactly as an absent one
 * does.
 */
export function readStage(param: string | null | undefined): StageId {
  return param && STAGE_IDS.has(param) ? (param as StageId) : DEFAULT_STAGE;
}

/**
 * Where a stage lives.
 *
 * The stage is in the URL rather than in React state, and that is a decision
 * with three consequences worth keeping: the rail and the page read the same
 * `?stage=` with no shared context between them; a stage is deep-linkable and
 * survives a refresh; and Settings already works exactly this way (`?tab=`), so
 * the two scoped screens behave identically.
 */
export function stageHref(rentalId: string, stage: StageId): string {
  return `/rentals/${rentalId}?stage=${stage}`;
}

/**
 * What each stage says in the rail, for THIS rental.
 *
 * `null` means "no answer yet" — the rail then shows the stage's `prompt` on a
 * flat grey ground, which is an honest empty state, not a placeholder. A stage
 * whose data nobody has wired yet MUST return null here rather than a plausible
 * string: on a real rental an invented figure is a lie, and the rail is the one
 * place an operator reads at a glance without checking.
 *
 * Each value carries only what belongs to THIS rental — the customer's name,
 * the car's name, the dates. Never a fact that describes the entity itself (the
 * customer's rating, the car's daily rate): those live in the main panel, and
 * in 280px they crowd out the one thing the rail is for.
 *
 * Adding a stage's line is a one-line edit here, so the four authors of the
 * eight stages never touch the same block.
 */
export function stageValues(detail: RentalDetailV2 | null | undefined): Record<StageId, string | null> {
  return {
    customer: detail?.customerName ?? null,
    vehicle: detail?.vehicleName ?? null,
    when: detail?.dateRangeShort ?? null,

    // Null by decision rather than by omission. The Extras stage IS built and
    // reads real rows — but its answer lives in
    // `rental_extras_selections` and `rental_additional_drivers` — two tables
    // `use-rental-detail-v2` does not join, and must not (V2_PLAN §5: a v2 screen
    // may present differently, it may not read more broadly than v1). This
    // function is pure in `detail`, so there is nothing here to read. The rail
    // asking "Anything on top?" is the honest answer; a guess would not be.
    extras: null,

    // The agreement's real state lives in `rental_agreements`, which this
    // function cannot read — so it is taken from the rental's own denormalised
    // columns, but ONLY when one of them corroborates it.
    //
    // That guard is not caution for its own sake. On the canary tenant 23
    // rentals carry `document_status = 'signed'` or `'completed'` while having
    // no envelope id, no signed document and no row in `rental_agreements` at
    // all. Trusting the column alone would put "Signed" in the rail beside a
    // rental whose agreement was never sent — the exact lie this file's own
    // comment forbids. An envelope id or a signed document is proof a document
    // exists; the status column on its own is not.
    agreement: detail?.rental?.signed_document_id
      ? "Signed"
      : detail?.rental?.docusign_envelope_id
        ? ({ completed: "Signed", signed: "Signed", declined: "Declined", voided: "Voided" }[
            String(detail.rental.document_status ?? "").toLowerCase()
          ] ?? "Awaiting signature")
        : null,

    // `rentals.insurance_status` is the operator's own recorded decision about
    // cover, set on the rental itself rather than asserting that some other row
    // exists — so unlike `document_status` it can be read as it stands. The one
    // value that DOES assert an external object is `bonzah`, so it is paired
    // with the premium that would have been charged for it.
    //
    // `pending` deliberately yields null: it means nobody has decided yet, which
    // is the stage's question ("Add cover?") and not an answer to it.
    insurance: (() => {
      const status = String(detail?.rental?.insurance_status ?? "").toLowerCase();
      if (status === "bonzah") return Number(detail?.rental?.insurance_premium) > 0 ? "Bonzah cover" : null;
      if (status === "uploaded") return "Customer's own";
      if (status === "verified") return "Customer's own, checked";
      if (status === "not_required") return "Not required";
      return null;
    })(),

    // Stays null, and this one is a finding rather than a gap. The number an
    // operator wants here is what is OUTSTANDING, and it exists nowhere on the
    // rental row: it is `sum(ledger_entries.remaining_amount)` less what the
    // applications account for, which needs a query this pure function cannot
    // make. The one column that looks like an answer, `rentals.payment_status`,
    // is not one — on production 69 rentals marked `fulfilled` still owe money
    // and 46 marked `pending` owe nothing, so putting it in the rail would be a
    // lie read at a glance. Lighting this line up is a small addition to
    // `use-rental-detail-v2` (one summed read), not a change here.
    payments: null,

    // How the keys reach the customer, from `rentals.delivery_method` — a
    // handover decision stored on the rental row itself. The handovers, their
    // photographs and their timestamps live in `rental_key_handovers`, which
    // this function cannot read, so nothing here claims the car has actually
    // moved: it says only how it is meant to.
    handover:
      detail?.rental?.delivery_method === "lockbox"
        ? "By lockbox"
        : detail?.rental?.delivery_method === "in_person"
          ? "In person"
          : null,
  };
}
