-- Replace the default installment agreement with a richer, installment-specific
-- body. Only updates the "Default Installment Plan Agreement" rows that haven't
-- been customised yet. ASCII-only to stay compatible with the WinAnsi PDF font.

UPDATE public.agreement_templates
SET template_content = $DEFAULT$
INSTALLMENT PAYMENT PLAN - VEHICLE RENTAL AGREEMENT

Between
   {{tenant_name}} ("the Operator", "we", "us", "our")
and
   {{customer_name}} ("the Renter", "you", "your")

For the rental of:
   Vehicle:        {{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})
   Rental period:  {{rental_start_date}} through {{rental_end_date}}
   Pickup:         {{pickup_location}}
   Return:         {{return_location}}
   Reference:      {{rental_number}}
   Agreement date: {{agreement_date}}

This document supplements the Operator's standard Vehicle Rental Agreement.
Any term defined there has the same meaning here. Where a term in this
document conflicts with the standard agreement, this document prevails for
matters of payment.

--------------------------------------------------------------------
1. WHY THIS AGREEMENT EXISTS
--------------------------------------------------------------------

You have elected NOT to pay for this rental in full at the start of
the rental period. Instead, the Operator has agreed to split the
splittable portion of the rental cost into a series of scheduled
installment payments. This document records:

   (a) the schedule of those payments,
   (b) your authorisation for the Operator to collect them automatically,
   (c) what happens if a payment cannot be collected, and
   (d) your obligations in respect of the saved payment method.

--------------------------------------------------------------------
2. PAYMENT PLAN SUMMARY
--------------------------------------------------------------------

   Plan type:                {{plan_type}} - {{frequency_label}}
   Rental total:             {{rental_total}}
   Payable today:            {{upfront_amount}}
        Comprising:          {{upfront_breakdown}}
   Splittable amount:        {{splittable_amount}}
   Number of installments:   {{total_installments}}
   Per-installment amount:   {{installment_amount}}
   First installment due:    {{first_payment_date}}
   Final installment due:    {{last_payment_date}}
   Collection mode:          {{collection_mode}}
   Saved payment method:     {{payment_method_label}}

For clarity: insurance premiums, the refundable security deposit, the
booking fee and any delivery fee are NOT split. They are collected in
full as part of the upfront amount above. Only the rental base, taxes
and the Operator's service fee are split into installments.

--------------------------------------------------------------------
3. FULL PAYMENT SCHEDULE
--------------------------------------------------------------------

The full schedule of installments under this plan is:

{{payment_schedule}}

Each installment is due at the start of the day shown. The Operator's
collection cron evaluates due installments shortly after midnight in the
Operator's local time zone.

--------------------------------------------------------------------
4. AUTHORISATION FOR AUTOMATIC CHARGING (OFF-SESSION)
--------------------------------------------------------------------

Where the collection mode is "Automatic card charging", you expressly
authorise the Operator (and its payment processor, Stripe) to debit
the saved payment method shown in section 2 for each installment
listed in section 3, on each scheduled due date, without further
consent or notification.

You confirm that:
   (a) you are the named cardholder, or are otherwise authorised to
       use the card to pay for this rental,
   (b) the card will remain valid and adequately funded throughout
       the plan,
   (c) you understand each charge is an "off-session" charge under
       PSD2 / card-scheme rules, and may be subject to issuer-driven
       Strong Customer Authentication ("SCA") at any time, and
   (d) you will not initiate a chargeback for any installment that
       has been charged in accordance with this schedule.

This authorisation continues until the final installment has been
paid in full or the Operator confirms in writing that the plan has
been terminated.

--------------------------------------------------------------------
5. CUMULATIVE BALANCE AND MISSED PAYMENTS
--------------------------------------------------------------------

{{cumulative_clause}}

In plain language: if a scheduled payment cannot be collected, any
later payments accumulate together with the missed amount. You will
receive a daily email reminder containing a secure link to settle the
full outstanding balance. Settling that link clears all earlier
unpaid installments at once.

--------------------------------------------------------------------
6. REMINDER POLICY
--------------------------------------------------------------------

{{reminder_policy}}

Reminder emails will be sent to the email address on file for the
Renter. If the email address changes, you must update it in the
customer portal. Reminders sent to the previous address will still
count as delivered notice for the purposes of this agreement.

--------------------------------------------------------------------
7. DEFAULT, GRACE PERIOD AND ACCELERATION
--------------------------------------------------------------------

If three (3) consecutive automatic charge attempts fail because the
saved card requires re-authentication, the plan will be moved to
manual collection and the saved card will no longer be charged
without your direct action.

If the cumulative outstanding balance remains unpaid for seven (7)
calendar days after a missed installment, the Operator may, at its
sole discretion:

   (a) declare the plan in default,
   (b) accelerate the schedule so that ALL remaining installments
       become immediately due and payable,
   (c) recover the vehicle in accordance with the standard rental
       agreement,
   (d) report the outstanding balance to a debt collection agency or
       small claims process, and
   (e) refuse to enter into future installment plans with you.

Acceleration does not waive any other right under the standard rental
agreement, including charges for late return, mileage overage, or
damage.

--------------------------------------------------------------------
8. EARLY SETTLEMENT
--------------------------------------------------------------------

You may settle the outstanding balance in full at any time by using
the "Pay off remaining" action in the customer portal, or by paying
the Operator directly via any method shown on your invoice. There is
NO early-settlement penalty. Once the final balance is settled, the
authorisation in section 4 ends automatically.

--------------------------------------------------------------------
9. SECURITY DEPOSIT
--------------------------------------------------------------------

A refundable security hold of {{deposit_amount}} is placed on the
Renter's card at the start of the rental period and released after
the vehicle is returned in acceptable condition. The deposit is held
SEPARATELY from this installment plan, is not split into installments,
and does not count toward any unpaid balance.

--------------------------------------------------------------------
10. CANCELLATION AND REFUNDS
--------------------------------------------------------------------

If the rental is cancelled before commencement, any installments
already paid (less the non-refundable booking fee and any insurance
premium where the policy has activated) will be refunded to the
saved card within fourteen (14) calendar days. Future-dated
installments will not be charged.

If the rental is cancelled after commencement, the Operator may
retain installments already paid up to the value of the rental days
already consumed plus any applicable cancellation fee per the
standard agreement.

Insurance premiums are non-refundable once the underwriter has
confirmed activation of the policy.

--------------------------------------------------------------------
11. KEEPING THE SAVED CARD CURRENT
--------------------------------------------------------------------

You must maintain a valid, in-date payment method for the duration
of the plan. If the card is replaced, expired, lost, or otherwise
becomes unusable, you must update the saved payment method in the
customer portal before the next scheduled installment.

Failure to keep a valid card on file is a breach of this agreement
and may, at the Operator's discretion, trigger the default and
acceleration clause in section 7.

--------------------------------------------------------------------
12. COMMUNICATIONS
--------------------------------------------------------------------

You consent to receive payment reminders, receipts, default notices,
and other plan-related communications by email at the address on file.
You may also receive optional SMS or WhatsApp reminders if these
channels are configured by the Operator and not separately opted out.

--------------------------------------------------------------------
13. ACCEPTANCE
--------------------------------------------------------------------

By signing below, the Renter confirms that they:

   * have read, understood and agreed to the full payment schedule
     in section 3,
   * authorise the automatic charging of the saved payment method
     under section 4,
   * accept the cumulative-balance and reminder policy in sections 5-6,
   * understand the default, grace period and acceleration terms in
     section 7,
   * accept the cancellation and refund terms in section 10, and
   * undertake to keep a valid payment method on file as required by
     section 11.


Signed by Renter:    ______________________________
                     {{customer_name}}      Date: __________


Signed by Operator:  ______________________________
                     {{tenant_name}}        Date: __________
$DEFAULT$,
    updated_at = now()
WHERE template_category = 'installment'
  AND template_name = 'Default Installment Plan Agreement';
