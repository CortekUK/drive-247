-- Add a meaningful default 'installment' agreement template for every existing tenant
-- that doesn't already have one. The template uses {{variable}} placeholders that the
-- variable resolver fills in at agreement-generation time.

INSERT INTO public.agreement_templates (tenant_id, template_name, template_content, is_active, template_category)
SELECT
  t.id AS tenant_id,
  'Default Installment Plan Agreement' AS template_name,
$DEFAULT$
VEHICLE RENTAL AGREEMENT — INSTALLMENT PAYMENT PLAN

This agreement is between {{tenant_name}} ("the Operator") and
{{customer_name}} ("the Renter") for the rental of:

   Vehicle:        {{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})
   Rental period:  {{rental_start}} through {{rental_end}}
   Pickup:         {{pickup_location}}
   Return:         {{return_location}}

────────────────────────────────────────────────────────────────────
1. PAYMENT PLAN
────────────────────────────────────────────────────────────────────

The Renter has elected to pay for this rental on an installment plan.

   Plan type:                {{plan_type}} — {{frequency_label}}
   Total rental charges:     {{rental_total}}
   Payable today:            {{upfront_amount}}
        Comprising: {{upfront_breakdown}}
   Splittable into installments: {{splittable_amount}}
   Number of installments:   {{total_installments}}
   Per-installment amount:   {{installment_amount}}
   First installment due:    {{first_payment_date}}
   Final installment due:    {{last_payment_date}}

The full schedule of payments:

{{payment_schedule}}

────────────────────────────────────────────────────────────────────
2. PAYMENT METHOD AND AUTHORISATION
────────────────────────────────────────────────────────────────────

Collection mode: {{collection_mode}}

Where collection mode is "Automatic card charging", the Renter
authorises the Operator to automatically debit the saved payment
method ({{payment_method_label}}) on each scheduled due date listed
above without further notice. This authorisation continues until the
final installment has been paid or the Renter replaces the saved
payment method.

────────────────────────────────────────────────────────────────────
3. CUMULATIVE BALANCE AND MISSED PAYMENTS
────────────────────────────────────────────────────────────────────

{{cumulative_clause}}

In plain language: if a scheduled payment cannot be collected, any
later payments accumulate together with the missed amount. The Renter
will receive a daily email reminder containing a secure link to settle
the full outstanding balance. Settling that link clears all earlier
unpaid installments at once.

────────────────────────────────────────────────────────────────────
4. REMINDER POLICY
────────────────────────────────────────────────────────────────────

{{reminder_policy}}

If three consecutive automatic charge attempts fail because the card
requires re-authentication, the plan is moved to manual collection
and the Renter must complete a new payment via the link in the
reminder email.

────────────────────────────────────────────────────────────────────
5. SECURITY DEPOSIT
────────────────────────────────────────────────────────────────────

A refundable security hold of {{deposit_amount}} is placed on the
Renter's card at the start of the rental period and released after
the vehicle is returned in acceptable condition. The deposit is held
separately from the installment plan and is not part of the
installment schedule.

────────────────────────────────────────────────────────────────────
6. CANCELLATION AND REFUNDS
────────────────────────────────────────────────────────────────────

If the rental is cancelled before commencement, any installments
already paid will be refunded in accordance with the Operator's
cancellation policy, less the non-refundable booking fee. Insurance
premiums are non-refundable once the policy has been activated.

────────────────────────────────────────────────────────────────────
7. ACCEPTANCE
────────────────────────────────────────────────────────────────────

By signing below, the Renter confirms they have read, understood
and agreed to:

   • The full payment schedule above
   • Automatic charging of the saved payment method on each due date
   • The cumulative balance and reminder policy
   • The cancellation and refund terms

Signed by Renter:    ______________________________
                     {{customer_name}}      Date: __________

Signed by Operator:  ______________________________
                     {{tenant_name}}        Date: __________
$DEFAULT$ AS template_content,
  true AS is_active,
  'installment' AS template_category
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.agreement_templates at
  WHERE at.tenant_id = t.id AND at.template_category = 'installment'
);
