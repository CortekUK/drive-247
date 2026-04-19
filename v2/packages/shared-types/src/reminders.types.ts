import type { ReminderSeverity } from './enums';
import type { ReminderRuleCode } from './constants';

export type ReminderResponse = {
  id: string;
  tenantId: string;
  ruleCode: string;
  objectType: string;
  objectId: string | null;
  title: string;
  message: string;
  severity: ReminderSeverity;
  context: Record<string, unknown> | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReminderListQuery = {
  ruleCode?: ReminderRuleCode;
  severity?: ReminderSeverity;
  resolved?: boolean;
  page?: number;
  limit?: number;
};

export type ReminderListResponse = {
  items: ReminderResponse[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
};

export type ReminderConfigResponse = {
  configKey: string;
  configValue: Record<string, unknown>;
};

export type UpdateReminderConfigPayload = {
  configValue: Record<string, unknown>;
};
