// Client-safe DISPLAY manifest for the Time Machine multi-service sandbox.
//
// This file is SAFE TO SHIP TO THE BROWSER. It contains ONLY presentation
// metadata — labels, lucide icon names, and which status fields to render for
// each cron-driven service. It performs NO queries and holds NO Supabase keys,
// service roles, project refs, or fixture IDs. All of that lives server-side in
// `app/api/dev/sandbox/*`. The panel reads the per-service `status` object the
// server route returns and renders the fields named here.

export type ServiceKey =
  | "deposit"
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
  "deposit",
  "return_reminder",
  "daily_reminder",
];

export const SERVICE_DISPLAY: Record<ServiceKey, ServiceDisplay> = {
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
