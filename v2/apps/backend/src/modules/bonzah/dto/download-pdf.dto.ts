import { z } from 'zod';

export const downloadPdfSchema = z.object({
  dataId: z.coerce.number().int().positive(),
});

export type DownloadPdfDto = z.infer<typeof downloadPdfSchema>;
