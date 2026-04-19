import { z } from 'zod';
import { ReminderSeverity } from '@drive247/shared-types';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from '@drive247/shared-types';

export const listRemindersSchema = z.object({
  ruleCode: z.string().trim().max(100).optional(),
  severity: z.nativeEnum(ReminderSeverity).optional(),
  resolved: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type ListRemindersDto = z.infer<typeof listRemindersSchema>;
