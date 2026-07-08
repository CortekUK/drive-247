import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { formatCurrency } from '../_shared/format-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PaymentProcessingResult {
  ok?: boolean;
  paymentId?: string;
  category?: string;
  entryDate?: string;
  error?: string;
  detail?: string;
  allocated?: number;
  remaining?: number;
  status?: string;
}

async function applyPayment(supabase: any, paymentId: string, targetCategories?: string[], holdAsCredit?: boolean): Promise<PaymentProcessingResult> {
  try {
    console.log('Processing payment:', paymentId);

    // Load payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return {
        ok: false,
        error: 'Payment not found',
        detail: paymentError?.message || 'Payment does not exist'
      };
    }

    // CAPTURE GUARD: refuse to allocate a Stripe-checkout payment that was never
    // actually captured. A payment row that has a checkout session but no
    // PaymentIntent ID and capture_status='requires_capture' means the customer
    // never completed the Stripe Checkout — there is no real money. Allocating
    // it inflates Collected, masks the true Balance Due, and creates phantom
    // payment_applications that have to be hand-reversed later. The legitimate
    // post-capture path (stripe-webhook-test/live + process-pending-payment)
    // always updates capture_status='captured' and stamps the PaymentIntent
    // ID BEFORE calling us, so this guard is invisible to good callers.
    if (
      payment.payment_type === 'Payment'
      && payment.stripe_checkout_session_id
      && !payment.stripe_payment_intent_id
      && payment.capture_status === 'requires_capture'
      && payment.status !== 'Applied'
      && payment.status !== 'Completed'
      && payment.status !== 'Partial'
    ) {
      console.warn(`[APPLY-PAYMENT] Refusing to allocate uncaptured Stripe payment ${paymentId} (session=${payment.stripe_checkout_session_id}). The customer has not completed checkout yet.`);
      return {
        ok: false,
        error: 'Payment not yet captured by Stripe',
        detail: `Payment ${paymentId} has a Stripe Checkout session but no captured PaymentIntent. Wait for the customer to complete checkout (Stripe webhook will trigger allocation once captured).`,
      };
    }

    // If targetCategories not provided by caller, read from payment record (stored by create-checkout-session)
    if (!targetCategories && payment.target_categories) {
      targetCategories = payment.target_categories;
      console.log(`Read targetCategories from payment record: ${targetCategories.join(', ')}`);
    }

    // ISOLATION GUARD (Phase 2): if this payment is stamped to a rental extension,
    // force allocation to Extension-only categories. Prevents an extension payment
    // from being swallowed by original-rental FIFO when metadata is missing or wrong.
    if (payment.extension_id) {
      const extOnly = ['Extension Rental', 'Extension Tax', 'Extension Service Fee', 'Extension Insurance'];
      if (!targetCategories || targetCategories.length === 0) {
        targetCategories = extOnly;
        console.log(`Extension payment with no targets — forcing extension-only categories`);
      } else {
        // Strip any non-Extension categories that might have leaked in
        const filtered = targetCategories.filter((c: string) => c.startsWith('Extension'));
        if (filtered.length !== targetCategories.length) {
          console.warn(`Stripped non-Extension categories from extension payment. Before: ${targetCategories.join(',')} After: ${filtered.join(',')}`);
          targetCategories = filtered.length > 0 ? filtered : extOnly;
        }
      }
    } else if (targetCategories && targetCategories.some((c: string) => c.startsWith('Extension'))) {
      // ISOLATION GUARD: if any targetCategory is Extension*, the whole payment must be
      // extension-scoped. Refuse to mix with original-rental categories.
      const beforeLen = targetCategories.length;
      targetCategories = targetCategories.filter((c: string) => c.startsWith('Extension'));
      if (targetCategories.length !== beforeLen) {
        console.warn(`Mixed extension+original targets detected; restricted to extension-only.`);
      }
    }

    // Get tenant currency code
    let currencyCode = 'USD';
    if (payment.tenant_id) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('currency_code')
        .eq('id', payment.tenant_id)
        .single();
      if (tenant?.currency_code) currencyCode = tenant.currency_code;
    }

    // PAYG rentals must never have upfront ledger charges materialised from an invoice.
    // Daily Rental/Tax/Service Fee charges are produced by accrue-payg-charges; if we
    // pre-create them here, the cron's idempotency unique index (rental_id, accrual_day_index)
    // will collide and accruals silently no-op, leaving the customer billed for the upfront
    // total but never actually accruing daily.
    let isPayg = false;
    if (payment.rental_id) {
      const { data: rentalRow } = await supabase
        .from('rentals')
        .select('is_pay_as_you_go')
        .eq('id', payment.rental_id)
        .single();
      isPayg = !!rentalRow?.is_pay_as_you_go;
      if (isPayg) console.log(`Payment ${paymentId} is for a PAYG rental — auto-create from invoice disabled.`);
    }

    // For customer payments, all are treated as generic 'Payment' type
    // InitialFee payments are system-generated and handled separately
    const isCustomerPayment = payment.payment_type === 'Payment';
    const isInitialFee = payment.payment_type === 'InitialFee';

    // Map payment_type to valid ledger category
    const getLedgerCategory = (paymentType: string): string => {
      switch (paymentType) {
        case 'InitialFee':
          return 'InitialFee';
        case 'Payment':
          return 'Rental';
        case 'Fine':
          return 'Fines';
        default:
          return 'Other';
      }
    };

    const defaultLedgerCategory = getLedgerCategory(payment.payment_type);
    // If targeting a single category, use that for the payment ledger entry
    const ledgerCategory = (targetCategories && targetCategories.length === 1)
      ? targetCategories[0]
      : defaultLedgerCategory;

    // Determine entry date
    const entryDate = payment.payment_date || payment.paid_at || payment.created_at || new Date().toISOString().split('T')[0];

    console.log(`Payment ${paymentId}: ${payment.payment_type}, ${entryDate}, ${formatCurrency(payment.amount, currencyCode)}`);

    // Insert payment ledger entry — the DB unique index (idx_ledger_payment_unique) on
    // ledger_entries(payment_id) WHERE type='Payment' acts as a lock:
    // only the FIRST caller succeeds; subsequent callers get a duplicate key error and wait.
    console.log(`Creating ledger entry for payment ${paymentId}: amount=${payment.amount}, category=${ledgerCategory}`);

    const ledgerData: any = {
      customer_id: payment.customer_id,
      rental_id: payment.rental_id,
      vehicle_id: payment.vehicle_id,
      entry_date: entryDate,
      type: 'Payment',
      category: ledgerCategory,
      amount: -Math.abs(payment.amount), // Ensure negative
      due_date: entryDate,
      remaining_amount: 0,
      payment_id: payment.id
    };

    // Include tenant_id from payment if available
    if (payment.tenant_id) {
      ledgerData.tenant_id = payment.tenant_id;
    }

    const { error: ledgerError } = await supabase
      .from('ledger_entries')
      .insert([ledgerData]);

    if (ledgerError) {
      if (ledgerError.message.includes('duplicate key') || ledgerError.message.includes('idx_ledger_payment_unique')) {
        // Payment ledger entry already exists — check if payment is fully allocated
        const { data: fresh } = await supabase.from('payments').select('status, remaining_amount, amount').eq('id', paymentId).single();
        if (fresh && (fresh.status === 'Applied' || (fresh.remaining_amount != null && fresh.remaining_amount <= 0))) {
          console.log(`Payment ${paymentId} already fully applied, skipping`);
          return { ok: true, paymentId, category: 'Payment', entryDate, allocated: fresh.amount, remaining: 0, status: 'Applied' };
        }
        // Payment is partial — continue with allocation to handle newly created charges
        console.log(`Payment ${paymentId} ledger entry exists but payment is ${fresh?.status} with remaining=${fresh?.remaining_amount}. Continuing allocation...`);
      } else {
        console.error('CRITICAL: Ledger insert failed:', ledgerError);
        return {
          ok: false,
          error: 'CRITICAL: Failed to create ledger entry',
          detail: `${ledgerError.code}: ${ledgerError.message}`
        };
      }
    }

    // HOLD-AS-CREDIT (collect-then-allocate). When the operator collects money
    // into the customer's account to decide allocation LATER, we create the
    // ledger Payment entry above (so the credit is real and auditable) but skip
    // FIFO allocation entirely. The money sits as available credit
    // (payments.remaining_amount = full, status='Credit'); useCustomerBalanceWithStatus
    // subtracts it so the customer shows "In Credit". A later apply-payment call
    // (without holdAsCredit, optionally with a rental_id/targetCategories) resumes
    // allocation via the duplicate-ledger re-entry path above.
    //
    // Idempotency guard: only honour holdAsCredit when NOTHING has been allocated
    // yet. If applications already exist (accidental re-call), fall through to
    // normal allocation so we never reset remaining_amount and desync the ledger.
    if (holdAsCredit) {
      const { data: priorApps } = await supabase
        .from('payment_applications')
        .select('id')
        .eq('payment_id', paymentId)
        .limit(1);
      if (!priorApps || priorApps.length === 0) {
        await supabase
          .from('payments')
          .update({ status: 'Credit', remaining_amount: payment.amount })
          .eq('id', paymentId);
        console.log(`Payment ${paymentId} held as unallocated account credit (${formatCurrency(payment.amount, currencyCode)}).`);
        return {
          ok: true,
          paymentId,
          category: ledgerCategory,
          entryDate,
          allocated: 0,
          remaining: payment.amount,
          status: 'Credit',
        };
      }
      console.log(`Payment ${paymentId} has prior applications — ignoring holdAsCredit and continuing allocation.`);
    }

    // Handle InitialFee payments - allocate to fee charges first, then rental
    // The DB trigger creates Rental charges only. Fee charges (Tax, Service Fee, etc.)
    // are auto-created from the invoice and allocated first, then remainder goes to Rental.
    if (isInitialFee) {
      console.log('Processing Initial Fee payment - fees first, then rental');

      let remainingAmount = payment.amount;
      let totalAllocated = 0;

      // Step 1: Allocate to fee charges first (auto-create from invoice if missing)
      // Only create fee charges if the Rental charge = rental amount only (not grand total)
      if (payment.rental_id) {
        const { data: invoice } = await supabase
          .from('invoices')
          .select('*')
          .eq('rental_id', payment.rental_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: rentalChargeCheck } = await supabase
          .from('ledger_entries')
          .select('amount')
          .eq('rental_id', payment.rental_id)
          .eq('type', 'Charge')
          .eq('category', 'Rental')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        const invoiceSubtotal = Number(invoice?.subtotal || 0);
        const rentalChargeAmt = Number(rentalChargeCheck?.amount || 0);
        // Skip fee charges if: no invoice exists, OR Rental charge includes fees (> subtotal)
        const skipFeeCharges = !invoice || (invoiceSubtotal > 0 && rentalChargeAmt > invoiceSubtotal * 1.01);

        if (skipFeeCharges) {
          console.log(`Skipping fee charges — ${!invoice ? 'no invoice' : `Rental (${rentalChargeAmt}) > subtotal (${invoiceSubtotal})`}`);
        }

        // Security Deposit intentionally excluded — deposits are now held on the
        // card via place-deposit-hold, never charged/allocated here.
        // PAYG: skip fee auto-creation entirely; the accrual cron owns daily Tax/Service Fee.
        const feeCategories = (skipFeeCharges || isPayg) ? [] : [
          { category: 'Service Fee', invoiceField: 'service_fee' },
          { category: 'Tax', invoiceField: 'tax_amount' },
          { category: 'Delivery Fee', invoiceField: 'delivery_fee' },
        ];

        for (const { category, invoiceField } of feeCategories) {
          if (remainingAmount <= 0) break;

          let { data: feeCharges } = await supabase
            .from('ledger_entries')
            .select('id, amount, remaining_amount')
            .eq('rental_id', payment.rental_id)
            .eq('type', 'Charge')
            .eq('category', category)
            .gt('remaining_amount', 0)
            .order('due_date', { ascending: true });

          if ((!feeCharges || feeCharges.length === 0) && invoice) {
            const invoiceAmount = invoice[invoiceField] || 0;
            if (invoiceAmount > 0) {
              console.log(`Auto-creating ${category} charge: ${formatCurrency(invoiceAmount, currencyCode)}`);
              const chargeData: any = {
                customer_id: payment.customer_id, rental_id: payment.rental_id,
                vehicle_id: payment.vehicle_id, entry_date: invoice.invoice_date || entryDate,
                type: 'Charge', category, amount: invoiceAmount,
                remaining_amount: invoiceAmount, due_date: invoice.invoice_date || entryDate,
              };
              if (payment.tenant_id) chargeData.tenant_id = payment.tenant_id;
              const { data: nc, error: fe } = await supabase.from('ledger_entries').insert(chargeData).select().single();
              if (!fe && nc) feeCharges = [nc];
              else if (fe) console.error(`Failed to create ${category}:`, fe);
            }
          }

          for (const charge of feeCharges || []) {
            if (remainingAmount <= 0) break;
            const toApply = Math.min(remainingAmount, charge.remaining_amount);
            console.log(`Applying ${formatCurrency(toApply, currencyCode)} to ${category} ${charge.id}`);
            const ad: any = { payment_id: paymentId, charge_entry_id: charge.id, amount_applied: toApply };
            if (payment.tenant_id) ad.tenant_id = payment.tenant_id;
            const { error: ae } = await supabase.from('payment_applications').insert(ad);
            if (ae && !ae.message.includes('duplicate key')) { console.error(`${category} app error:`, ae); continue; }
            await supabase.from('ledger_entries').update({ remaining_amount: charge.remaining_amount - toApply }).eq('id', charge.id);
            totalAllocated += toApply;
            remainingAmount -= toApply;
          }
        }
      }

      // Step 2: Allocate remainder to Rental charges
      {
        const { data: outstandingCharges, error: chargesError } = await supabase
          .from('ledger_entries')
          .select('id, amount, remaining_amount, due_date, entry_date, rental_id, vehicle_id')
          .eq('rental_id', payment.rental_id)
          .eq('type', 'Charge')
          .eq('category', 'Rental')
          .gt('remaining_amount', 0)
          .order('due_date', { ascending: true })
          .order('entry_date', { ascending: true });

        if (chargesError) {
          console.error('Error fetching rental charges:', chargesError);
        } else {
          console.log(`Found ${outstandingCharges?.length || 0} outstanding rental charges`);

          for (const charge of outstandingCharges || []) {
            if (remainingAmount <= 0) break;

            const toApply = Math.min(remainingAmount, charge.remaining_amount);
            console.log(`Applying ${formatCurrency(toApply, currencyCode)} to rental charge ${charge.id} (due ${charge.due_date})`);

            const applicationData1: any = { payment_id: paymentId, charge_entry_id: charge.id, amount_applied: toApply };
            if (payment.tenant_id) applicationData1.tenant_id = payment.tenant_id;
            const { error: applicationError } = await supabase.from('payment_applications').insert(applicationData1);
            if (applicationError && !applicationError.message.includes('duplicate key')) { console.error('Payment application error:', applicationError); continue; }

            const { error: chargeUpdateError } = await supabase.from('ledger_entries').update({ remaining_amount: charge.remaining_amount - toApply }).eq('id', charge.id);
            if (chargeUpdateError) { console.error('Charge update error:', chargeUpdateError); continue; }

            // P&L revenue entry
            const pnlData: any = {
              vehicle_id: charge.vehicle_id || payment.vehicle_id, entry_date: charge.due_date,
              side: 'Revenue', category: 'Initial Fees', amount: toApply,
              source_ref: `${paymentId}_${charge.id}`, customer_id: payment.customer_id, rental_id: charge.rental_id
            };
            if (payment.tenant_id) pnlData.tenant_id = payment.tenant_id;
            const { error: pnlErr } = await supabase.from('pnl_entries').insert(pnlData);
            if (pnlErr && !pnlErr.message.includes('duplicate key')) console.error('P&L error:', pnlErr);

            totalAllocated += toApply;
            remainingAmount -= toApply;
          }
        }
      }

      console.log(`Initial Fee allocation complete: ${formatCurrency(totalAllocated, currencyCode)} allocated, ${formatCurrency(remainingAmount, currencyCode)} remaining`);

      // Update payment status
      let paymentStatus = 'Applied';
      if (remainingAmount > 0) {
        paymentStatus = remainingAmount === payment.amount ? 'Credit' : 'Partial';
      }

      await supabase
        .from('payments')
        .update({ status: paymentStatus, remaining_amount: remainingAmount })
        .eq('id', paymentId);

      return {
        ok: true,
        paymentId: paymentId,
        category: 'Initial Fees',
        entryDate: entryDate,
        allocated: totalAllocated,
        remaining: remainingAmount,
        status: paymentStatus
      };
    }

    // Handle customer payments with targeted category allocation
    if (isCustomerPayment) {
      console.log('Processing customer payment - applying targeted category allocation');

      // Idempotency: check how much has already been allocated for this payment
      const { data: existingApps } = await supabase
        .from('payment_applications')
        .select('amount_applied')
        .eq('payment_id', paymentId);
      const alreadyAllocated = (existingApps || []).reduce((sum: number, app: any) => sum + Number(app.amount_applied), 0);

      if (alreadyAllocated >= payment.amount) {
        console.log(`Payment ${paymentId} already fully allocated (${formatCurrency(alreadyAllocated, currencyCode)}), skipping`);
        if (payment.status !== 'Applied') {
          await supabase.from('payments').update({ status: 'Applied', remaining_amount: 0 }).eq('id', paymentId);
        }
        return { ok: true, paymentId, category: 'Payment', entryDate, allocated: alreadyAllocated, remaining: 0, status: 'Applied' };
      }

      let remainingAmount = payment.amount - alreadyAllocated;
      let totalAllocated = alreadyAllocated;
      if (alreadyAllocated > 0) {
        console.log(`Payment ${paymentId} partially allocated: ${formatCurrency(alreadyAllocated, currencyCode)} already applied, ${formatCurrency(remainingAmount, currencyCode)} remaining`);
      }

      // If targetCategories is provided, use those categories directly (supports any ledger category)
      // Otherwise, auto-derive from the rental's actual outstanding charges
      let allocationOrder: { category: string; description: string }[];
      if (targetCategories && targetCategories.length > 0) {
        allocationOrder = targetCategories.map(cat => ({
          category: cat,
          description: `${cat.toLowerCase()} charges`
        }));
        console.log(`Targeted allocation to categories: ${targetCategories.join(', ')}`);
      } else if (payment.rental_id) {
        // Always use full category list — auto-create missing charges from invoice
        allocationOrder = [
          { category: 'Rental', description: 'rental charges' },
          { category: 'Tax', description: 'tax charges' },
          { category: 'Service Fee', description: 'service fee charges' },
          { category: 'Delivery Fee', description: 'delivery fee charges' },
          { category: 'Collection Fee', description: 'collection fee charges' },
          { category: 'Insurance', description: 'insurance charges' },
          { category: 'Extras', description: 'extras charges' },
          { category: 'Extension Rental', description: 'extension rental fee' },
          { category: 'Extension Tax', description: 'extension tax' },
          { category: 'Extension Service Fee', description: 'extension service fee' },
          { category: 'Extension Insurance', description: 'extension insurance' },
          { category: 'Fines', description: 'fine charges' },
          { category: 'Other', description: 'other charges' },
        ];
        console.log('Using full category list with auto-creation from invoice');
      } else {
        // No rental_id and no targetCategories — use all common categories
        allocationOrder = [
          { category: 'Rental', description: 'rental charges' },
          { category: 'Tax', description: 'tax charges' },
          { category: 'Service Fee', description: 'service fee charges' },
          { category: 'Delivery Fee', description: 'delivery fee charges' },
          { category: 'Collection Fee', description: 'collection fee charges' },
          { category: 'Insurance', description: 'insurance charges' },
          { category: 'Extras', description: 'extras charges' },
          { category: 'Extension Rental', description: 'extension rental fee' },
          { category: 'Extension Tax', description: 'extension tax' },
          { category: 'Extension Service Fee', description: 'extension service fee' },
          { category: 'Extension Insurance', description: 'extension insurance' },
          { category: 'Fines', description: 'fine charges' },
          { category: 'Other', description: 'other charges' },
        ];
        console.log('No rental_id, using all common categories');
      }

      for (const { category, description } of allocationOrder) {
        if (remainingAmount <= 0) break;

        console.log(`Checking for outstanding ${description} for customer ${payment.customer_id}`);

        // Build query - if payment has rental_id, prioritize that rental first
        let query = supabase
          .from('ledger_entries')
          .select('id, amount, remaining_amount, due_date, entry_date, rental_id, vehicle_id')
          .eq('customer_id', payment.customer_id)
          .eq('type', 'Charge')
          .eq('category', category)
          .gt('remaining_amount', 0);

        // If payment is linked to a specific rental, filter to only that rental's charges
        if (payment.rental_id) {
          query = query.eq('rental_id', payment.rental_id);
          console.log(`Filtering to rental ${payment.rental_id}`);
        }

        // EXTENSION ISOLATION (Phase 6): if the payment is stamped to a
        // specific rental_extension, restrict allocation to charges tagged
        // with that extension_id so the payment lands on the right
        // extension instead of the oldest unpaid one in the same category.
        if (payment.extension_id && category.startsWith('Extension')) {
          query = query.eq('extension_id', payment.extension_id);
          console.log(`Filtering to extension ${payment.extension_id}`);
        }

        let { data: outstandingCharges, error: chargesError } = await query
          .order('due_date', { ascending: true })
          .order('entry_date', { ascending: true })
          .order('id', { ascending: true });

        // Auto-create ledger charge from invoice if category has no existing charge.
        // For PAYG rentals this is a no-op: the accrual cron is the sole writer of daily
        // Rental/Tax/Service Fee charges, and there is no upfront invoice to materialise.
        if ((!outstandingCharges || outstandingCharges.length === 0) && payment.rental_id && !isPayg) {
          // Security Deposit is intentionally omitted — deposits are held via
          // place-deposit-hold, never auto-created as a ledger charge here.
          const invoiceCategoryMap: Record<string, string> = {
            'Rental': 'rental_fee',
            'Insurance': 'insurance_premium',
            'Service Fee': 'service_fee',
            'Delivery Fee': 'delivery_fee',
            'Tax': 'tax_amount',
            'Extras': 'extras_total',
          };
          const invoiceField = invoiceCategoryMap[category];

          // Collection Fee comes from the rental record, not the invoice
          if (category === 'Collection Fee') {
            // Duplicate guard: if ANY Collection Fee charge already exists for
            // this rental (even one with remaining_amount=0 because it was
            // already paid down by the original booking payment), do NOT
            // auto-create another. Re-creating it produced phantom duplicate
            // $20 Collection Fee rows that got "settled" by uncaptured Stripe
            // checkouts, inflating Collected by $20 every extension.
            // Matches the same guard used for all other categories below.
            const { data: existingCollectionCharge } = await supabase
              .from('ledger_entries')
              .select('id')
              .eq('rental_id', payment.rental_id)
              .eq('type', 'Charge')
              .eq('category', 'Collection Fee')
              .limit(1);

            if (existingCollectionCharge && existingCollectionCharge.length > 0) {
              console.log(`Skipping auto-create for Collection Fee: rental ${payment.rental_id} already has a charge in this category`);
            } else {
              const { data: rental } = await supabase
                .from('rentals')
                .select('collection_fee')
                .eq('id', payment.rental_id)
                .single();

              const collectionAmount = Number(rental?.collection_fee) || 0;
              if (collectionAmount > 0) {
                console.log(`Auto-creating Collection Fee charge from rental: ${formatCurrency(collectionAmount, currencyCode)}`);
                const chargeData: any = {
                  customer_id: payment.customer_id,
                  rental_id: payment.rental_id,
                  vehicle_id: payment.vehicle_id,
                  entry_date: entryDate,
                  type: 'Charge',
                  category: 'Collection Fee',
                  amount: collectionAmount,
                  remaining_amount: collectionAmount,
                  due_date: entryDate,
                };
                if (payment.tenant_id) chargeData.tenant_id = payment.tenant_id;

                const { data: newCharge, error: chargeCreateError } = await supabase
                  .from('ledger_entries')
                  .insert(chargeData)
                  .select()
                  .single();

                if (!chargeCreateError && newCharge) {
                  console.log(`Created Collection Fee charge: ${newCharge.id}`);
                  outstandingCharges = [newCharge];
                } else if (chargeCreateError) {
                  console.error('Failed to create Collection Fee charge:', chargeCreateError);
                }
              }
            }
          } else if (invoiceField) {
            // Duplicate guard: if a charge for this rental+category already exists
            // (even one with remaining_amount=0 that the outstanding query skipped),
            // do NOT auto-create from the invoice — that's how duplicate Insurance
            // charges have been appearing after Bonzah fully pays down its own row.
            const { data: existingAnyCharge } = await supabase
              .from('ledger_entries')
              .select('id')
              .eq('rental_id', payment.rental_id)
              .eq('type', 'Charge')
              .eq('category', category)
              .limit(1);

            if (existingAnyCharge && existingAnyCharge.length > 0) {
              console.log(`Skipping auto-create for ${category}: rental ${payment.rental_id} already has a charge in this category`);
            } else {
              const { data: invoice } = await supabase
                .from('invoices')
                .select('*')
                .eq('rental_id', payment.rental_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              // Use rental.start_date (matches generate_first_charge_for_rental) so
              // the unique index (rental_id, due_date, type, category, extension_id)
              // catches any duplicate regardless of which allocator ran first.
              const { data: rentalForDate } = await supabase
                .from('rentals')
                .select('start_date')
                .eq('id', payment.rental_id)
                .single();
              const chargeDate = rentalForDate?.start_date || invoice?.invoice_date || entryDate;

              const invoiceAmount = invoice?.[invoiceField] || 0;
              if (invoiceAmount > 0) {
                console.log(`Auto-creating ${category} ledger charge from invoice: ${formatCurrency(invoiceAmount, currencyCode)} at ${chargeDate}`);
                const chargeData: any = {
                  customer_id: payment.customer_id,
                  rental_id: payment.rental_id,
                  vehicle_id: payment.vehicle_id,
                  entry_date: chargeDate,
                  type: 'Charge',
                  category: category,
                  amount: invoiceAmount,
                  remaining_amount: invoiceAmount,
                  due_date: chargeDate,
                };
                if (payment.tenant_id) chargeData.tenant_id = payment.tenant_id;

                const { data: newCharge, error: chargeCreateError } = await supabase
                  .from('ledger_entries')
                  .insert(chargeData)
                  .select()
                  .single();

                if (chargeCreateError) {
                  console.error(`Failed to create ${category} ledger charge:`, chargeCreateError);
                } else {
                  console.log(`Created ${category} charge: ${newCharge.id}`);
                  outstandingCharges = [newCharge];
                }
              }
            }
          }
        }

        if (chargesError) {
          console.error(`Error fetching ${description}:`, chargesError);
          continue;
        }

        console.log(`Found ${outstandingCharges?.length || 0} outstanding ${description}`);

        // Apply payment to charges in FIFO order
        for (const charge of outstandingCharges || []) {
          if (remainingAmount <= 0) break;

          const toApply = Math.min(remainingAmount, charge.remaining_amount);
          const chargeDueDate = charge.due_date;

          console.log(`Applying ${formatCurrency(toApply, currencyCode)} to ${category} charge ${charge.id} (due ${chargeDueDate})`);

          // Create payment application record
          const applicationData2: any = {
            payment_id: paymentId,
            charge_entry_id: charge.id,
            amount_applied: toApply
          };
          if (payment.tenant_id) {
            applicationData2.tenant_id = payment.tenant_id;
          }
          const { error: applicationError } = await supabase
            .from('payment_applications')
            .insert(applicationData2);

          if (applicationError && !applicationError.message.includes('duplicate key')) {
            console.error('Payment application error:', applicationError);
            continue;
          }

          // Update charge remaining amount
          const { error: chargeUpdateError } = await supabase
            .from('ledger_entries')
            .update({
              remaining_amount: charge.remaining_amount - toApply
            })
            .eq('id', charge.id);

          if (chargeUpdateError) {
            console.error('Charge update error:', chargeUpdateError);
            continue;
          }

          // Create P&L revenue entry for the applied amount (booked on charge due date)
          const pnlData2: any = {
            vehicle_id: charge.vehicle_id || payment.vehicle_id,
            entry_date: chargeDueDate,
            side: 'Revenue',
            category: category,
            amount: toApply,
            source_ref: `${paymentId}_${charge.id}`,
            customer_id: payment.customer_id,
            rental_id: charge.rental_id
          };
          if (payment.tenant_id) {
            pnlData2.tenant_id = payment.tenant_id;
          }
          const { error: pnlRevenueError } = await supabase
            .from('pnl_entries')
            .insert(pnlData2);

          if (pnlRevenueError && !pnlRevenueError.message.includes('duplicate key')) {
            console.error('P&L revenue entry error:', pnlRevenueError);
          }

          totalAllocated += toApply;
          remainingAmount -= toApply;
        }
      }

      console.log(`Targeted allocation complete: ${formatCurrency(totalAllocated, currencyCode)} allocated, ${formatCurrency(remainingAmount, currencyCode)} remaining`);

      // DIAGNOSTIC: when the caller explicitly targeted categories but we
      // failed to allocate any new amount (e.g. the targeted ledger entry
      // doesn't exist and auto-create was blocked, or customer/rental ids
      // don't match the existing charge), surface it loudly. The payment
      // would otherwise become a silent 'Credit', and the user would stare
      // at "Tax: Not Paid" with no clue why. This warning is the breadcrumb
      // that turns a 30-minute hunt into a 30-second log lookup.
      const newlyAllocated = totalAllocated - alreadyAllocated;
      if (targetCategories && targetCategories.length > 0 && newlyAllocated === 0) {
        console.warn(`[APPLY-PAYMENT] CRITICAL: payment ${paymentId} (amount=${formatCurrency(payment.amount, currencyCode)}) was targeted to categories [${targetCategories.join(', ')}] but ZERO new allocation happened. Possible causes: (a) target category has no outstanding ledger charge AND auto-create was blocked by duplicate guard or missing invoice field; (b) ledger charge customer_id/rental_id does not match payment; (c) extension_id leaked onto payment and stripped the original-rental targets. Inspect ledger_entries for rental ${payment.rental_id} category ${targetCategories.join('/')} and payment ${paymentId} (extension_id=${payment.extension_id ?? 'null'}).`);
      }

      // Update payment status based on allocation
      let paymentStatus = 'Applied';
      if (remainingAmount > 0) {
        paymentStatus = remainingAmount === payment.amount ? 'Credit' : 'Partial';
      }

      const { error: paymentUpdateError } = await supabase
        .from('payments')
        .update({ 
          status: paymentStatus, 
          remaining_amount: remainingAmount 
        })
        .eq('id', paymentId);

      if (paymentUpdateError) {
        console.error('Payment update error:', paymentUpdateError);
      }

      // PAYG: after FIFO has fully consumed the latest open invoice's ledger entries,
      // flip the invoice_status to 'paid' (and supersede priors). Without this, the
      // Stripe-webhook settlement RPC never runs for manual payments and the UI keeps
      // showing "Not paid" even though the ledger is settled. Idempotent — the RPC
      // has WHERE invoice_status='open' guards.
      if (isPayg && payment.rental_id) {
        try {
          const { data: latestOpen } = await supabase
            .from('payg_accruals')
            .select('id, ledger_entry_ids')
            .eq('rental_id', payment.rental_id)
            .eq('invoice_status', 'open')
            .order('accrual_day_index', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latestOpen) {
            const ids = (latestOpen.ledger_entry_ids ?? []) as string[];
            let allPaid = ids.length > 0;
            if (allPaid) {
              const { data: les } = await supabase
                .from('ledger_entries')
                .select('id, remaining_amount')
                .in('id', ids);
              allPaid = (les ?? []).length > 0
                && (les ?? []).every((le: any) => Number(le.remaining_amount || 0) <= 0);
            }
            if (allPaid) {
              const { error: rpcErr } = await supabase.rpc('payg_settle_invoice', {
                p_payment_id: paymentId,
                p_accrual_id: latestOpen.id,
              });
              if (rpcErr) {
                console.error('payg_settle_invoice error:', rpcErr.message ?? rpcErr);
              } else {
                console.log(`PAYG settled invoice ${latestOpen.id} via payment ${paymentId}`);
              }
            } else {
              console.log(`PAYG payment partially covered latest invoice; not settling.`);
            }
          }
        } catch (settleErr: any) {
          // Settlement is best-effort. Payment itself already succeeded.
          console.error('PAYG settlement check failed (non-fatal):', settleErr?.message ?? settleErr);
        }
      }

      // Auto-extension un-pause on the MANUAL / offline payment path.
      // The Stripe extension-checkout webhook already finalizes + un-pauses a
      // renewal when the customer pays the pay-link online. But staff who record
      // a payment here directly (offline bank/cash, or applying an existing
      // captured credit to the parked renewal) hit NO un-pause logic — so the
      // rental stayed paused forever, because the un-pause lived only in the
      // webhook and the auto-extend cron explicitly skips paused rentals
      // (.eq('auto_extend_paused', false)). This mirrors that webhook block for
      // the manual path. Gated on payment.extension_id === the rental's parked
      // pending id, so it can only fire for a payment that IS this renewal, and
      // the pending-id latch (cleared to null below) makes it one-shot: whether
      // apply-payment or the webhook runs first, the other sees pending=null and
      // no-ops, so charge_count can never double-increment.
      if (payment.extension_id && payment.rental_id) {
        try {
          const { data: aeRental } = await supabase
            .from('rentals')
            .select('auto_extend_enabled, auto_extend_pending_extension_id, auto_extend_charge_count')
            .eq('id', payment.rental_id)
            .maybeSingle();

          if (
            aeRental?.auto_extend_enabled &&
            aeRental.auto_extend_pending_extension_id &&
            aeRental.auto_extend_pending_extension_id === payment.extension_id
          ) {
            // finalize_rental_extension marks the extension paid and rolls
            // end_date forward. Idempotent (status only flips approved->paid,
            // paid_amount uses GREATEST), so it is safe even if the webhook
            // already finalized this extension.
            const { error: finalizeErr } = await supabase.rpc('finalize_rental_extension', {
              p_extension_id: payment.extension_id,
              p_payment_id: paymentId,
            });

            if (finalizeErr) {
              console.error('[APPLY-PAYMENT] finalize_rental_extension error:', finalizeErr.message ?? finalizeErr);
            } else {
              // Only clear the parked pending + un-pause AFTER finalize
              // succeeded (mirrors the webhook's finalizeOk gate): if finalize
              // had failed, end_date was not rolled, so we must leave the
              // rental paused with its pending id intact (recoverable).
              const { error: aeSyncErr } = await supabase
                .from('rentals')
                .update({
                  auto_extend_pending_extension_id: null,
                  auto_extend_status: 'active',
                  auto_extend_paused: false,
                  auto_extend_paused_at: null,
                  auto_extend_charge_count: (aeRental.auto_extend_charge_count || 0) + 1,
                  auto_extend_failed_attempts: 0,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', payment.rental_id);
              if (aeSyncErr) {
                console.error('[APPLY-PAYMENT] auto-extend un-pause sync error:', aeSyncErr.message ?? aeSyncErr);
              } else {
                console.log(`[APPLY-PAYMENT] Auto-extend rental ${payment.rental_id} finalized + returned to active via manual payment ${paymentId}`);
              }
            }
          }
        } catch (aeErr: any) {
          // Best-effort: the payment itself already succeeded.
          console.error('[APPLY-PAYMENT] auto-extend post-payment sync failed (non-fatal):', aeErr?.message ?? aeErr);
        }
      }

      return {
        ok: true,
        paymentId: paymentId,
        category: 'Payment',
        entryDate: entryDate,
        allocated: totalAllocated,
        remaining: remainingAmount,
        status: paymentStatus
      };
    }

    // Fallback for other payment types (should not occur with new system)
    console.log('Warning: Unknown payment type, marking as applied without allocation');
    
    await supabase
      .from('payments')
      .update({ status: 'Applied', remaining_amount: 0 })
      .eq('id', paymentId);

    return {
      ok: true,
      paymentId: paymentId,
      category: payment.payment_type,
      entryDate: entryDate
    };

  } catch (error) {
    console.error('Payment processing error:', error);
    return {
      ok: false,
      error: 'Payment processing failed',
      detail: error.message || 'Unknown error occurred'
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration');
      return new Response(JSON.stringify({ 
        error: 'Missing Supabase configuration',
        detail: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (error) {
      return new Response(JSON.stringify({ 
        error: 'Invalid JSON in request body',
        detail: error.message
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const { paymentId, targetCategories, holdAsCredit } = body;

    if (!paymentId) {
      return new Response(JSON.stringify({
        error: 'Payment ID is required',
        detail: 'paymentId field must be provided in request body'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Apply payment using targeted category allocation (auto-derives from rental charges if not specified)
    const result = await applyPayment(supabase, paymentId, targetCategories, holdAsCredit);

    if (!result.ok) {
      return new Response(JSON.stringify(result), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Held-as-credit collections are intentionally unallocated — skip the
    // installment self-heal so we don't settle a slot with money the operator
    // hasn't decided how to apply yet.
    if (holdAsCredit && result.status === 'Credit') {
      return new Response(JSON.stringify(result), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Installment self-heal — runs for payments that are intended to settle a
    // Rental installment slot. The RPC is idempotent; re-applying for an
    // already-paid slot is a no-op.
    //
    // CRITICAL GUARD: when a payment is category-targeted to fees only
    // (Tax, Service Fee, Insurance, Delivery Fee, Collection Fee, Extras, etc.),
    // we MUST NOT settle an installment slot with it. Doing so corrupts the
    // installment plan (e.g. flips `upfront_paid=true` and stamps
    // `upfront_payment_id` with a Tax payment id), and worse, leaves the user
    // staring at "Tax: Not Paid" because the money went toward an installment
    // settlement record while the actual Tax ledger entry stays untouched. The
    // self-heal is only allowed when the payment is NOT category-targeted, or
    // when its targets explicitly include 'Rental'.
    try {
      const { data: payment } = await supabase
        .from('payments')
        .select('id, rental_id, extension_id, target_categories')
        .eq('id', paymentId)
        .maybeSingle();
      const targets: string[] | null = (payment as any)?.target_categories ?? null;
      const isCategoryTargeted = Array.isArray(targets) && targets.length > 0;
      const targetsIncludeRental = isCategoryTargeted && targets!.includes('Rental');
      const allowSelfHeal = !isCategoryTargeted || targetsIncludeRental;
      if (payment?.rental_id && !payment.extension_id && allowSelfHeal) {
        const todayStr = new Date().toISOString().split('T')[0];
        // Latest open overdue/due-today slot. installment_settle_invoice
        // cumulatively supersedes earlier opens, so picking the highest
        // installment_number gives PAYG-style "pay newest, earlier ones clear"
        // behavior. Skips when nothing is due yet (future-only slots).
        const { data: targetSlot } = await supabase
          .from('scheduled_installments')
          .select('id, installment_plan_id, installment_number')
          .eq('rental_id', payment.rental_id)
          .eq('invoice_status', 'open')
          .lte('due_date', todayStr)
          .order('installment_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (targetSlot) {
          const { error: settleErr } = await supabase.rpc('installment_settle_invoice', {
            p_payment_id: payment.id,
            p_installment_id: targetSlot.id,
          });
          if (settleErr) {
            console.error('[APPLY-PAYMENT] installment_settle_invoice error:', settleErr);
          } else {
            console.log('[APPLY-PAYMENT] Installment settled (post-allocation):', targetSlot.id, 'slot', targetSlot.installment_number);
            // Activate the plan if it was still pending; idempotent against
            // already-active plans because we use neq('status','active').
            await supabase
              .from('installment_plans')
              .update({ status: 'active', upfront_paid: true, upfront_payment_id: payment.id })
              .eq('id', targetSlot.installment_plan_id)
              .neq('status', 'active');
          }
        }
      } else if (payment?.rental_id && isCategoryTargeted && !targetsIncludeRental) {
        console.log(`[APPLY-PAYMENT] Skipping installment self-heal: payment ${paymentId} is targeted to non-Rental categories (${targets!.join(', ')}). Installment plan untouched.`);
      }
    } catch (instErr) {
      console.error('[APPLY-PAYMENT] installment self-heal (non-fatal):', instErr);
    }

    return new Response(JSON.stringify(result), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Server error:', error);
    
    return new Response(JSON.stringify({
      ok: false,
      error: 'Internal server error',
      detail: error.message || 'Unknown server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});