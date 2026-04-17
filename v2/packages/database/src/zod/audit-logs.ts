import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { auditLogs } from '../schema';

export const insertAuditLogSchema = createInsertSchema(auditLogs);
export const selectAuditLogSchema = createSelectSchema(auditLogs);
