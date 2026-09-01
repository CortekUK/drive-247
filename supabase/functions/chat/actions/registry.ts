// Action registry for Trax AI
// Each action defines its OpenAI tool schema, RBAC rules, and execute logic

import { ToolDefinition } from '../../_shared/openai.ts';

export interface ActionContext {
  supabase: any; // SupabaseClient (service_role)
  tenantId: string;
  userId: string;
  appUser: { id: string; role: string; name: string | null; email: string };
  currencyCode: string;
}

export interface ActionProposal {
  actionId: string;
  actionName: string;
  displayTitle: string;
  summary: string;
  details: Record<string, string>;
  destructive: boolean;
  resolvedParams: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  message: string;
  entityType?: string;
  entityId?: string;
}

export interface ActionDefinition {
  name: string;
  description: string;
  minRoles: string[]; // Roles that can use this action
  confirmationRequired: boolean;
  destructive: boolean;
  parameters: Record<string, unknown>; // JSON Schema for OpenAI
  resolve: (params: Record<string, unknown>, ctx: ActionContext) => Promise<ActionProposal | string>;
  execute: (resolvedParams: Record<string, unknown>, ctx: ActionContext) => Promise<ActionResult>;
}

// Import actions
import { createReminderAction } from './create-reminder.ts';

// All registered actions
const ALL_ACTIONS: ActionDefinition[] = [
  createReminderAction,
];

/**
 * Get the OpenAI tool definitions filtered by user role
 */
export function getToolsForRole(role: string): ToolDefinition[] {
  return ALL_ACTIONS
    .filter((action) => action.minRoles.includes(role))
    .map((action) => ({
      type: 'function' as const,
      function: {
        name: action.name,
        description: action.description,
        parameters: action.parameters,
      },
    }));
}

/**
 * Find an action by name
 */
export function getAction(name: string): ActionDefinition | undefined {
  return ALL_ACTIONS.find((a) => a.name === name);
}
