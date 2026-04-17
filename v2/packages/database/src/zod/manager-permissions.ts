import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { managerPermissions } from '../schema';

export const insertManagerPermissionSchema =
  createInsertSchema(managerPermissions);
export const selectManagerPermissionSchema =
  createSelectSchema(managerPermissions);
