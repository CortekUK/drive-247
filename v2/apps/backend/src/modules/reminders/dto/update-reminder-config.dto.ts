import { z } from 'zod';

export const updateReminderConfigSchema = z.object({
  configValue: z.record(z.string(), z.unknown()),
});

export type UpdateReminderConfigDto = z.infer<typeof updateReminderConfigSchema>;
