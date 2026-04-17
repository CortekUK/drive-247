import { z } from 'zod';
import { insertAppUserSchema } from '@drive247/database';

export const loginSchema = z.object({
  email: insertAppUserSchema.shape.email,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type LoginDto = z.infer<typeof loginSchema>;
