import { z } from 'zod';
import { insertTenantSchema } from '@drive247/database';
import {
  RESERVED_SLUGS,
  SLUG_MIN_LENGTH,
  SLUG_MAX_LENGTH,
  SLUG_REGEX,
  MIN_PASSWORD_LENGTH,
} from '@drive247/shared-types';

export const createTenantSchema = z.object({
  companyName: insertTenantSchema.shape.companyName.min(1, 'Company name is required'),
  slug: insertTenantSchema.shape.slug
    .min(SLUG_MIN_LENGTH, `Slug must be at least ${SLUG_MIN_LENGTH} characters`)
    .max(SLUG_MAX_LENGTH)
    .regex(SLUG_REGEX, 'Slug must be lowercase, alphanumeric with hyphens, cannot start/end with hyphen')
    .refine((val) => !RESERVED_SLUGS.includes(val as any), {
      message: 'This slug is reserved',
    }),
  contactEmail: z.string().email('Invalid email'),
  adminName: z.string().min(1).max(100).optional(),
  tenantType: insertTenantSchema.shape.tenantType,
  adminEmail: z.string().email('Invalid admin email'),
  adminPassword: z.string().min(MIN_PASSWORD_LENGTH).max(128).optional(),
});

export type CreateTenantDto = z.infer<typeof createTenantSchema>;
