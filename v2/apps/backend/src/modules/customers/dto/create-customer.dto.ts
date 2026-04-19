import { z } from 'zod';
import { insertCustomerSchema } from '@drive247/database';
import { CustomerStatus } from '@drive247/shared-types';

export const createCustomerSchema = z
  .object({
    name: insertCustomerSchema.shape.name.min(1, 'Name is required').max(100),
    email: z
      .string()
      .trim()
      .email('Invalid email')
      .max(255)
      .optional()
      .nullable(),
    phone: z.string().trim().min(3).max(30).optional().nullable(),
    status: z.nativeEnum(CustomerStatus).default(CustomerStatus.ACTIVE),
  })
  .refine((data) => !!(data.email || data.phone), {
    message: 'Either email or phone is required',
    path: ['email'],
  });

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
