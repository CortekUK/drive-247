import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * SANDBOX copy of `daily-reminders` — Dev Panel "Time Machine" ONLY.
 *
 * This is a strict, FAIL-CLOSED, SINGLE-RENTAL variant. Unlike the real cron it
 * has NO global path: it REFUSES to run without a valid `only_rental_id` (UUID),
 * and — when `SANDBOX_TEST_TENANT_ID` is configured — REFUSES any rental not
 * owned by that one designated test tenant. A `preview: true` request performs
 * ZERO writes and just reports which rental(s) its due-criteria would match
 * (used by route.ts for the blast-radius pre-check).
 *
 * The real `daily-reminders` cron is never modified and keeps serving every
 * customer on its schedule. A bug here therefore cannot reach a real customer:
 * this function only ever touches the single rental id it is handed, in the
 * designated test tenant.
 *
 * Reminder logic below is copied verbatim from daily-reminders so the sandbox
 * exercises the same behaviour; the ONLY differences are the fail-closed guard,
 * the preview branch, the tenant-lock, and the audit fix. AUDIT FIX: the
 * customer-credit aggregation read stays same-tenant-cross-rental BY DESIGN
 * (it drives customer-level credit suppression, so it must NOT be rental-scoped);
 * it only gains a purely-defensive `.eq('tenant_id', <charge tenant_id>)` filter.
 * The DRIVER (unpaid charges) IS hard-scoped by rental_id.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LedgerEntry {
  id: string;
  customer_id: string;
  rental_id: string | null;
  vehicle_id: string;
  due_date: string;
  remaining_amount: number;
  category: string;
  tenant_id: string;
  customers: { name: string; whatsapp_opt_in?: boolean };
  vehicles: { reg: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
  const SANDBOX_TENANT = Deno.env.get('SANDBOX_TEST_TENANT_ID') || null;
  // FAIL-CLOSED: without the designated-tenant env this sandbox must not run at all.
  if (!SANDBOX_TENANT) {
    return json({ success: false, error: "sandbox: SANDBOX_TEST_TENANT_ID is not configured" }, 412);
  }

  // ── FAIL-CLOSED scope parse — no valid single-rental id => refuse. ──────────
  //    There is no global path: the sandbox can only ever run for ONE rental.
  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const onlyRentalId = typeof body?.only_rental_id === 'string' ? body.only_rental_id.trim() : '';
  const preview = body?.preview === true;
  if (!UUID_RE.test(onlyRentalId)) {
    return json({ success: false, error: 'sandbox: a valid only_rental_id (UUID) is required' }, 400);
  }

  try {
    // ── TENANT-LOCK: resolve the target rental and confirm it belongs to the
    //    designated test tenant before doing anything else. ─────────────────
    const { data: target, error: targetErr } = await supabaseClient
      .from('rentals').select('id, tenant_id').eq('id', onlyRentalId).maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ success: false, error: 'sandbox: rental not found' }, 404);
    if (SANDBOX_TENANT && target.tenant_id !== SANDBOX_TENANT) {
      return json({ success: false, error: 'sandbox: rental is not in the designated test tenant' }, 403);
    }

    console.log('[SandboxDailyReminders] Starting daily reminder generation at:', new Date().toISOString());

    const currentDate = new Date();
    const today = currentDate.toISOString().split('T')[0];
    const twoDaysFromNow = new Date(currentDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const yesterday = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get all unpaid charges — driver query IDENTICAL to the real cron, ALWAYS
    // hard-scoped to the one rental id (there is no code path that omits this).
    const { data: charges, error: chargesError } = await supabaseClient
      .from('ledger_entries')
      .select(`
        id,
        customer_id,
        rental_id,
        vehicle_id,
        due_date,
        remaining_amount,
        category,
        tenant_id,
        customers!inner(name, whatsapp_opt_in),
        vehicles!inner(reg)
      `)
      .eq('type', 'Charge')
      .gt('remaining_amount', 0)
      .not('due_date', 'is', null)
      .eq('rental_id', onlyRentalId);

    if (chargesError) {
      console.error('[SandboxDailyReminders] Error fetching charges:', chargesError);
      throw chargesError;
    }

    console.log(`[SandboxDailyReminders] Found ${charges?.length || 0} unpaid charges to process`);

    // matchedRentalIds = distinct underlying rental_id(s) the scoped driver
    // (unpaid charges) would process — hard-scoped, so at most the one target.
    const matchedRentalIds = Array.from(
      new Set(
        ((charges as LedgerEntry[]) ?? [])
          .map((c) => c.rental_id)
          .filter((id): id is string => !!id)
      )
    );

    // ── PREVIEW (blast-radius) — zero writes / zero Stripe / zero RPC / zero
    //    email; just report which rental(s) would be processed. ─────────────
    if (preview) return json({ success: true, preview: true, matchedRentalIds });

    let remindersGenerated = 0;

    for (const charge of charges || []) {
      const typedCharge = charge as LedgerEntry;
      const chargeDate = new Date(typedCharge.due_date);
      const daysDiff = Math.floor((chargeDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

      let reminderType = null;
      let message = '';

      // Determine reminder type based on days difference
      if (daysDiff === 2) {
        reminderType = 'Upcoming';
        message = `Payment due in 2 days: $${typedCharge.remaining_amount} for ${typedCharge.vehicles.reg} (${typedCharge.category})`;
      } else if (daysDiff === 0) {
        reminderType = 'Due';
        message = `Payment due today: $${typedCharge.remaining_amount} for ${typedCharge.vehicles.reg} (${typedCharge.category})`;
      } else if (daysDiff === -1) {
        reminderType = 'Overdue1';
        message = `Payment overdue by 1 day: $${typedCharge.remaining_amount} for ${typedCharge.vehicles.reg} (${typedCharge.category})`;
      } else if (daysDiff <= -7 && daysDiff >= -28 && daysDiff % 7 === 0) {
        reminderType = 'OverdueN';
        const weeksOverdue = Math.abs(daysDiff) / 7;
        message = `Payment overdue by ${weeksOverdue} week${weeksOverdue > 1 ? 's' : ''}: $${typedCharge.remaining_amount} for ${typedCharge.vehicles.reg} (${typedCharge.category})`;
      }

      if (!reminderType) {
        continue; // Skip if no reminder needed for this charge
      }

      // Check if customer has sufficient credit to cover this charge.
      // NOTE (audit fix): this aggregation is same-tenant-cross-rental BY
      // DESIGN — it sums ALL of the customer's outstanding credits (not just
      // this rental's) to drive customer-level credit suppression, so it is
      // deliberately NOT rental-scoped. It only gains a purely-defensive
      // tenant_id filter matching the charge row's tenant.
      const { data: customerCredits } = await supabaseClient
        .from('ledger_entries')
        .select('remaining_amount')
        .eq('customer_id', typedCharge.customer_id)
        .eq('type', 'Credit')
        .gt('remaining_amount', 0)
        .eq('tenant_id', typedCharge.tenant_id);

      const totalCredits = customerCredits?.reduce((sum, credit) => sum + Number(credit.remaining_amount), 0) || 0;

      // Suppress reminder if customer has enough credit to cover the charge
      if (totalCredits >= typedCharge.remaining_amount) {
        console.log(`[SandboxDailyReminders] Suppressing reminder for charge ${typedCharge.id} - customer has sufficient credit`);
        continue;
      }

      // Check if reminder already exists for this charge and type today
      const { data: existingReminder } = await supabaseClient
        .from('reminder_events')
        .select('id')
        .eq('charge_id', typedCharge.id)
        .eq('reminder_type', reminderType)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lt('created_at', `${today}T23:59:59.999Z`)
        .limit(1).maybeSingle();

      if (existingReminder) {
        console.log(`[SandboxDailyReminders] Reminder already exists for charge ${typedCharge.id}, type ${reminderType}`);
        continue;
      }

      // Create the reminder
      const { error: insertError } = await supabaseClient
        .from('reminder_events')
        .insert({
          charge_id: typedCharge.id,
          customer_id: typedCharge.customer_id,
          rental_id: typedCharge.rental_id,
          vehicle_id: typedCharge.vehicle_id,
          reminder_type: reminderType,
          status: 'Delivered',
          message_preview: message,
          delivered_at: new Date().toISOString(),
          delivered_to: 'in_app',
          tenant_id: typedCharge.tenant_id
        });

      if (insertError) {
        console.error(`[SandboxDailyReminders] Error creating reminder for charge ${typedCharge.id}:`, insertError);
      } else {
        remindersGenerated++;
        console.log(`[SandboxDailyReminders] Created ${reminderType} reminder for charge ${typedCharge.id}: ${message}`);
      }
    }

    console.log(`[SandboxDailyReminders] Daily reminder generation completed. Generated ${remindersGenerated} reminders`);

    return json({
      success: true,
      message: `Generated ${remindersGenerated} reminders`,
      timestamp: new Date().toISOString(),
      processedCharges: charges?.length || 0,
      matchedRentalIds,
    });

  } catch (error) {
    console.error('[SandboxDailyReminders] Error in daily reminders function:', error);
    return json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});
