import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['head_admin', 'admin', 'manager', 'ops', 'viewer']),
  password: z.string().min(8),
  permissions: z
    .array(
      z.object({
        tabKey: z.string(),
        accessLevel: z.enum(['viewer', 'editor']),
      }),
    )
    .optional(),
});

export const updateRoleSchema = z.object({
  role: z.enum(['head_admin', 'admin', 'manager', 'ops', 'viewer']),
  permissions: z
    .array(
      z.object({
        tabKey: z.string(),
        accessLevel: z.enum(['viewer', 'editor']),
      }),
    )
    .optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
