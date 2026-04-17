import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { permissionAccessLevelEnum } from './enums';
import { appUsers } from './app-users';

export const managerPermissions = pgTable(
  'manager_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    appUserId: uuid('app_user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    tabKey: text('tab_key').notNull(),
    accessLevel: permissionAccessLevelEnum('access_level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('manager_permissions_user_tab_idx').on(
      table.appUserId,
      table.tabKey,
    ),
  ],
);
