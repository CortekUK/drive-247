import { z } from 'zod';
import { RequiredDocumentType } from '@drive247/shared-types';

export const createSessionSchema = z.object({
  customerId: z.string().uuid(),
  /** Override the tenant-default required document type for this session. */
  requiredDocumentType: z.nativeEnum(RequiredDocumentType).optional(),
});

export type CreateSessionDto = z.infer<typeof createSessionSchema>;
