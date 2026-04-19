import { z } from 'zod';
import { RequiredDocumentType } from '@drive247/shared-types';

/**
 * Thresholds are nullable: `null` means "use platform default". Values
 * are stored on `tenants` as NUMERIC. Cross-field rule: auto-approve
 * must be strictly greater than review floor — refined below.
 */
export const updateSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    requiredDocumentType: z.nativeEnum(RequiredDocumentType).optional(),
    faceMatchAutoApprovePct: z
      .number()
      .min(0)
      .max(100)
      .nullable()
      .optional(),
    faceMatchReviewPct: z.number().min(0).max(100).nullable().optional(),
    minOcrConfidence: z.number().min(0).max(1).nullable().optional(),
  })
  .refine(
    (v) => {
      const a = v.faceMatchAutoApprovePct;
      const r = v.faceMatchReviewPct;
      if (a === undefined || r === undefined) return true;
      if (a === null || r === null) return true;
      return a > r;
    },
    {
      message:
        'Auto-approve percentage must be strictly greater than review percentage',
      path: ['faceMatchAutoApprovePct'],
    },
  );

export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;
