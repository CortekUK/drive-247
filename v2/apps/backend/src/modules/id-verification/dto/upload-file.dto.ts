import { z } from 'zod';

export const uploadFileFieldSchema = z.enum([
  'document_front',
  'document_back',
  'selfie',
]);

export type UploadFileField = z.infer<typeof uploadFileFieldSchema>;

export const uploadFileBodySchema = z.object({
  field: uploadFileFieldSchema,
});

export type UploadFileBodyDto = z.infer<typeof uploadFileBodySchema>;
