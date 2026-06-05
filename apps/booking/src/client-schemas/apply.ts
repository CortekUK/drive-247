/**
 * Lead Application form schema — Section 6.2 of LEAD_MANAGEMENT_AND_AUTOMATIONS.pdf.
 * Shared between the booking app multi-step wizard and the `submit-application` edge function.
 * The edge function imports a Deno-compatible copy (zod is ESM-only and works in both runtimes).
 */
import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

const phoneSchema = z
  .string()
  .trim()
  .refine((val) => {
    const digits = (val.match(/\d/g) || []).length;
    return digits >= 7 && digits <= 15;
  }, "Please enter a valid phone number (7-15 digits)");

/** Earliest application age. Under 18 can't hold a licence in any jurisdiction we operate in. */
export const MIN_APPLICANT_AGE = 18;
/** Sanity upper bound — 120 yo applying for a rental is a typo, not a fact. */
export const MAX_APPLICANT_AGE = 100;

/** Compute integer age in years from an ISO YYYY-MM-DD birthdate. */
export function computeAge(isoBirthDate: string, today: Date = new Date()): number {
  const d = new Date(isoBirthDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return NaN;
  let age = today.getFullYear() - d.getFullYear();
  const monthDiff = today.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

/** Format Date or "today" as YYYY-MM-DD in local time (HTML date inputs are local). */
export function isoToday(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Max DOB (must be in the past, at least MIN_APPLICANT_AGE years ago). */
export function isoMaxDateOfBirth(today: Date = new Date()): string {
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - MIN_APPLICANT_AGE);
  return isoToday(d);
}

/** Min DOB (sanity floor — MAX_APPLICANT_AGE years ago). */
export function isoMinDateOfBirth(today: Date = new Date()): string {
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - MAX_APPLICANT_AGE);
  return isoToday(d);
}

/** DOB: ISO format, parseable, in the past, applicant is between MIN and MAX age inclusive. */
const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
  .refine((v) => {
    const age = computeAge(v);
    return Number.isFinite(age) && age >= MIN_APPLICANT_AGE;
  }, `You must be at least ${MIN_APPLICANT_AGE} years old to apply`)
  .refine((v) => {
    const age = computeAge(v);
    return Number.isFinite(age) && age <= MAX_APPLICANT_AGE;
  }, "Please enter a valid date of birth");

/** Future date with an upper sanity bound (years from today). */
function futureDateSchema(maxYearsAhead: number, label: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
    .refine((v) => v >= isoToday(), `${label} cannot be in the past`)
    .refine((v) => {
      const max = new Date();
      max.setFullYear(max.getFullYear() + maxYearsAhead);
      return Date.parse(v) <= max.getTime();
    }, `${label} is too far in the future`);
}

// Base object — used for per-step picks. Refined version with cross-field validation
// is exported as `applySchema` below.
const applySchemaBase = z.object({
  // Step 1 — About you
  fullName: z.string().trim().min(2).max(100),
  dateOfBirth: dateOfBirthSchema,
  email: z.string().email().max(255),
  phone: phoneSchema,
  addressLine1: z.string().min(2).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  postalCode: z.string().min(3).max(20),
  country: z.string().length(2).default("US"),

  // Step 2 — Driver
  licenceNumber: z.string().min(3).max(50),
  licenceState: z.string().min(2).max(100),
  licenceExpiry: futureDateSchema(30, "Licence expiry"),
  yearsDriving: z.coerce.number().int().min(0).max(80),
  hasViolations: z.boolean(),
  violationsDescription: z.string().max(2000).optional(),

  // Step 3 — Rental intent
  purpose: z.enum(["uber", "lyft", "doordash", "instacart", "personal", "delivery", "other"]),
  ridesharePlatforms: z.array(z.string()).max(10).default([]),
  neededByDate: futureDateSchema(2, "Needed-by date"),
  rentalLengthTarget: z.enum(["daily", "weekly", "monthly"]),
  vehicleInterestType: z.enum(["specific", "class", "any"]),
  vehicleId: z.string().uuid().optional(),
  vehicleClass: z.string().optional(),
  startDate: futureDateSchema(2, "Pickup date"),
  endDate: futureDateSchema(2, "Return date"),

  // Step 4 — Financial
  canPayDeposit: z.boolean(),
  depositComfortAmount: z.coerce.number().int().min(0).optional(),
  weeklyBudget: z.coerce.number().int().min(0).optional(),

  // Step 5 — History
  rentedBefore: z.boolean(),
  rentedFromUsBefore: z.boolean(),
  rideshareAccountActive: z.boolean(),
  rideshareTier: z.string().max(100).optional(),

  // Step 6 — Documents (paths to uploaded storage objects, optional at submit time
  // but enforced as required server-side per tenant policy in V2)
  licencePhotoUrl: z.string().url().optional(),
  selfieUrl: z.string().url().optional(),
  rideshareProofUrl: z.string().url().optional(),

  // Step 7 — Review
  termsAccepted: z.literal(true),
  marketingConsent: z.boolean().default(false),

  // Honeypot — silently swallow if filled
  hpField: z.string().optional(),
});

export const applySchema = applySchemaBase
  .refine((d) => Date.parse(d.endDate) >= Date.parse(d.startDate), {
    path: ["endDate"],
    message: "End date must be on or after start date",
  })
  .refine(
    (d) => {
      // Years-driving cannot exceed (age - 16). 16 is the earliest plausible licence age.
      const age = computeAge(d.dateOfBirth);
      if (!Number.isFinite(age)) return true;
      const maxYearsDriving = Math.max(0, age - 16);
      return d.yearsDriving <= maxYearsDriving;
    },
    {
      path: ["yearsDriving"],
      message: "Years driving cannot exceed your age minus 16",
    },
  );

export type ApplyFormValues = z.infer<typeof applySchema>;

// Per-step partial schemas for the wizard's per-step validation.
// Each step validates a subset of fields before allowing "Next".
export const step1Schema = applySchemaBase.pick({
  fullName: true,
  dateOfBirth: true,
  email: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
});

export const step2Schema = applySchemaBase.pick({
  licenceNumber: true,
  licenceState: true,
  licenceExpiry: true,
  yearsDriving: true,
  hasViolations: true,
  violationsDescription: true,
});

export const step3Schema = applySchemaBase
  .pick({
    purpose: true,
    ridesharePlatforms: true,
    neededByDate: true,
    rentalLengthTarget: true,
    vehicleInterestType: true,
    vehicleId: true,
    vehicleClass: true,
    startDate: true,
    endDate: true,
  })
  .refine((d) => Date.parse(d.endDate) >= Date.parse(d.startDate), {
    path: ["endDate"],
    message: "End date must be on or after start date",
  });

export const step4Schema = applySchemaBase.pick({
  canPayDeposit: true,
  depositComfortAmount: true,
  weeklyBudget: true,
});

export const step5Schema = applySchemaBase.pick({
  rentedBefore: true,
  rentedFromUsBefore: true,
  rideshareAccountActive: true,
  rideshareTier: true,
});

export const step6Schema = applySchemaBase.pick({
  licencePhotoUrl: true,
  selfieUrl: true,
  rideshareProofUrl: true,
});

export const step7Schema = applySchemaBase.pick({
  termsAccepted: true,
  marketingConsent: true,
});

export const STEP_SCHEMAS = [
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6Schema,
  step7Schema,
] as const;

export const STEP_TITLES = [
  "About you",
  "Driver details",
  "Rental intent",
  "Financial readiness",
  "Rental history",
  "Documents",
  "Review & submit",
] as const;
