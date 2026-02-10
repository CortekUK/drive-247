import { formatCurrency } from "@/lib/format-utils";

export interface ReminderContext {
  // Vehicle context
  vehicle_id?: string;
  reg?: string;
  make?: string;
  model?: string;
  
  // Customer context
  customer_id?: string;
  customer_name?: string;
  
  // Rental context
  rental_id?: string;
  
  // Fine context
  fine_id?: string;
  reference?: string;
  
  // Document context
  policy_no?: string;
  provider?: string;
  
  // Dates
  due_date?: string;
  
  // Amounts
  amount?: number;
  overdue_total?: number;
  oldest_due_date?: string;
  
  // Other
  days_until?: number;
  days_overdue?: number;
  acquisition_date?: string;
  days_since_acquisition?: number;

  // Currency
  currencyCode?: string;
}

export function getTitleTemplate(ruleCode: string, context: ReminderContext): string {
  const templates: Record<string, (ctx: ReminderContext) => string> = {
    // Vehicle Inspection reminders
    VEH_MOT_30D: (ctx) => `Inspection due soon — ${ctx.reg} (30 days)`,
    VEH_MOT_14D: (ctx) => `Inspection due soon — ${ctx.reg} (14 days)`,
    VEH_MOT_7D: (ctx) => `Inspection due soon — ${ctx.reg} (7 days)`,
    VEH_MOT_0D: (ctx) => `Inspection due today — ${ctx.reg}`,

    // Vehicle Registration reminders
    VEH_TAX_30D: (ctx) => `Registration due soon — ${ctx.reg} (30 days)`,
    VEH_TAX_14D: (ctx) => `Registration due soon — ${ctx.reg} (14 days)`,
    VEH_TAX_7D: (ctx) => `Registration due soon — ${ctx.reg} (7 days)`,
    VEH_TAX_0D: (ctx) => `Registration due today — ${ctx.reg}`,
    
    // Vehicle WARRANTY reminders
    VEH_WARRANTY_30D: (ctx) => `Warranty expiring — ${ctx.reg} (30 days)`,
    VEH_WARRANTY_14D: (ctx) => `Warranty expiring — ${ctx.reg} (14 days)`,
    VEH_WARRANTY_7D: (ctx) => `Warranty expiring — ${ctx.reg} (7 days)`,
    VEH_WARRANTY_0D: (ctx) => `Warranty expires today — ${ctx.reg}`,
    
    // Insurance expiry reminders
    INS_EXP_30D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (30 days)`,
    INS_EXP_14D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (14 days)`,
    INS_EXP_7D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (7 days)`,
    INS_EXP_0D: (ctx) => `Insurance expires today — ${ctx.customer_name} (${ctx.reg})`,
    
    // Insurance verification reminders
    INS_VERIFY_7D: (ctx) => `Verify insurance for ${ctx.reg}`,
    INS_VERIFY_14D: (ctx) => `Verify insurance for ${ctx.reg}`,
    INS_VERIFY_30D: (ctx) => `Verify insurance for ${ctx.reg}`,
    
    // Document expiry reminders
    DOC_EXP_30D: (ctx) => `Document expiring — ${ctx.customer_name} (30 days)`,
    DOC_EXP_14D: (ctx) => `Document expiring — ${ctx.customer_name} (14 days)`,
    DOC_EXP_7D: (ctx) => `Document expiring — ${ctx.customer_name} (7 days)`,
    DOC_EXP_0D: (ctx) => `Document expires today — ${ctx.customer_name}`,
    
    // Rental overdue reminders
    RENT_OVERDUE: (ctx) => `Overdue rental balance — ${ctx.customer_name} (${ctx.reg})`,
    
    // Fine due reminders
    FINE_DUE_14D: (ctx) => `Fine due soon — ${ctx.reg} (${ctx.reference}) (14 days)`,
    FINE_DUE_7D: (ctx) => `Fine due soon — ${ctx.reg} (${ctx.reference}) (7 days)`,
    FINE_DUE_0D: (ctx) => `Fine due today — ${ctx.reg} (${ctx.reference})`,
    
    // Immobilizer fitting reminders
    IMM_FIT_30D: (ctx) => `Fit immobilizer — ${ctx.reg} (30 days since acquisition)`,
    IMM_FIT_14D: (ctx) => `Fit immobilizer — ${ctx.reg} (14 days since acquisition)`,
    IMM_FIT_7D: (ctx) => `Fit immobilizer — ${ctx.reg} (7 days since acquisition)`,
    IMM_FIT_0D: (ctx) => `Fit immobilizer — ${ctx.reg} (overdue)`,
  };
  
  const template = templates[ruleCode];
  return template ? template(context) : `Reminder: ${ruleCode}`;
}

export function getMessageTemplate(ruleCode: string, context: ReminderContext): string {
  const templates: Record<string, (ctx: ReminderContext) => string> = {
    // Vehicle Inspection reminders
    VEH_MOT_30D: (ctx) => `Inspection for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Please schedule inspection soon.`,
    VEH_MOT_14D: (ctx) => `Inspection for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Please schedule inspection immediately.`,
    VEH_MOT_7D: (ctx) => `Inspection for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Schedule inspection urgently!`,
    VEH_MOT_0D: (ctx) => `Inspection for ${ctx.reg} (${ctx.make} ${ctx.model}) due today (${ctx.due_date}). Immediate action required!`,

    // Vehicle Registration reminders
    VEH_TAX_30D: (ctx) => `Registration for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew soon.`,
    VEH_TAX_14D: (ctx) => `Registration for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew immediately.`,
    VEH_TAX_7D: (ctx) => `Registration for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew urgently!`,
    VEH_TAX_0D: (ctx) => `Registration for ${ctx.reg} (${ctx.make} ${ctx.model}) due today (${ctx.due_date}). Immediate action required!`,
    
    // Vehicle WARRANTY reminders
    VEH_WARRANTY_30D: (ctx) => `Warranty for ${ctx.reg} (${ctx.make} ${ctx.model}) expires on ${ctx.due_date}. Consider renewal.`,
    VEH_WARRANTY_14D: (ctx) => `Warranty for ${ctx.reg} (${ctx.make} ${ctx.model}) expires on ${ctx.due_date}. Review coverage.`,
    VEH_WARRANTY_7D: (ctx) => `Warranty for ${ctx.reg} (${ctx.make} ${ctx.model}) expires on ${ctx.due_date}. Check renewal options!`,
    VEH_WARRANTY_0D: (ctx) => `Warranty for ${ctx.reg} (${ctx.make} ${ctx.model}) expires today (${ctx.due_date}). Review coverage immediately!`,
    
    // Insurance expiry reminders
    INS_EXP_30D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Contact ${ctx.provider} to renew.`,
    INS_EXP_14D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Renew immediately with ${ctx.provider}.`,
    INS_EXP_7D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Urgent renewal required!`,
    INS_EXP_0D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires today (${ctx.due_date}). Immediate action required!`,
    
    // Insurance verification reminders
    INS_VERIFY_7D: (ctx) => `Please verify that insurance is still active for vehicle ${ctx.reg} rented by ${ctx.customer_name}.`,
    INS_VERIFY_14D: (ctx) => `Please verify that insurance is still active for vehicle ${ctx.reg} rented by ${ctx.customer_name}.`,
    INS_VERIFY_30D: (ctx) => `Please verify that insurance is still active for vehicle ${ctx.reg} rented by ${ctx.customer_name}.`,
    
    // Document expiry reminders
    DOC_EXP_30D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Please request renewal.`,
    DOC_EXP_14D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Request renewal immediately.`,
    DOC_EXP_7D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Urgent renewal required!`,
    DOC_EXP_0D: (ctx) => `Document for ${ctx.customer_name} expires today (${ctx.due_date}). Immediate action required!`,
    
    // Rental overdue reminders
    RENT_OVERDUE: (ctx) => `${formatCurrency(ctx.overdue_total || 0, ctx.currencyCode)} overdue since ${ctx.oldest_due_date}. Review ledger & contact customer.`,

    // Fine due reminders
    FINE_DUE_14D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0, ctx.currencyCode)}) due on ${ctx.due_date}. Prepare payment or appeal.`,
    FINE_DUE_7D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0, ctx.currencyCode)}) due on ${ctx.due_date}. Urgent action required!`,
    FINE_DUE_0D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0, ctx.currencyCode)}) due today (${ctx.due_date}). Immediate payment required!`,
    
    // Immobiliser fitting reminders
    IMM_FIT_30D: (ctx) => `Vehicle ${ctx.reg} (${ctx.make} ${ctx.model}) acquired on ${ctx.acquisition_date} needs an immobilizer fitted. Please schedule installation.`,
    IMM_FIT_14D: (ctx) => `Vehicle ${ctx.reg} (${ctx.make} ${ctx.model}) has been without an immobilizer for ${ctx.days_since_acquisition} days. Schedule fitting urgently.`,
    IMM_FIT_7D: (ctx) => `Vehicle ${ctx.reg} (${ctx.make} ${ctx.model}) urgently needs an immobilizer fitted - ${ctx.days_since_acquisition} days since acquisition.`,
    IMM_FIT_0D: (ctx) => `Vehicle ${ctx.reg} (${ctx.make} ${ctx.model}) is overdue for immobilizer fitting - acquired ${ctx.days_since_acquisition} days ago. Immediate action required!`,
  };
  
  const template = templates[ruleCode];
  return template ? template(context) : `Reminder for ${ruleCode}`;
}

export function getSeverityForRule(ruleCode: string): 'info' | 'warning' | 'critical' {
  if (ruleCode.includes('_30D') || ruleCode.includes('_14D')) {
    return 'warning';
  }
  if (ruleCode.includes('_7D') || ruleCode.includes('_0D') || ruleCode.includes('OVERDUE')) {
    return 'critical';
  }
  return 'info';
}
