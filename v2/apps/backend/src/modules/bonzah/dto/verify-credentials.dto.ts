import { z } from 'zod';
import { BonzahMode } from '@drive247/shared-types';

export const verifyCredentialsSchema = z.object({
  username: z.string().trim().email('Bonzah username must be an email'),
  password: z.string().min(1),
  mode: z.nativeEnum(BonzahMode),
});

export type VerifyCredentialsDto = z.infer<typeof verifyCredentialsSchema>;
