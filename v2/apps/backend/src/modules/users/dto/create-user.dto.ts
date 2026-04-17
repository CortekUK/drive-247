import { z } from 'zod';
import { insertAppUserSchema } from '@drive247/database';

export const createUserSchema = z
  .object({
    email: insertAppUserSchema.shape.email,
    name: z.string().min(1, 'Name is required').max(100),
    role: insertAppUserSchema.shape.role,
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    permissions: z
      .array(
        z.object({
          tabKey: z.string().min(1),
          accessLevel: z.enum(['viewer', 'editor']),
        }),
      )
      .optional(),
  })
  .refine(
    (data) => data.role !== 'manager' || (data.permissions && data.permissions.length > 0),
    {
      message: 'Permissions are required when role is "manager"',
      path: ['permissions'],
    },
  );

export type CreateUserDto = z.infer<typeof createUserSchema>;
