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

// Base object — used for per-step picks. Refined version with cross-field validation
// is exported as `applySchema` below.
const applySchemaBase = z.object({
  // Step 1 — About you
  fullName: z.string().trim().min(2).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  licenceExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  yearsDriving: z.coerce.number().int().min(0).max(80),
  hasViolations: z.boolean(),
  violationsDescription: z.string().max(2000).optional(),

  // Step 3 — Rental intent
  purpose: z.enum(["uber", "lyft", "doordash", "instacart", "personal", "delivery", "other"]),
  ridesharePlatforms: z.array(z.string()).max(10).default([]),
  neededByDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rentalLengthTarget: z.enum(["daily", "weekly", "monthly"]),
  vehicleInterestType: z.enum(["specific", "class", "any"]),
  vehicleId: z.string().uuid().optional(),
  vehicleClass: z.string().optional(),
  startDate: isoDate,
  endDate: isoDate,

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

export const applySchema = applySchemaBase.refine(
  (d) => Date.parse(d.endDate) >= Date.parse(d.startDate),
  { path: ["endDate"], message: "End date must be on or after start date" },
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
