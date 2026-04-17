import { z } from 'zod';

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email('Invalid email').optional(),
    phone: z.string().max(20).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
