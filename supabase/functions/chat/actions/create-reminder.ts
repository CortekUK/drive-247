// Action: Create a reminder
// Lets the AI create reminders for vehicles, customers, rentals, etc.

import type { ActionDefinition, ActionContext, ActionProposal, ActionResult } from './registry.ts';

export const createReminderAction: ActionDefinition = {
  name: 'create_reminder',
  description: 'Create a new reminder for the user. Use this when the user asks you to remind them about something, set a reminder, or create a follow-up. Can be linked to a customer, vehicle, or rental if mentioned.',
  minRoles: ['head_admin', 'admin', 'manager', 'ops'],
  confirmationRequired: true,
  destructive: false,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short title for the reminder (e.g., "Follow up with John about payment")',
      },
      message: {
        type: 'string',
        description: 'Detailed reminder message with context',
      },
      due_date: {
        type: 'string',
        description: 'When this reminder is due, in YYYY-MM-DD format. Calculate from today if the user says "in 3 days", "next week", etc.',
      },
      severity: {
        type: 'string',
        enum: ['info', 'warning', 'critical'],
        description: 'Urgency level. Default to "info" for general reminders, "warning" for time-sensitive, "critical" for urgent.',
      },
      object_type: {
        type: 'string',
        enum: ['Customer', 'Vehicle', 'Rental', 'Fine', 'Document'],
        description: 'Type of entity this reminder is about, if applicable.',
      },
      customer_name: {
        type: 'string',
        description: 'Name of the customer this reminder is about, if mentioned. Used to look up the customer.',
      },
      vehicle_reg: {
        type: 'string',
        description: 'Registration plate of the vehicle this reminder is about, if mentioned.',
      },
    },
    required: ['title', 'message', 'due_date'],
  },

  async resolve(params: Record<string, unknown>, ctx: ActionContext): Promise<ActionProposal | string> {
    const { supabase, tenantId } = ctx;
    const title = params.title as string;
    const message = params.message as string;
    const dueDate = params.due_date as string;
    const severity = (params.severity as string) || 'info';
    const objectType = params.object_type as string | undefined;
    const customerName = params.customer_name as string | undefined;
    const vehicleReg = params.vehicle_reg as string | undefined;

    // Build details for the confirmation card
    const details: Record<string, string> = {
      'Due date': formatDisplayDate(dueDate),
      'Severity': severity.charAt(0).toUpperCase() + severity.slice(1),
    };

    let objectId: string | null = null;
    let resolvedObjectType = objectType || null;
    const context: Record<string, unknown> = {};

    // Try to resolve customer
    if (customerName) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id, name, email')
        .eq('tenant_id', tenantId)
        .ilike('name', `%${customerName}%`)
        .limit(5);

      if (customers && customers.length === 1) {
        objectId = customers[0].id;
        resolvedObjectType = resolvedObjectType || 'Customer';
        context.customer_id = customers[0].id;
        context.customer_name = customers[0].name;
        details['Customer'] = customers[0].name;
      } else if (customers && customers.length > 1) {
        const names = customers.map((c: { name: string }) => c.name).join(', ');
        return `I found multiple customers matching "${customerName}": ${names}. Could you be more specific about which one?`;
      } else if (customerName) {
        // No match found, still include the name in context
        context.customer_name = customerName;
        details['Customer'] = `${customerName} (not found in system)`;
      }
    }

    // Try to resolve vehicle
    if (vehicleReg) {
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id, reg, make, model')
        .eq('tenant_id', tenantId)
        .ilike('reg', `%${vehicleReg}%`)
        .limit(5);

      if (vehicles && vehicles.length === 1) {
        objectId = objectId || vehicles[0].id;
        resolvedObjectType = resolvedObjectType || 'Vehicle';
        context.vehicle_id = vehicles[0].id;
        context.reg = vehicles[0].reg;
        details['Vehicle'] = `${vehicles[0].reg} ${vehicles[0].make || ''} ${vehicles[0].model || ''}`.trim();
      } else if (vehicles && vehicles.length > 1) {
        const regs = vehicles.map((v: { reg: string }) => v.reg).join(', ');
        return `I found multiple vehicles matching "${vehicleReg}": ${regs}. Which one did you mean?`;
      }
    }

    return {
      actionId: crypto.randomUUID(),
      actionName: 'create_reminder',
      displayTitle: 'Create Reminder',
      summary: title,
      details,
      destructive: false,
      resolvedParams: {
        title,
        message,
        due_date: dueDate,
        severity,
        object_type: resolvedObjectType || 'Customer',
        object_id: objectId || tenantId, // fallback to tenant ID for general reminders
        context,
      },
    };
  },

  async execute(resolvedParams: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
    const { supabase, tenantId } = ctx;

    const dueDate = resolvedParams.due_date as string;
    const reminderData = {
      tenant_id: tenantId,
      rule_code: `AI_${crypto.randomUUID().substring(0, 8).toUpperCase()}`,
      object_type: resolvedParams.object_type as string,
      object_id: resolvedParams.object_id as string,
      title: resolvedParams.title as string,
      message: resolvedParams.message as string,
      due_on: dueDate,
      remind_on: dueDate, // remind on the due date itself
      severity: resolvedParams.severity as string,
      status: 'pending',
      context: resolvedParams.context || {},
    };

    const { data, error } = await supabase
      .from('reminders')
      .insert(reminderData)
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create reminder:', error);
      return {
        success: false,
        message: `Failed to create reminder: ${error.message}`,
      };
    }

    return {
      success: true,
      message: `Reminder created: "${resolvedParams.title}" — due ${formatDisplayDate(dueDate)}.`,
      entityType: 'reminder',
      entityId: data.id,
    };
  },
};

function formatDisplayDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
