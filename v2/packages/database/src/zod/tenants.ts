import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { tenants } from '../schema';

export const insertTenantSchema = createInsertSchema(tenants);
export const selectTenantSchema = createSelectSchema(tenants);
