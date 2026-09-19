/**
 * Notifications v2: the variables a notification template can use.
 *
 * A template is plain text (push, in-app, email subject) or the editor's HTML
 * (email body) with `{{key}}` placeholders. The keys below reuse the server's
 * existing names wherever one exists, so a template written on this page keeps
 * working when sending moves over to the per-notification settings:
 *   - `supabase/functions/_shared/email-template-service.ts` `resolveEmailData`
 *     and `DEFAULT_EMAIL_TEMPLATES` (customer_*, vehicle_*, rental_*,
 *     company_*, due_date, previous_end_date, new_end_date, extension_*,
 *     outstanding_amount, invoice_ref, days_active, payment_url, ...);
 *   - `apps/portal/src/lib/email-template-variables.ts` (the same keys, plus
 *     payment_amount and refund_amount).
 * Keys the server does not have yet (signing_url, portal_url, deposit_amount,
 * ...) are new and are marked as such in their description comment.
 *
 * The examples describe ONE fictional booking, so every preview reads as the
 * same story: Jordan Ellis rents a 2024 Toyota RAV4 (8KXR512) for seven days,
 * booking R-3F9A2C, $700.00 at $100.00 a day.
 *
 * No React and no Supabase here. v2 only: nothing in v1 imports this file.
 */

import { formatCurrency } from "@/lib/format-utils";
import type { EmailBrand, NotificationVariable } from "./types";

/* -------------------------------------------------------------------------- */
/* The example booking                                                         */
/* -------------------------------------------------------------------------- */

/** Amounts in the example booking, formatted in the tenant's currency. */
const EXAMPLE_AMOUNTS = {
  rental_amount: 700, // 7 days × 100
  payment_amount: 700,
  refund_amount: 150,
  deposit_amount: 500,
  extension_amount: 400, // 4 days × 100
  outstanding_amount: 300,
  fine_amount: 65,
  toll_total: 42.5,
  insurance_premium: 84,
  insurance_balance: 12.5,
} as const;

type AmountKey = keyof typeof EXAMPLE_AMOUNTS;

const EXAMPLE_COMPANY = {
  name: "Coastline Car Rentals",
  email: "hello@coastlinerentals.com",
  phone: "+1 (415) 555-0100",
  slug: "coastline",
};

const EXAMPLE_RENTAL_ID = "3f9a2c1e-7b4d-4c2a-9e51-0d6b8a7c4f21";
const EXAMPLE_CUSTOMER_ID = "b8e4d2a0-5c3f-4e71-8a9d-2f6c1b0e7d35";

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every variable a notification template may use. `example` is the USD /
 * default-company value; `exampleValues()` re-formats amounts and company
 * details for the tenant looking at the page.
 */
export const NOTIFICATION_VARIABLES: NotificationVariable[] = [
  /* Customer ---------------------------------------------------------------- */
  {
    key: "customer_name",
    label: "Customer name",
    description: "The customer's full name.",
    group: "customer",
    example: "Jordan Ellis",
  },
  {
    key: "customer_email",
    label: "Customer email",
    description: "The customer's email address.",
    group: "customer",
    example: "jordan.ellis@example.com",
  },
  {
    key: "customer_phone",
    label: "Customer phone",
    description: "The customer's phone number.",
    group: "customer",
    example: "+1 (415) 555-0142",
  },
  {
    // New: send-additional-driver-invite greets the driver, not the renter.
    key: "driver_name",
    label: "Additional driver name",
    description: "The name of the extra driver added to the rental.",
    group: "customer",
    example: "Sam Ellis",
  },

  /* Rental ------------------------------------------------------------------ */
  {
    key: "rental_number",
    label: "Booking reference",
    description: "The booking's reference, as shown in your portal.",
    group: "rental",
    example: "R-3F9A2C",
  },
  {
    key: "rental_start_date",
    label: "Pickup date",
    description: "The day the rental starts.",
    group: "rental",
    example: "October 3, 2026",
  },
  {
    key: "rental_end_date",
    label: "Return date",
    description: "The day the car is due back.",
    group: "rental",
    example: "October 10, 2026",
  },
  {
    key: "rental_period_type",
    label: "Rental period",
    description: "Daily, Weekly or Monthly.",
    group: "rental",
    example: "Daily",
  },
  {
    key: "pickup_location",
    label: "Pickup location",
    description: "Where the customer collects the car.",
    group: "rental",
    example: "120 Market Street, San Francisco",
  },
  {
    key: "due_date",
    label: "Due back",
    description: "When the car is due back, used by return reminders.",
    group: "rental",
    example: "October 10, 2026",
  },
  {
    key: "previous_end_date",
    label: "Old return date",
    description: "The return date before the rental was extended.",
    group: "rental",
    example: "October 10, 2026",
  },
  {
    key: "new_end_date",
    label: "New return date",
    description: "The return date after the rental was extended.",
    group: "rental",
    example: "October 14, 2026",
  },
  {
    key: "extension_days",
    label: "Extra days",
    description: "How many days the rental was extended by.",
    group: "rental",
    example: "4",
  },
  {
    key: "rejection_reason",
    label: "Reason",
    description: "The reason your team gave when declining a booking or a payment.",
    group: "rental",
    example: "The car isn't available for those dates.",
  },
  {
    // New: the three outcomes the identity trigger writes today.
    key: "verification_result",
    label: "ID check result",
    description: "Verified, Failed or Needs new documents.",
    group: "rental",
    example: "Verified",
  },
  {
    // New: submit-enquiry's `description`.
    key: "enquiry_message",
    label: "Enquiry message",
    description: "What the customer wrote in their enquiry.",
    group: "rental",
    example: "Is the RAV4 free for a week from October 3? I'd also need a child seat.",
  },
  {
    // New: send-contact-email's `subject`.
    key: "contact_subject",
    label: "Contact form subject",
    description: "The subject the visitor typed on your contact form.",
    group: "rental",
    example: "Airport pickup",
  },
  {
    // New: send-contact-email's `message`.
    key: "contact_message",
    label: "Contact form message",
    description: "The message the visitor typed on your contact form.",
    group: "rental",
    example: "Can I collect the car at the airport instead of your office?",
  },

  /* Vehicle ----------------------------------------------------------------- */
  {
    key: "vehicle_make",
    label: "Vehicle make",
    description: "The car's make, for example Toyota.",
    group: "vehicle",
    example: "Toyota",
  },
  {
    key: "vehicle_model",
    label: "Vehicle model",
    description: "The car's model, for example RAV4.",
    group: "vehicle",
    example: "RAV4",
  },
  {
    key: "vehicle_year",
    label: "Vehicle year",
    description: "The year the car was made.",
    group: "vehicle",
    example: "2024",
  },
  {
    key: "vehicle_reg",
    label: "Plate number",
    description: "The car's plate. Left blank if you hide plates from customers.",
    group: "vehicle",
    example: "8KXR512",
  },

  /* Money ------------------------------------------------------------------- */
  {
    key: "rental_amount",
    label: "Rental total",
    description: "The booking's total price.",
    group: "money",
    example: "$700.00",
  },
  {
    key: "payment_amount",
    label: "Payment amount",
    description: "The amount of this payment.",
    group: "money",
    example: "$700.00",
  },
  {
    key: "refund_amount",
    label: "Refund amount",
    description: "The amount refunded to the customer.",
    group: "money",
    example: "$150.00",
  },
  {
    // New: the hold amount add-hold-dialog emails today.
    key: "deposit_amount",
    label: "Deposit hold",
    description: "The security deposit held on the customer's card.",
    group: "money",
    example: "$500.00",
  },
  {
    key: "extension_amount",
    label: "Extension cost",
    description: "What the extra days cost.",
    group: "money",
    example: "$400.00",
  },
  {
    key: "outstanding_amount",
    label: "Amount owed",
    description: "What the customer still owes on this rental.",
    group: "money",
    example: "$300.00",
  },
  {
    key: "invoice_ref",
    label: "Invoice number",
    description: "The invoice this payment request is for.",
    group: "money",
    example: "INV-1042",
  },
  {
    key: "days_active",
    label: "Days on the road",
    description: "How many days a pay-as-you-go rental has been running.",
    group: "money",
    example: "5",
  },
  {
    // New: the fines trigger's amount.
    key: "fine_amount",
    label: "Fine amount",
    description: "The amount of the fine or penalty.",
    group: "money",
    example: "$65.00",
  },
  {
    // New: send-toll-report's `total`.
    key: "toll_total",
    label: "Toll total",
    description: "The total of the tolls on the statement.",
    group: "money",
    example: "$42.50",
  },
  {
    // New: bonzah-confirm-payment's premium.
    key: "insurance_premium",
    label: "Insurance premium",
    description: "The insurance price for this booking.",
    group: "money",
    example: "$84.00",
  },
  {
    // New: bonzah-confirm-payment's cd_balance.
    key: "insurance_balance",
    label: "Insurance balance",
    description: "What is left in your insurance account.",
    group: "money",
    example: "$12.50",
  },

  /* Company ----------------------------------------------------------------- */
  {
    key: "company_name",
    label: "Company name",
    description: "Your company name, as customers see it.",
    group: "company",
    example: EXAMPLE_COMPANY.name,
  },
  {
    key: "company_email",
    label: "Company email",
    description: "Your contact email address.",
    group: "company",
    example: EXAMPLE_COMPANY.email,
  },
  {
    key: "company_phone",
    label: "Company phone",
    description: "Your contact phone number.",
    group: "company",
    example: EXAMPLE_COMPANY.phone,
  },

  /* Links ------------------------------------------------------------------- */
  {
    key: "payment_url",
    label: "Payment link",
    description: "The secure page where the customer pays.",
    group: "links",
    example: "https://checkout.stripe.com/c/pay/cs_live_a1B2c3D4",
  },
  {
    // New: send-signing-email's `signingLink`.
    key: "signing_url",
    label: "Signing link",
    description: "The page where the customer signs the rental agreement.",
    group: "links",
    example: "https://app.boldsign.com/document/sign/?documentId=7c1e9a52",
  },
  {
    // New: the licence check / ID check link the customer or driver opens.
    key: "verification_url",
    label: "Verification link",
    description: "The page where the driver checks their licence or ID.",
    group: "links",
    example: `https://${EXAMPLE_COMPANY.slug}.drive-247.com/verify/k7Q2mX9p`,
  },
  {
    // New: the customer portal on the tenant's booking site.
    key: "customer_portal_url",
    label: "Customer portal link",
    description: "The customer's bookings page on your booking site.",
    group: "links",
    example: `https://${EXAMPLE_COMPANY.slug}.drive-247.com/portal/bookings`,
  },
  {
    // New: notify-operator-email's "View in portal" link.
    key: "portal_url",
    label: "Portal link",
    description: "Opens this booking in your portal. For your team only.",
    group: "links",
    example: `https://${EXAMPLE_COMPANY.slug}.portal.drive-247.com/rentals/${EXAMPLE_RENTAL_ID}`,
  },
  {
    // Only for `link` (the page a push or bell opens), never message text.
    key: "rental_id",
    label: "Rental ID",
    description: "Used in links to open the rental. Not meant for message text.",
    group: "links",
    example: EXAMPLE_RENTAL_ID,
  },
  {
    // Only for `link` (the page a push or bell opens), never message text.
    key: "customer_id",
    label: "Customer ID",
    description: "Used in links to open the customer. Not meant for message text.",
    group: "links",
    example: EXAMPLE_CUSTOMER_ID,
  },
];

const BY_KEY: ReadonlyMap<string, NotificationVariable> = new Map(
  NOTIFICATION_VARIABLES.map((v) => [v.key, v]),
);

/** The variable with this key, or undefined. */
export function getVariable(key: string): NotificationVariable | undefined {
  return BY_KEY.get(key);
}

/* -------------------------------------------------------------------------- */
/* Example values                                                              */
/* -------------------------------------------------------------------------- */

export interface ExampleValueOptions {
  /** ISO 4217 code for amounts, e.g. "GBP". Defaults to USD ("$700.00"). */
  currencyCode?: string | null;
  /** The tenant's slug, so example links point at their own sites. */
  slug?: string | null;
}

function slugFrom(companyName: string | null | undefined): string | null {
  const s = (companyName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return s.length >= 2 ? s.slice(0, 32) : null;
}

/**
 * One value per variable, for previews and test sends (§3.11 "700 USD").
 * Company details come from the tenant's branding when given, amounts use the
 * tenant's currency, and links use the tenant's slug. Every key in
 * `NOTIFICATION_VARIABLES` is present.
 */
export function exampleValues(
  brand?: Partial<EmailBrand> | null,
  opts?: ExampleValueOptions,
): Record<string, string> {
  const currency = (opts?.currencyCode || "USD").toUpperCase();
  const companyName = brand?.companyName?.trim() || EXAMPLE_COMPANY.name;
  const slug = opts?.slug?.trim() || slugFrom(brand?.companyName) || EXAMPLE_COMPANY.slug;

  const values: Record<string, string> = {};
  for (const v of NOTIFICATION_VARIABLES) values[v.key] = v.example;

  for (const key of Object.keys(EXAMPLE_AMOUNTS) as AmountKey[]) {
    values[key] = formatCurrency(EXAMPLE_AMOUNTS[key], currency);
  }

  values.company_name = companyName;
  values.company_email = brand?.contactEmail?.trim() || EXAMPLE_COMPANY.email;
  values.company_phone = brand?.contactPhone?.trim() || EXAMPLE_COMPANY.phone;
  values.verification_url = `https://${slug}.drive-247.com/verify/k7Q2mX9p`;
  values.customer_portal_url = `https://${slug}.drive-247.com/portal/bookings`;
  values.portal_url = `https://${slug}.portal.drive-247.com/rentals/${EXAMPLE_RENTAL_ID}`;
  return values;
}

/* -------------------------------------------------------------------------- */
/* Filling and checking                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `{{key}}`, exactly as the server's `replaceTemplateVariables` matches it (no
 * spaces inside the braces). Upper-case letters are matched too, so a typo such
 * as `{{Customer_Name}}` is reported as unknown instead of silently ignored.
 */
const VARIABLE_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Replaces every `{{key}}` that has a value. A key with no value (unknown, or
 * simply not supplied) stays visible as `{{key}}`, so a preview shows the
 * mistake instead of hiding it. With `html: true` the values are HTML-escaped,
 * because a customer's name is typed by the customer.
 */
export function fillVariables(
  text: string,
  values: Record<string, string>,
  opts?: { html?: boolean },
): string {
  if (!text) return "";
  return text.replace(VARIABLE_PATTERN, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    const value = values[key] ?? "";
    return opts?.html ? escapeHtml(String(value)) : String(value);
  });
}

/** Every distinct `{{key}}` in the text, in the order they first appear. */
export function extractVariables(text: string): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(VARIABLE_PATTERN)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/** The `{{key}}`s in the text that are not in `allowed`, each listed once. */
export function unknownVariables(text: string, allowed: readonly string[]): string[] {
  return extractVariables(text).filter((key) => !allowed.includes(key));
}
