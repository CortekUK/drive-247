import { z } from 'zod';

/**
 * Quote creation payload.
 *
 * Age validation against `trip_start_date` is enforced in the service
 * (rule #4) because `trip_start_date` is read from the rental row, not
 * the DTO. Shape validation here; cross-entity rule in the service layer.
 */

const coverageShape = z.object({
  cdw: z.boolean(),
  rcli: z.boolean(),
  sli: z.boolean(),
  pai: z.boolean(),
});

const renterAddressShape = z.object({
  street: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(50),
  state: z.string().trim().length(2),
  zip: z.string().trim().min(5).max(10),
});

const renterLicenseShape = z.object({
  number: z.string().trim().min(1).max(50),
  state: z.string().trim().length(2),
});

const renterShape = z.object({
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  dob: z.coerce.date(),
  email: z.string().trim().email().max(255),
  phone: z
    .string()
    .trim()
    .regex(
      /^\d{11}$/,
      'Phone must be 11 digits: country code (no +) + mobile number',
    ),
  address: renterAddressShape,
  license: renterLicenseShape,
});

export const createQuoteSchema = z
  .object({
    rentalId: z.string().uuid(),
    coverage: coverageShape,
    pickupState: z.string().trim().length(2),
    renter: renterShape,
  })
  .refine((c) => !(c.coverage.sli && !c.coverage.rcli), {
    message: 'SLI requires RCLI (SLI is not a standalone policy)',
    path: ['coverage', 'sli'],
  })
  .refine(
    (c) =>
      c.coverage.cdw || c.coverage.rcli || c.coverage.sli || c.coverage.pai,
    {
      message: 'At least one coverage must be selected',
      path: ['coverage'],
    },
  )
  .refine((c) => c.renter.dob.getTime() < Date.now(), {
    message: 'Date of birth cannot be in the future',
    path: ['renter', 'dob'],
  });

export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;
