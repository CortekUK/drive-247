import { z } from 'zod';

const coverageShape = z.object({
  cdw: z.boolean(),
  rcli: z.boolean(),
  sli: z.boolean(),
  pai: z.boolean(),
});

export const calculatePremiumSchema = z
  .object({
    tripStartDate: z.coerce.date(),
    tripEndDate: z.coerce.date(),
    pickupState: z.string().trim().min(2).max(2),
    coverage: coverageShape,
  })
  .refine((d) => d.tripEndDate >= d.tripStartDate, {
    message: 'Trip end date must be on or after start date',
    path: ['tripEndDate'],
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
  );

export type CalculatePremiumDto = z.infer<typeof calculatePremiumSchema>;
