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
} from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";

export function VehiclesTeachingEmptyState({
  onAddVehicle,
}: {
  onAddVehicle: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Car}
      headline="Your fleet lives here"
      body="Every car you rent out is a vehicle record. It carries the registration, the photos and the rates your booking site shows customers — and a rental is always booked against one, so nothing can be hired until a vehicle exists."
      points={[
        "Photos and rates decide what customers see and pay",
        "Availability, blocked dates and pricing all hang off the vehicle",
        "Everything is editable later — nothing here is one-way",
      ]}
      primaryAction={{
        label: "Add your first vehicle",
        onClick: onAddVehicle,
        icon: Plus,
      }}
      explainerId="fleet.vehicle-add"
      footnote="Most operators add one car, take a booking against it end to end, then add the rest."
    />
  );
}

export function CustomersTeachingEmptyState({
  onAddCustomer,
}: {
  /** Omitted when the signed-in user has view-only access to customers. */
  onAddCustomer?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Users}
      headline="Everyone who rents from you, in one place"
      body="A customer record holds their contact details, driving licence and verification status, and it links to every rental, payment, agreement and message they have ever had with you. Anyone who books through your site is added here automatically."
      points={[
        "Licence and ID checks attach to the customer, not to one rental",
        "Their whole rental and payment history sits on one page",
        "Block a risky renter once and they are blocked everywhere",
      ]}
      primaryAction={
        onAddCustomer
          ? { label: "Add a customer", onClick: onAddCustomer, icon: Plus }
          : undefined
      }
      explainerId="customers.add"
      footnote="You can also add someone mid-booking — creating a rental offers it inline."
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
      icon={CalendarPlus}
      headline="This is where the business actually runs"
      body="A rental ties one customer to one vehicle for a set of dates, and carries the money with it — the charge, the deposit hold, the signed agreement and the insurance. Every other screen in the portal is reporting on what happens here."
      points={[
        "Charge fixed dates, auto-renewing, installments or pay-as-you-go",
        "Deposit holds, agreements and cover are handled inside the rental",
        "Bookings from your public site arrive here for approval",
      ]}
      primaryAction={{
        label: "Create your first rental",
        onClick: onCreateRental,
        icon: Plus,
      }}
      explainerId="rentals.first-rental"
      footnote="You will need a vehicle and a customer first — both can be created from inside the rental."
    />
  );
}

export function AgreementsTeachingEmptyState({
  onGoToRentals,
}: {
  onGoToRentals: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={FileSignature}
      headline="Signed paperwork, tracked for you"
      body="Every rental can produce a rental agreement and send it for e-signature before the keys change hands. Sent, opened and signed documents all land on this page, and the signed PDF is filed against both the rental and the customer."
      points={[
        "Send for signature straight from a rental — no separate tool",
        "See at a glance who has signed and who is holding you up",
        "Extension agreements are tracked here too",
      ]}
      primaryAction={{
        label: "Open a rental to send one",
        onClick: onGoToRentals,
        icon: FileSignature,
      }}
      explainerId="agreements.first-agreement"
      footnote="Put your logo on the signing emails in Settings → e-Sign."
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
      icon={CreditCard}
      headline="Every payment, in one ledger"
      body="Money lands here the moment a customer pays — card charges from your booking site, installments, pay-as-you-go accruals and released deposit holds all post themselves. You can also record a cash or bank transfer by hand so the ledger matches what is really in your account."
      points={[
        "Card payments from your booking site arrive on their own",
        "Record cash and bank transfers so the books balance",
        "Refunds, deposits and failed charges are tracked here too",
      ]}
      primaryAction={
        onRecordPayment
          ? { label: "Record a payment", onClick: onRecordPayment, icon: Plus }
          : undefined
      }
      explainerId="payments.overview"
      footnote="Connect Stripe once and everything after that posts automatically."
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
      headline="Invoices raise themselves from your rentals"
      body="Every rental produces its own invoice, so what a customer owes and what they have already paid are never two different numbers. Send one, mark it settled, or download the PDF for your accountant."
      points={[
        "Created automatically the moment a rental is booked",
        "Shows owed, paid and overdue for each customer",
        "Download as a PDF or send it straight to the customer",
      ]}
      primaryAction={{
        label: "Create your first rental",
        onClick: onCreateRental,
        icon: Plus,
      }}
      explainerId="invoices.overview"
      footnote="Nothing to do here yet — take a booking and the first invoice appears."
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
      headline="Cover for every rental, sold at checkout"
      body="Switch on Bonzah and customers can buy per-rental cover while they book. You earn on every policy, the documents are issued automatically, and both the policies you sell and any policy a customer brings themselves are listed on this page."
      points={[
        "Customers buy cover in the booking flow, not over the phone",
        "Policy documents are issued and stored against the rental",
        "Upload a customer's own policy when they arrive with one",
      ]}
      primaryAction={{
        label: "Set up Bonzah insurance",
        onClick: onSetUpInsurance,
        icon: SettingsIcon,
      }}
      explainerId="insurance.bonzah"
      footnote="Already connected? Policies appear here the moment a rental sells the first one."
    />
  );
}
