// Client-safe DISPLAY manifest for the Time Machine multi-service sandbox.
//
// This file is SAFE TO SHIP TO THE BROWSER. It contains ONLY presentation
// metadata — labels, lucide icon names, and which status fields to render for
// each cron-driven service. It performs NO queries and holds NO Supabase keys,
// service roles, project refs, or fixture IDs. All of that lives server-side in
// `app/api/dev/sandbox/*`. The panel reads the per-service `status` object the
// server route returns and renders the fields named here.

export type ServiceKey =
  | "payg"
  | "installment"
  | "auto_extend"
  | "deposit"
  | "payg_reminder"
  | "return_reminder"
  | "daily_reminder";

/** How to render a raw status value. Defaults to "text". */
export type StatusFieldFormat =
  | "currency"
  | "number"
  | "date"
  | "datetime"
  | "boolean"
  | "text";

export interface StatusField {
  /** Key to read from the service's status object returned by /api/dev/sandbox. */
  key: string;
  label: string;
  format?: StatusFieldFormat;
}

export interface ServiceDisplay {
  label: string;
  /** Name of a lucide-react icon (mapped to a component in TimeMachineSection). */
  icon: string;
  /** One-line description of what this cron service does when fired. */
  description: string;
  statusFields: StatusField[];
}

/** Render order in the panel — roughly the cron-clock firing order. */
export const SERVICE_ORDER: ServiceKey[] = [
  "payg",
  "installment",
  "auto_extend",
  "deposit",
  "payg_reminder",
  "return_reminder",
  "daily_reminder",
];

export const SERVICE_DISPLAY: Record<ServiceKey, ServiceDisplay> = {
  payg: {
    label: "PAYG Accrual",
    icon: "Gauge",
    description:
      "Accrues pay-as-you-go daily/period charges to the ledger. No Stripe — ledger only.",
    statusFields: [
      { key: "accruals", label: "Accruals posted", format: "number" },
      { key: "totalCharged", label: "Total charged", format: "currency" },
      { key: "dayCount", label: "Days elapsed", format: "number" },
      { key: "nextAccrualAt", label: "Next accrual", format: "datetime" },
      { key: "rate", label: "Rate", format: "text" },
    ],
  },
  installment: {
    label: "Installment Payments",
    icon: "CalendarClock",
    description:
      "Charges due scheduled installments via a Stripe TEST PaymentIntent, settled inline (no webhook).",
    statusFields: [
      { key: "planStatus", label: "Plan status", format: "text" },
      { key: "installments", label: "Installments", format: "number" },
      { key: "open", label: "Open", format: "number" },
      { key: "paid", label: "Paid", format: "number" },
      { key: "nextOpenDue", label: "Next due", format: "date" },
      { key: "lastReminderSentAt", label: "Last reminder", format: "datetime" },
    ],
  },
  auto_extend: {
    label: "Auto-Extension",
    icon: "CalendarPlus",
    description:
      "Extends the rental and charges the next period (test PI, inline). Steps day-by-day, end_date in lockstep.",
    statusFields: [
      { key: "autoExtendStatus", label: "Status", format: "text" },
      { key: "chargeCount", label: "Periods charged", format: "number" },
      { key: "endDate", label: "End date", format: "date" },
      { key: "nextChargeAt", label: "Next charge", format: "datetime" },
      { key: "failedAttempts", label: "Failed attempts", format: "number" },
    ],
  },
  deposit: {
    label: "Deposit Holds",
    icon: "ShieldCheck",
    description:
      "Refreshes an expiring security-deposit authorization by re-creating a test hold. Self-reverts each run.",
    statusFields: [
      { key: "holdStatus", label: "Hold status", format: "text" },
      { key: "amount", label: "Hold amount", format: "currency" },
      { key: "expiresAt", label: "Hold expires", format: "datetime" },
      { key: "paymentIntentId", label: "Payment intent", format: "text" },
    ],
  },
  payg_reminder: {
    label: "PAYG Reminders",
    icon: "BellRing",
    description:
      "Sends a PAYG balance reminder with a test Stripe Checkout pay-link (creates a Pending payment).",
    statusFields: [
      { key: "reminderLogs", label: "Reminders sent", format: "number" },
      { key: "lastReminderSentAt", label: "Last sent", format: "datetime" },
      { key: "autoRemindersEnabled", label: "Reminders enabled", format: "boolean" },
    ],
  },
  return_reminder: {
    label: "Return Reminders",
    icon: "CalendarCheck",
    description:
      "Notifies the customer their rental return is due (email → SES no-op on staging).",
    statusFields: [
      { key: "returnReminderSentAt", label: "Reminder sent", format: "datetime" },
      { key: "endDate", label: "Return date", format: "date" },
      { key: "status", label: "Rental status", format: "text" },
    ],
  },
  daily_reminder: {
    label: "Daily Reminders",
    icon: "Bell",
    description:
      "Creates in-app reminder events for ledger entries due today. In-app only — no email/SMS.",
    statusFields: [
      { key: "reminderEvents", label: "Reminder events", format: "number" },
      { key: "charges", label: "Open charges", format: "number" },
      { key: "nextDue", label: "Next due", format: "date" },
    ],
  },
};
