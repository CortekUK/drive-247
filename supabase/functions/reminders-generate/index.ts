import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReminderContext {
  vehicle_id?: string;
  reg?: string;
  make?: string;
  model?: string;
  customer_id?: string;
  customer_name?: string;
  rental_id?: string;
  fine_id?: string;
  reference?: string;
  policy_no?: string;
  provider?: string;
  due_date?: string;
  amount?: number;
  overdue_total?: number;
  oldest_due_date?: string;
  days_until?: number;
  days_overdue?: number;
  acquisition_date?: string;
  days_since_acquisition?: number;
}

function getTitleTemplate(ruleCode: string, context: ReminderContext): string {
  const templates: Record<string, (ctx: ReminderContext) => string> = {
    // MOT reminders
    MOT_30D: (ctx) => `MOT due soon — ${ctx.reg} (30 days)`,
    MOT_14D: (ctx) => `MOT due soon — ${ctx.reg} (14 days)`,
    MOT_7D: (ctx) => `MOT due soon — ${ctx.reg} (7 days)`,
    MOT_0D: (ctx) => `MOT due today — ${ctx.reg}`,
    
    // TAX reminders
    TAX_30D: (ctx) => `TAX due soon — ${ctx.reg} (30 days)`,
    TAX_14D: (ctx) => `TAX due soon — ${ctx.reg} (14 days)`,
    TAX_7D: (ctx) => `TAX due soon — ${ctx.reg} (7 days)`,
    TAX_0D: (ctx) => `TAX due today — ${ctx.reg}`,
    
    // Insurance reminders
    INS_30D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (30 days)`,
    INS_14D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (14 days)`,
    INS_7D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (7 days)`,
    INS_0D: (ctx) => `Insurance expires today — ${ctx.customer_name} (${ctx.reg})`,
    
    // Document reminders
    DOC_30D: (ctx) => `Document expiring — ${ctx.customer_name} (30 days)`,
    DOC_14D: (ctx) => `Document expiring — ${ctx.customer_name} (14 days)`,
    DOC_7D: (ctx) => `Document expiring — ${ctx.customer_name} (7 days)`,
    DOC_0D: (ctx) => `Document expires today — ${ctx.customer_name}`,
    
    // Fine reminders
    FINE_14D: (ctx) => `Fine due soon — ${ctx.reg} (${ctx.reference}) (14 days)`,
    FINE_7D: (ctx) => `Fine due soon — ${ctx.reg} (${ctx.reference}) (7 days)`,
    FINE_0D: (ctx) => `Fine due today — ${ctx.reg} (${ctx.reference})`,
    
    // Rental reminders
    RENT_1D: (ctx) => `Overdue rental balance — ${ctx.customer_name} (${ctx.reg}) (1 day)`,
    RENT_7D: (ctx) => `Overdue rental balance — ${ctx.customer_name} (${ctx.reg}) (7 days)`,
    RENT_14D: (ctx) => `Overdue rental balance — ${ctx.customer_name} (${ctx.reg}) (14 days)`,
    
    // Immobiliser reminders
    IMM_FIT_30D: (ctx) => `Fit immobiliser — ${ctx.reg} (30 days since acquisition)`,
    IMM_FIT_14D: (ctx) => `Fit immobiliser — ${ctx.reg} (14 days since acquisition)`,
    IMM_FIT_7D: (ctx) => `Fit immobiliser — ${ctx.reg} (7 days since acquisition)`,
    IMM_FIT_0D: (ctx) => `Fit immobiliser — ${ctx.reg} (overdue)`,
    
    // Legacy codes for backward compatibility
    VEH_MOT_30D: (ctx) => `MOT due soon — ${ctx.reg} (30 days)`,
    VEH_MOT_14D: (ctx) => `MOT due soon — ${ctx.reg} (14 days)`,
    VEH_MOT_7D: (ctx) => `MOT due soon — ${ctx.reg} (7 days)`,
    VEH_MOT_0D: (ctx) => `MOT due today — ${ctx.reg}`,
    VEH_TAX_30D: (ctx) => `TAX due soon — ${ctx.reg} (30 days)`,
    VEH_TAX_14D: (ctx) => `TAX due soon — ${ctx.reg} (14 days)`,
    VEH_TAX_7D: (ctx) => `TAX due soon — ${ctx.reg} (7 days)`,
    VEH_TAX_0D: (ctx) => `TAX due today — ${ctx.reg}`,
    INS_EXP_30D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (30 days)`,
    INS_EXP_14D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (14 days)`,
    INS_EXP_7D: (ctx) => `Insurance expiring — ${ctx.customer_name} (${ctx.reg}) (7 days)`,
    INS_EXP_0D: (ctx) => `Insurance expires today — ${ctx.customer_name} (${ctx.reg})`,
    DOC_EXP_30D: (ctx) => `Document expiring — ${ctx.customer_name} (30 days)`,
    DOC_EXP_14D: (ctx) => `Document expiring — ${ctx.customer_name} (14 days)`,
    DOC_EXP_7D: (ctx) => `Document expiring — ${ctx.customer_name} (7 days)`,
    DOC_EXP_0D: (ctx) => `Document expires today — ${ctx.customer_name}`,
    RENT_OVERDUE: (ctx) => `Overdue rental balance — ${ctx.customer_name} (${ctx.reg})`,
    FINE_DUE_14D: (ctx) => `Fine due soon — ${ctx.reg} (${ctx.reference}) (14 days)`,
    FINE_DUE_7D: (ctx) => `Fine due soon — ${ctx.reg} (${ctx.reference}) (7 days)`,
    FINE_DUE_0D: (ctx) => `Fine due today — ${ctx.reg} (${ctx.reference})`,
  };
  
  const template = templates[ruleCode];
  return template ? template(context) : `Reminder: ${ruleCode}`;
}

function getMessageTemplate(ruleCode: string, context: ReminderContext): string {
  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

  const templates: Record<string, (ctx: ReminderContext) => string> = {
    // MOT reminders
    MOT_30D: (ctx) => `MOT for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Please book test soon.`,
    MOT_14D: (ctx) => `MOT for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Please book test immediately.`,
    MOT_7D: (ctx) => `MOT for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Book test urgently!`,
    MOT_0D: (ctx) => `MOT for ${ctx.reg} (${ctx.make} ${ctx.model}) due today (${ctx.due_date}). Immediate action required!`,
    
    // TAX reminders
    TAX_30D: (ctx) => `TAX for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew soon.`,
    TAX_14D: (ctx) => `TAX for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew immediately.`,
    TAX_7D: (ctx) => `TAX for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew urgently!`,
    TAX_0D: (ctx) => `TAX for ${ctx.reg} (${ctx.make} ${ctx.model}) due today (${ctx.due_date}). Immediate action required!`,
    
    // Insurance reminders
    INS_30D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Contact ${ctx.provider} to renew.`,
    INS_14D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Renew immediately with ${ctx.provider}.`,
    INS_7D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Urgent renewal required!`,
    INS_0D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires today (${ctx.due_date}). Immediate action required!`,
    
    // Document reminders
    DOC_30D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Please request renewal.`,
    DOC_14D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Request renewal immediately.`,
    DOC_7D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Urgent renewal required!`,
    DOC_0D: (ctx) => `Document for ${ctx.customer_name} expires today (${ctx.due_date}). Immediate action required!`,
    
    // Fine reminders
    FINE_14D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0)}) due on ${ctx.due_date}. Prepare payment or appeal.`,
    FINE_7D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0)}) due on ${ctx.due_date}. Urgent action required!`,
    FINE_0D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0)}) due today (${ctx.due_date}). Immediate payment required!`,
    
    // Rental reminders
    RENT_1D: (ctx) => `${formatCurrency(ctx.overdue_total || 0)} overdue since ${ctx.oldest_due_date}. Review ledger & contact customer.`,
    RENT_7D: (ctx) => `${formatCurrency(ctx.overdue_total || 0)} overdue since ${ctx.oldest_due_date}. Review ledger & contact customer.`,
    RENT_14D: (ctx) => `${formatCurrency(ctx.overdue_total || 0)} overdue since ${ctx.oldest_due_date}. Review ledger & contact customer.`,
    
    // Immobiliser reminders
    IMM_FIT_30D: (ctx) => `Vehicle ${ctx.reg} (${ctx.make} ${ctx.model}) acquired on ${ctx.due_date} needs an immobiliser fitted. Please schedule installation.`,
    IMM_FIT_14D: (ctx) => `Vehicle ${ctx.reg} (${ctx.make} ${ctx.model}) has been without an immobiliser for ${ctx.days_until || 0} days. Schedule fitting urgently.`,
    IMM_FIT_7D: (ctx) => `Vehicle ${ctx.reg} (${ctx.make} ${ctx.model}) urgently needs an immobiliser fitted - ${ctx.days_until || 0} days since acquisition.`,
    IMM_FIT_0D: (ctx) => `Vehicle ${ctx.reg} (${ctx.make} ${ctx.model}) is overdue for immobiliser fitting - acquired ${ctx.days_until || 0} days ago. Immediate action required!`,
    
    // Legacy codes for backward compatibility
    VEH_MOT_30D: (ctx) => `MOT for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Please book test soon.`,
    VEH_MOT_14D: (ctx) => `MOT for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Please book test immediately.`,
    VEH_MOT_7D: (ctx) => `MOT for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Book test urgently!`,
    VEH_MOT_0D: (ctx) => `MOT for ${ctx.reg} (${ctx.make} ${ctx.model}) due today (${ctx.due_date}). Immediate action required!`,
    VEH_TAX_30D: (ctx) => `TAX for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew soon.`,
    VEH_TAX_14D: (ctx) => `TAX for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew immediately.`,
    VEH_TAX_7D: (ctx) => `TAX for ${ctx.reg} (${ctx.make} ${ctx.model}) due on ${ctx.due_date}. Renew urgently!`,
    VEH_TAX_0D: (ctx) => `TAX for ${ctx.reg} (${ctx.make} ${ctx.model}) due today (${ctx.due_date}). Immediate action required!`,
    INS_EXP_30D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Contact ${ctx.provider} to renew.`,
    INS_EXP_14D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Renew immediately with ${ctx.provider}.`,
    INS_EXP_7D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires on ${ctx.due_date}. Urgent renewal required!`,
    INS_EXP_0D: (ctx) => `Insurance policy ${ctx.policy_no} for ${ctx.customer_name} expires today (${ctx.due_date}). Immediate action required!`,
    DOC_EXP_30D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Please request renewal.`,
    DOC_EXP_14D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Request renewal immediately.`,
    DOC_EXP_7D: (ctx) => `Document for ${ctx.customer_name} expires on ${ctx.due_date}. Urgent renewal required!`,
    DOC_EXP_0D: (ctx) => `Document for ${ctx.customer_name} expires today (${ctx.due_date}). Immediate action required!`,
    RENT_OVERDUE: (ctx) => `${formatCurrency(ctx.overdue_total || 0)} overdue since ${ctx.oldest_due_date}. Review ledger & contact customer.`,
    FINE_DUE_14D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0)}) due on ${ctx.due_date}. Prepare payment or appeal.`,
    FINE_DUE_7D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0)}) due on ${ctx.due_date}. Urgent action required!`,
    FINE_DUE_0D: (ctx) => `Fine ${ctx.reference} for ${ctx.reg} (${formatCurrency(ctx.amount || 0)}) due today (${ctx.due_date}). Immediate payment required!`,
  };
  
  const template = templates[ruleCode];
  return template ? template(context) : `Reminder for ${ruleCode}`;
}

function getSeverityForRule(ruleCode: string): 'info' | 'warning' | 'critical' {
  if (ruleCode.includes('_30D') || ruleCode.includes('_14D')) {
    return 'warning';
  }
  if (ruleCode.includes('_7D') || ruleCode.includes('_0D') || ruleCode.includes('OVERDUE')) {
    return 'critical';
  }
  return 'info';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting reminder generation...');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const today = new Date().toISOString().split('T')[0];
    let totalGenerated = 0;

    // Check if reminders are enabled
    const { data: config } = await supabase
      .from('reminder_config')
      .select('config_value')
      .eq('config_key', 'reminders.enabled')
      .single();

    if (!config || config.config_value !== true) {
      console.log('Reminders are disabled, skipping generation');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Reminders disabled',
        generated: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Expire old reminders
    const { data: expiredReminders, error: expireError } = await supabase
      .from('reminders')
      .update({ status: 'expired' })
      .lt('due_on', today)
      .in('status', ['pending', 'snoozed'])
      .select('id');

    if (expireError) {
      console.error('Error expiring reminders:', expireError);
    } else {
      console.log(`Expired ${expiredReminders?.length || 0} old reminders`);
      
      // Log expiry actions
      for (const reminder of expiredReminders || []) {
        await supabase
          .from('reminder_actions')
          .insert({
            reminder_id: reminder.id,
            action: 'expired',
            note: 'Automatically expired due to past due date'
          });
      }
    }

    // 2. Generate reminders based on configurable rules
    const { data: reminderRules } = await supabase
      .from('reminder_rules')
      .select('*')
      .eq('is_enabled', true)
      .order('lead_days', { ascending: false });

    if (!reminderRules || reminderRules.length === 0) {
      console.log('No enabled reminder rules found');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No enabled rules',
        generated: 0,
        expired: expiredReminders?.length || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group rules by type for efficient lookup
    const rulesByType = reminderRules.reduce((acc, rule) => {
      if (!acc[rule.rule_type]) {
        acc[rule.rule_type] = [];
      }
      acc[rule.rule_type].push(rule);
      return acc;
    }, {} as Record<string, any[]>);

    // 3. Generate Vehicle MOT/TAX/Immobiliser reminders
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, reg, make, model, mot_due_date, tax_due_date, has_remote_immobiliser, acquisition_date')
      .or('mot_due_date.not.is.null,tax_due_date.not.is.null,has_remote_immobiliser.eq.false')
      .eq('is_disposed', false);

    for (const vehicle of vehicles || []) {
      // MOT reminders - select most appropriate rule
      if (vehicle.mot_due_date && rulesByType['MOT']) {
        const motDate = new Date(vehicle.mot_due_date);
        
        // Find the most appropriate rule (smallest lead_days that meets criteria)
        let bestRule = null;
        for (const rule of rulesByType['MOT']) {
          const remindDate = new Date(motDate);
          remindDate.setDate(motDate.getDate() - rule.lead_days);
          const remindDateStr = remindDate.toISOString().split('T')[0];

          if (remindDateStr <= today) {
            if (!bestRule || rule.lead_days < bestRule.lead_days) {
              bestRule = rule;
            }
          }
        }

        // Create reminder only for the best rule
        if (bestRule) {
          const context: ReminderContext = {
            vehicle_id: vehicle.id,
            reg: vehicle.reg,
            make: vehicle.make,
            model: vehicle.model,
            due_date: vehicle.mot_due_date,
            days_until: bestRule.lead_days
          };

          const remindDate = new Date(motDate);
          remindDate.setDate(motDate.getDate() - bestRule.lead_days);
          const remindDateStr = remindDate.toISOString().split('T')[0];

          // Check if reminder already exists and is snoozed - if so, don't overwrite
          const { data: existingReminder } = await supabase
            .from('reminders')
            .select('id, status')
            .eq('rule_code', bestRule.rule_code)
            .eq('object_type', 'Vehicle')
            .eq('object_id', vehicle.id)
            .eq('due_on', vehicle.mot_due_date)
            .eq('remind_on', remindDateStr)
            .single();

          // Skip if reminder exists and is snoozed
          if (existingReminder && existingReminder.status === 'snoozed') {
            continue;
          }

          const { error: reminderError } = await supabase
            .from('reminders')
            .upsert({
              rule_code: bestRule.rule_code,
              object_type: 'Vehicle',
              object_id: vehicle.id,
              title: getTitleTemplate(bestRule.rule_code, context),
              message: getMessageTemplate(bestRule.rule_code, context),
              due_on: vehicle.mot_due_date,
              remind_on: remindDateStr,
              severity: bestRule.severity,
              context: context,
              status: 'pending'
            }, {
              onConflict: 'rule_code,object_type,object_id,due_on,remind_on'
            });

          if (!reminderError) {
            totalGenerated++;
          }
        }
      }

      // TAX reminders - select most appropriate rule
      if (vehicle.tax_due_date && rulesByType['TAX']) {
        const taxDate = new Date(vehicle.tax_due_date);
        
        // Find the most appropriate rule (smallest lead_days that meets criteria)
        let bestRule = null;
        for (const rule of rulesByType['TAX']) {
          const remindDate = new Date(taxDate);
          remindDate.setDate(taxDate.getDate() - rule.lead_days);
          const remindDateStr = remindDate.toISOString().split('T')[0];

          if (remindDateStr <= today) {
            if (!bestRule || rule.lead_days < bestRule.lead_days) {
              bestRule = rule;
            }
          }
        }

        // Create reminder only for the best rule
        if (bestRule) {
          const context: ReminderContext = {
            vehicle_id: vehicle.id,
            reg: vehicle.reg,
            make: vehicle.make,
            model: vehicle.model,
            due_date: vehicle.tax_due_date,
            days_until: bestRule.lead_days
          };

          const remindDate = new Date(taxDate);
          remindDate.setDate(taxDate.getDate() - bestRule.lead_days);
          const remindDateStr = remindDate.toISOString().split('T')[0];

          // Check if reminder already exists and is snoozed - if so, don't overwrite
          const { data: existingReminder } = await supabase
            .from('reminders')
            .select('id, status')
            .eq('rule_code', bestRule.rule_code)
            .eq('object_type', 'Vehicle')
            .eq('object_id', vehicle.id)
            .eq('due_on', vehicle.tax_due_date)
            .eq('remind_on', remindDateStr)
            .single();

          // Skip if reminder exists and is snoozed
          if (existingReminder && existingReminder.status === 'snoozed') {
            continue;
          }

          const { error: reminderError } = await supabase
            .from('reminders')
            .upsert({
              rule_code: bestRule.rule_code,
              object_type: 'Vehicle',
              object_id: vehicle.id,
              title: getTitleTemplate(bestRule.rule_code, context),
              message: getMessageTemplate(bestRule.rule_code, context),
              due_on: vehicle.tax_due_date,
              remind_on: remindDateStr,
              severity: bestRule.severity,
              context: context,
              status: 'pending'
            }, {
              onConflict: 'rule_code,object_type,object_id,due_on,remind_on'
            });

          if (!reminderError) {
            totalGenerated++;
          }
        }
      }

      // Generate WARRANTY reminders
      if (vehicle.warranty_end_date) {
        const warrantyDate = new Date(vehicle.warranty_end_date);
        
        for (const rule of rules.filter(r => r.rule_code.startsWith('WARRANTY_'))) {
          const diffDays = differenceInDays(warrantyDate, today);
          
          if (diffDays === rule.lead_days) {
            const remindDate = new Date(warrantyDate);
            remindDate.setDate(warrantyDate.getDate() - rule.lead_days);
            const remindDateStr = remindDate.toISOString().split('T')[0];

            // Check if reminder already exists and is snoozed - if so, don't overwrite
            const { data: existingReminder } = await supabase
              .from('reminders')
              .select('id, status')
              .eq('rule_code', rule.rule_code)
              .eq('object_type', 'Vehicle')
              .eq('object_id', vehicle.id)
              .eq('due_on', vehicle.warranty_end_date)
              .eq('remind_on', remindDateStr)
              .single();

            // Skip if reminder exists and is snoozed
            if (existingReminder && existingReminder.status === 'snoozed') {
              continue;
            }

            const context: ReminderContext = {
              vehicle_id: vehicle.id,
              reg: vehicle.reg,
              make: vehicle.make,
              model: vehicle.model,
              due_date: vehicle.warranty_end_date
            };

            const { error: reminderError } = await supabase
              .from('reminders')
              .upsert({
                rule_code: rule.rule_code,
                object_type: 'Vehicle',
                object_id: vehicle.id,
                title: getTitleTemplate(rule.rule_code, context),
                message: getMessageTemplate(rule.rule_code, context),
                severity: getSeverityForRule(rule.rule_code),
                due_on: vehicle.warranty_end_date,
                remind_on: remindDateStr,
                context: context,
                status: 'pending'
              }, {
                onConflict: 'rule_code,object_type,object_id,due_on,remind_on'
              });

            if (reminderError) {
              console.error('Error creating WARRANTY reminder:', reminderError);
            } else {
              totalGenerated++;
            }
          }
        }
      }

      // Immobiliser reminders - for vehicles without immobilisers
      if (!vehicle.has_remote_immobiliser && vehicle.acquisition_date && rulesByType['Immobiliser']) {
        const acquisitionDate = new Date(vehicle.acquisition_date);
        const daysSinceAcquisition = Math.ceil((new Date().getTime() - acquisitionDate.getTime()) / (1000 * 60 * 60 * 24));
        
        for (const rule of rulesByType['Immobiliser']) {
          const remindDate = new Date(acquisitionDate);
          remindDate.setDate(acquisitionDate.getDate() + rule.lead_days);
          const remindDateStr = remindDate.toISOString().split('T')[0];

          if (remindDateStr <= today) {
            const context: ReminderContext = {
              vehicle_id: vehicle.id,
              reg: vehicle.reg,
              make: vehicle.make,
              model: vehicle.model,
              due_date: vehicle.acquisition_date,
              days_until: daysSinceAcquisition
            };

            // Check if reminder already exists and is snoozed - if so, don't overwrite
            const { data: existingReminder } = await supabase
              .from('reminders')
              .select('id, status')
              .eq('rule_code', rule.rule_code)
              .eq('object_type', 'Vehicle')
              .eq('object_id', vehicle.id)
              .eq('due_on', today)
              .eq('remind_on', remindDateStr)
              .single();

            // Skip if reminder exists and is snoozed
            if (existingReminder && existingReminder.status === 'snoozed') {
              continue;
            }

            const { error: reminderError } = await supabase
              .from('reminders')
              .upsert({
                rule_code: rule.rule_code,
                object_type: 'Vehicle',
                object_id: vehicle.id,
                title: getTitleTemplate(rule.rule_code, context),
                message: getMessageTemplate(rule.rule_code, context),
                due_on: today, // Due immediately since it's overdue
                remind_on: remindDateStr,
                severity: rule.severity,
                context: context,
                status: 'pending'
              }, {
                onConflict: 'rule_code,object_type,object_id,due_on,remind_on'
              });

            if (!reminderError) {
              totalGenerated++;
            }
          }
        }
      }
    }

    // 3. Generate insurance verification reminders for active rentals (fixed)
    if (rulesByType['Verification']) {
      const { data: activeRentals } = await supabase
        .from('rentals')
        .select(`
          id, customer_id, vehicle_id, start_date, end_date,
          customers!inner(name),
          vehicles!inner(reg)
        `)
        .eq('status', 'Active');

      // Only use the 7D verification rule to avoid duplication
      const verificationRule = rulesByType['Verification'].find(r => r.rule_code === 'INS_VERIFY_7D');
      
      if (verificationRule) {
        for (const rental of activeRentals || []) {
          const context: ReminderContext = {
            customer_id: rental.customer_id,
            customer_name: rental.customers.name,
            vehicle_id: rental.vehicle_id,
            reg: rental.vehicles.reg,
            rental_id: rental.id
          };

          // Calculate next verification date (30 days from rental start, then monthly intervals)
          const rentalStart = new Date(rental.start_date);
          const today = new Date();
          const daysSinceStart = Math.floor((today.getTime() - rentalStart.getTime()) / (1000 * 60 * 60 * 24));
          
          // Find next verification milestone (30, 60, 90, 120 days, etc.)
          const nextMilestone = Math.max(30, Math.ceil((daysSinceStart + 1) / 30) * 30);
          const nextVerificationDate = new Date(rentalStart);
          nextVerificationDate.setDate(nextVerificationDate.getDate() + nextMilestone);

          // Only create if the verification is within the next 14 days
          const daysUntilVerification = Math.floor((nextVerificationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysUntilVerification >= 0 && daysUntilVerification <= 14) {
            const reminderDate = new Date(nextVerificationDate);
            reminderDate.setDate(reminderDate.getDate() - Math.abs(verificationRule.lead_days));

            // Only create if reminder date is today or in the future  
            if (reminderDate >= today) {
              const reminderDateStr = reminderDate.toISOString().split('T')[0];
              const verificationDateStr = nextVerificationDate.toISOString().split('T')[0];

              // Check if reminder already exists and is snoozed - if so, don't overwrite
              const { data: existingReminder } = await supabase
                .from('reminders')
                .select('id, status')
                .eq('rule_code', verificationRule.rule_code)
                .eq('object_type', 'Rental')
                .eq('object_id', rental.id)
                .eq('due_on', verificationDateStr)
                .eq('remind_on', reminderDateStr)
                .single();

              // Skip if reminder exists and is snoozed
              if (existingReminder && existingReminder.status === 'snoozed') {
                continue;
              }

              const { error: reminderError } = await supabase
                .from('reminders')
                .upsert({
                  rule_code: verificationRule.rule_code,
                  object_type: 'Rental',
                  object_id: rental.id,
                  title: getTitleTemplate(verificationRule.rule_code, context),
                  message: getMessageTemplate(verificationRule.rule_code, context),
                  due_on: verificationDateStr,
                  remind_on: reminderDateStr,
                  severity: verificationRule.severity,
                  context: context,
                  status: 'pending'
                }, {
                  onConflict: 'rule_code,object_type,object_id,due_on,remind_on'
                });

              if (!reminderError) {
                totalGenerated++;
              }
            }
          }
        }
      }
    }

    // 4. Generate rental overdue reminders
    // Generate rental overdue reminders - these use a different logic
    if (rulesByType['Rental']) {
      const { data: overdueCharges } = await supabase
        .from('ledger_entries')
        .select(`
          rental_id, customer_id, vehicle_id, due_date, remaining_amount,
          rentals!inner(status),
          customers!inner(name),
          vehicles!inner(reg, make, model)
        `)
        .eq('type', 'Charge')
        .eq('category', 'Rental')
        .gt('remaining_amount', 0)
        .lt('due_date', today)
        .eq('rentals.status', 'Active');

      // Group by rental
      const rentalGroups = new Map<string, any[]>();
      for (const charge of overdueCharges || []) {
        if (!rentalGroups.has(charge.rental_id)) {
          rentalGroups.set(charge.rental_id, []);
        }
        rentalGroups.get(charge.rental_id)!.push(charge);
      }

      for (const [rentalId, charges] of rentalGroups) {
        const totalOverdue = charges.reduce((sum, c) => sum + parseFloat(c.remaining_amount), 0);
        const oldestCharge = charges.sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
        const daysSinceOldest = Math.floor((new Date(today).getTime() - new Date(oldestCharge.due_date).getTime()) / (1000 * 60 * 60 * 24));

        // Find the appropriate reminder rule based on days overdue
        const appropriateRule = rulesByType['Rental']
          .filter(rule => daysSinceOldest >= rule.lead_days)
          .sort((a, b) => b.lead_days - a.lead_days)[0]; // Get the rule with highest lead_days that applies

        if (appropriateRule) {
          const context: ReminderContext = {
            rental_id: rentalId,
            customer_id: oldestCharge.customer_id,
            customer_name: oldestCharge.customers?.name,
            vehicle_id: oldestCharge.vehicle_id,
            reg: oldestCharge.vehicles?.reg,
            overdue_total: totalOverdue,
            oldest_due_date: oldestCharge.due_date,
            days_overdue: daysSinceOldest
          };

          // Check if reminder already exists and is snoozed - if so, don't overwrite
          const { data: existingReminder } = await supabase
            .from('reminders')
            .select('id, status')
            .eq('rule_code', appropriateRule.rule_code)
            .eq('object_type', 'Rental')
            .eq('object_id', rentalId)
            .eq('due_on', oldestCharge.due_date)
            .eq('remind_on', today)
            .single();

          // Skip if reminder exists and is snoozed
          if (existingReminder && existingReminder.status === 'snoozed') {
            continue;
          }

          const { error: reminderError } = await supabase
            .from('reminders')
            .upsert({
              rule_code: appropriateRule.rule_code,
              object_type: 'Rental',
              object_id: rentalId,
              title: getTitleTemplate(appropriateRule.rule_code, context),
              message: getMessageTemplate(appropriateRule.rule_code, context),
              due_on: oldestCharge.due_date,
              remind_on: today,
              severity: appropriateRule.severity,
              context: context,
              status: 'pending'
            }, {
              onConflict: 'rule_code,object_type,object_id,due_on,remind_on'
            });

          if (!reminderError) {
            totalGenerated++;
          }
        }
      }
    }

    console.log(`Generation complete. Created ${totalGenerated} reminders.`);

    return new Response(JSON.stringify({ 
      success: true, 
      generated: totalGenerated,
      expired: expiredReminders?.length || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in reminder generation:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});