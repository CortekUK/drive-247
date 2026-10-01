"use client";

/**
 * The teaching copy, one component per page.
 *
 * Split out from `teaching-empty-state.tsx` so the words live in one file an
 * editor can sweep, and so every call site is a single self-describing element
 * inside a page that is otherwise untouched. That matters more than usual
 * here: four of the five hosts are SHARED pages that all 57 tenants render, and
 * the smaller the diff inside them, the smaller the chance of moving something
 * for the 56 who must see no change at all.
 *
 * WHEN THESE MAY RENDER — both conditions, every time:
 *
 *   1. `isLeanTenant(tenantSlug)` — the northwind canary only. Keyed on SLUG,
 *      never id: northwind is 6e5c544f-… in production and 8e6bc88f-… on the
 *      staging branch, so an id-keyed gate resolves to the wrong branch in one
 *      environment with no error and no failed build. `isLeanTenant` also fails
 *      closed on a null slug, which is the state during the tick before
 *      TenantContext's client-side effect resolves it — so a v1 tenant never
 *      sees this copy flash and disappear.
 *
 *   2. The page's UNFILTERED count is zero. Not the filtered count, not the
 *      paginated slice. An operator whose search box matched nothing is not a
 *      beginner and must keep the "no results, clear your filters" state they
 *      have today. Every call site derives this from its own raw query result,
 *      because only the page knows which of its state is a filter.
 *
 * Anything else — a lean tenant with rows, a v1 tenant, a filtered miss —
 * renders exactly what it rendered before.
 */

import {
  Car,
  CreditCard,
  FileSignature,
  FileText,
  Plus,
  ShieldCheck,
  Settings as SettingsIcon,
  Users,
  CalendarPlus,
  FilePlus2,
  Link2,
} from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import {
  CustomersEmptyArt,
  RentalsEmptyArt,
  VehiclesEmptyArt,
} from "@/components/illustrations-v2/empty-scenes";
import { AgreementsEmptyArt } from "@/components/illustrations-v2/scenes/agreements";
import { PaymentsEmptyArt } from "@/components/illustrations-v2/scenes/payments";
import { InvoicesEmptyArt } from "@/components/illustrations-v2/scenes/invoices";
import { InsurancesEmptyArt } from "@/components/illustrations-v2/scenes/insurances";

export function VehiclesTeachingEmptyState({
  onAddVehicle,
}: {
  onAddVehicle: () => void;
}) {
  return (
    <TeachingEmptyState
      // Anchor for the Vehicles tab tour's empty-tab steps. The tour points at
      // `vehicles-empty-points` and at the headline inside this card, never at
      // the card itself — see the prop's note.
      data-tour="vehicles-empty"
      icon={Car}
      illustration={<VehiclesEmptyArt />}
      headline="Your fleet lives here"
      body="Add your cars with their photos and rates. Every booking is made against one."
      primaryAction={{
        label: "Add your first vehicle",
        hint: "Add a car with its photos, rates and availability.",
        onClick: onAddVehicle,
        icon: Plus,
      }}
      explainerId="fleet.vehicle-add"
    />
  );
}

export function CustomersTeachingEmptyState({
  onAddCustomer,
  onInviteCustomer,
}: {
  /** Omitted when the signed-in user has view-only access to customers. */
  onAddCustomer?: () => void;
  /** Opens the customer invite link dialog. Omitted with view-only access. */
  onInviteCustomer?: () => void;
}) {
  return (
    <TeachingEmptyState
      // Anchor for the Customers tab tour's empty-tab steps. The tour points at
      // `customers-empty-points`, not the card — see the prop's note.
      data-tour="customers-empty"
      icon={Users}
      illustration={<CustomersEmptyArt />}
      headline="Everyone who rents from you, in one place"
      body="Everyone who books with you, with their licence checks and rental history."
      primaryAction={
        onAddCustomer
          ? { label: "Add a customer", onClick: onAddCustomer, icon: Plus, hint: "Add someone’s details and driving licence by hand." }
          : undefined
      }
      secondaryAction={
        onInviteCustomer
          ? {
              label: "Invite by link",
              onClick: onInviteCustomer,
              icon: Link2,
              hint: "Send a sign-up link. They fill in their own details and licence.",
            }
          : undefined
      }
      explainerId="customers.add"
    />
  );
}

export function RentalsTeachingEmptyState({
  onCreateRental,
}: {
  onCreateRental: () => void;
}) {
  return (
    <TeachingEmptyState
      // Anchor for the Rentals tab tour's empty-tab steps. The tour points at
      // the headline, at `rentals-empty-points` and at this card's own button,
      // never at the card itself — see the prop's note.
      data-tour="rentals-empty"
      icon={CalendarPlus}
      illustration={<RentalsEmptyArt />}
      headline="This is where the business actually runs"
      body="Each rental ties a customer to a car, with its payment, agreement and handover."
      primaryAction={{
        label: "Create your first rental",
        hint: "Book a car for a customer and choose the dates.",
        onClick: onCreateRental,
        icon: Plus,
      }}
      explainerId="rentals.first-rental"
    />
  );
}

export function AgreementsTeachingEmptyState({
  onSendAgreement,
  onGoToRentals,
  onCreateTemplate,
}: {
  /**
   * Agreements v2 (`AgreementsPageV2`): send one straight from this page.
   * Omitted when the signed-in user may not send.
   */
  onSendAgreement?: () => void;
  /** The v1 list, where every row is a rental's agreement: go send one from a rental. */
  onGoToRentals?: () => void;
  /** Agreements v2: open "create a template". Omitted without the templates grant. */
  onCreateTemplate?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={FileSignature}
      illustration={<AgreementsEmptyArt />}
      headline="Every agreement you send, in one place"
      body={
        onSendAgreement
          ? "Send one for e-signature, and follow it here until it comes back signed."
          : "Each rental's agreement shows here, from sent for e-signature to signed."
      }
      primaryAction={
        onSendAgreement
          ? {
              label: "Send agreement",
              hint: "Choose who signs and a template, then send it for e-signature.",
              onClick: onSendAgreement,
              icon: Plus,
            }
          : onGoToRentals
            ? {
                label: "Open a rental to send one",
                hint: "Send the agreement for e-signature from the rental itself.",
                onClick: onGoToRentals,
                icon: FileSignature,
              }
            : undefined
      }
      secondaryAction={
        onCreateTemplate
          ? {
              label: "Create a template",
              hint: "Write the agreement once. Every rental fills in its own details.",
              onClick: onCreateTemplate,
              icon: FilePlus2,
            }
          : undefined
      }
      explainerId="agreements.first-agreement"
    />
  );
}

export function PaymentsTeachingEmptyState({
  onRecordPayment,
}: {
  /** Omitted when the signed-in user has view-only access to payments. */
  onRecordPayment?: () => void;
}) {
  return (
    <TeachingEmptyState
      // Anchor for the Payments tab tour, which leans on this card whenever the
      // table is not drawn (its headline and its button).
      data-tour="payments-empty"
      icon={CreditCard}
      illustration={<PaymentsEmptyArt />}
      headline="Every payment, in one ledger"
      body="Booking-site card payments land here on their own. Record cash and transfers too."
      primaryAction={
        onRecordPayment
          ? {
              label: "Record a payment",
              hint: "Log a cash, bank transfer or card payment against a customer.",
              onClick: onRecordPayment,
              icon: Plus,
            }
          : undefined
      }
      explainerId="payments.overview"
    />
  );
}

export function InvoicesTeachingEmptyState({
  onCreateRental,
}: {
  onCreateRental: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={FileText}
      illustration={<InvoicesEmptyArt />}
      headline="Invoices raise themselves from your rentals"
      body="Each rental makes its own invoice: what the customer owes, and what is paid."
      primaryAction={{
        label: "Create your first rental",
        hint: "Book a car for a customer. Its invoice is made for you.",
        onClick: onCreateRental,
        icon: Plus,
      }}
      explainerId="invoices.overview"
    />
  );
}

export function InsurancesTeachingEmptyState({
  onSetUpInsurance,
}: {
  onSetUpInsurance: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={ShieldCheck}
      illustration={<InsurancesEmptyArt />}
      headline="Cover for every rental, sold at checkout"
      body="With Bonzah on, customers add cover as they book, and each policy lands here."
      primaryAction={{
        label: "Set up Bonzah insurance",
        hint: "Apply for Bonzah in Settings so customers can buy cover as they book.",
        onClick: onSetUpInsurance,
        icon: SettingsIcon,
      }}
      explainerId="insurance.bonzah"
    />
  );
}
