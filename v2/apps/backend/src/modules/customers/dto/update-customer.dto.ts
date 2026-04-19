import { z } from 'zod';
import { CustomerStatus } from '@drive247/shared-types';

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z
      .string()
      .trim()
      .email('Invalid email')
      .max(255)
      .optional()
      .nullable(),
    phone: z.string().trim().min(3).max(30).optional().nullable(),
    status: z.nativeEnum(CustomerStatus).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;
