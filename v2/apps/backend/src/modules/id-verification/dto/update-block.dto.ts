import { z } from 'zod';

export const updateBlockSchema = z
  .object({
    reason: z.string().trim().min(3).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.reason !== undefined || v.isActive !== undefined, {
    message: 'At least one of reason or isActive must be provided',
  });

export type UpdateBlockDto = z.infer<typeof updateBlockSchema>;
