import { z } from 'zod';
import { insertAppUserSchema } from '@drive247/database';

export const updateRoleSchema = z
  .object({
    role: insertAppUserSchema.shape.role,
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

export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
