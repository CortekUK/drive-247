import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { refreshTokens } from '../schema';

export const insertRefreshTokenSchema = createInsertSchema(refreshTokens);
export const selectRefreshTokenSchema = createSelectSchema(refreshTokens);
