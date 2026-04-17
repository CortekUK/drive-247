import { z } from 'zod';
import { insertTenantSchema } from '@drive247/database';
import {
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
  SLUG_REGEX,
} from '@drive247/shared-types';

export const updateTenantSchema = z
  .object({
    companyName: insertTenantSchema.shape.companyName.min(1).optional(),
    slug: insertTenantSchema.shape.slug
      .min(SLUG_MIN_LENGTH)
      .max(SLUG_MAX_LENGTH)
      .regex(SLUG_REGEX)
      .optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().max(20).nullable().optional(),
    adminName: z.string().max(100).nullable().optional(),
    status: insertTenantSchema.shape.status.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;
