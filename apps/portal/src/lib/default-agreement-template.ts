// Default Agreement Template (HTML format for TipTap editor)
// Full rental agreement with vehicle details, customer info, and Terms & Conditions

export const DEFAULT_AGREEMENT_TEMPLATE = `<h1>RENTAL AGREEMENT</h1>
<p><strong>Agreement Date:</strong> {{agreement_date}}</p>
<p><strong>Rental Reference:</strong> {{rental_number}}</p>
<hr>

<h2>Vehicle Details</h2>
<table>
<tr><td><strong>Make</strong></td><td>{{vehicle_make}}</td></tr>
<tr><td><strong>Model</strong></td><td>{{vehicle_model}}</td></tr>
<tr><td><strong>Year</strong></td><td>{{vehicle_year}}</td></tr>
<tr><td><strong>Registration</strong></td><td>{{vehicle_reg}}</td></tr>
<tr><td><strong>Color</strong></td><td>{{vehicle_color}}</td></tr>
</table>

<h2>Customer Details</h2>
<table>
<tr><td><strong>Name</strong></td><td>{{customer_name}}</td></tr>
<tr><td><strong>Email</strong></td><td>{{customer_email}}</td></tr>
<tr><td><strong>Phone</strong></td><td>{{customer_phone}}</td></tr>
<tr><td><strong>License Number</strong></td><td>{{customer_license_number}}</td></tr>
</table>

<h2>Rental Period</h2>
<table>
<tr><td><strong>Start Date</strong></td><td>{{rental_start_date}}</td></tr>
<tr><td><strong>End Date</strong></td><td>{{rental_end_date}}</td></tr>
<tr><td><strong>Rental Price</strong></td><td>{{rental_price}} ({{rental_period_type}})</td></tr>
</table>

{{installment_schedule}}

<hr>

<h2>Terms & Conditions</h2>
<p>The Customer agrees to rent the vehicle described above for the specified rental period and confirms that all information provided is accurate and complete.</p>
<p>Payment is due in accordance with the agreed schedule. Late payments, failed authorizations, or chargebacks may result in additional charges or immediate termination of the rental.</p>
<p>The vehicle is provided in safe, operable condition. The Customer agrees to return the vehicle on time, in substantially the same condition as received, reasonable wear and tear excepted. The Customer is responsible for fuel level, cleanliness, and any excessive wear, damage, or loss occurring during the rental period.</p>
<p>The vehicle may be used for lawful purposes only and may not be subleased, sold, or operated by any driver not expressly authorized by the rental company. Prohibited use includes, but is not limited to, racing, towing (unless approved), off-road use, or operation while impaired.</p>
<p>The Customer assumes full responsibility for any loss, damage, theft, or liability arising during the rental period, including loss of use, diminution of value, towing, storage, administrative, and recovery fees, unless such amounts are expressly covered by an accepted protection product.</p>
<h3>Insurance & Liability</h3>
<p>The rental company does not provide primary automobile liability insurance unless explicitly stated in writing. The Customer confirms that they maintain valid automobile liability insurance or have elected to purchase optional protection products, if offered. Optional protection products are subject to separate terms, may be administered by third-party providers, and are not insurance unless expressly stated. Coverage exclusions may apply. The rental company makes no representation as to the adequacy of any insurance or protection selected.</p>
<p>The Customer is solely responsible for all traffic violations, parking tickets, tolls, congestion charges, and related administrative fees incurred during the rental period, including those processed after vehicle return.</p>
<p>The rental company reserves the right to terminate this agreement immediately in the event of misuse, non-payment, or breach of these terms. Early termination does not relieve the Customer of outstanding charges.</p>
<p>This agreement shall be governed by the laws of the State in which the rental company operates, without regard to conflict-of-law principles.</p>
<p><strong>By signing below, the Customer acknowledges that they have read, understood, and agree to these Terms & Conditions.</strong></p>

<hr>

<h2>Signatures</h2>
<p><strong>Customer Signature:</strong> _______________________________</p>
<p><strong>Date:</strong> _______________________________</p>
<p>&nbsp;</p>
<p><strong>For {{company_name}}</strong></p>
<p><strong>Authorized Signature:</strong> _______________________________</p>
<p><strong>Date:</strong> _______________________________</p>
`;

// PAYG-tailored default template — covers daily accrual, pre-auth hold, reminders,
// pause/finalize semantics, and the open-ended duration model.
export const PAYG_AGREEMENT_TEMPLATE = `<h1>PAY AS YOU GO RENTAL AGREEMENT</h1>
<p><strong>Agreement Date:</strong> {{agreement_date}}</p>
<p><strong>Rental Reference:</strong> {{rental_number}}</p>
<p><strong>Billing Model:</strong> Pay As You Go (open-ended daily billing)</p>
<hr>

<h2>Vehicle Details</h2>
<table>
<tr><td><strong>Make</strong></td><td>{{vehicle_make}}</td></tr>
<tr><td><strong>Model</strong></td><td>{{vehicle_model}}</td></tr>
<tr><td><strong>Year</strong></td><td>{{vehicle_year}}</td></tr>
<tr><td><strong>Registration</strong></td><td>{{vehicle_reg}}</td></tr>
<tr><td><strong>Color</strong></td><td>{{vehicle_color}}</td></tr>
<tr><td><strong>VIN</strong></td><td>{{vehicle_vin}}</td></tr>
</table>

<h2>Customer Details</h2>
<table>
<tr><td><strong>Name</strong></td><td>{{customer_name}}</td></tr>
<tr><td><strong>Email</strong></td><td>{{customer_email}}</td></tr>
<tr><td><strong>Phone</strong></td><td>{{customer_phone}}</td></tr>
<tr><td><strong>Address</strong></td><td>{{customer_address}}</td></tr>
<tr><td><strong>License / ID Number</strong></td><td>{{customer_license_number}}</td></tr>
</table>

<h2>Rental Period & Pricing</h2>
<table>
<tr><td><strong>Start Date</strong></td><td>{{rental_start_date}}</td></tr>
<tr><td><strong>End Date</strong></td><td>{{rental_end_date}}</td></tr>
<tr><td><strong>Daily Rate</strong></td><td>{{vehicle_daily_rent}}</td></tr>
<tr><td><strong>Pickup Location</strong></td><td>{{pickup_location}}</td></tr>
<tr><td><strong>Return Location</strong></td><td>{{return_location}}</td></tr>
</table>
<p><em>Pay As You Go rentals are open-ended. The End Date is shown as "Ongoing" because the rental continues to accrue daily charges until the Customer requests return and the Rental Company closes the rental.</em></p>

<hr>

<h2>How Pay As You Go Billing Works</h2>
<p>This is not a fixed-term rental and there is no upfront total invoice. The Customer is billed daily, in arrears, for as long as the vehicle is in their possession.</p>
<ol>
<li><strong>Daily charge.</strong> Every 24 hours from the rental start time, the Customer is charged the Daily Rate above, plus any applicable tax and service fee configured by the Rental Company. The first daily charge posts at the end of the first 24-hour window.</li>
<li><strong>Pre-authorization hold.</strong> At the start of the rental, the Rental Company places a pre-authorization hold on the Customer's payment method equal to two (2) days of the Daily Rate. This hold secures the rental and is released or captured against actual charges in accordance with the card network's rules.</li>
<li><strong>Payment allocation.</strong> Payments received from the Customer are applied to the oldest unpaid daily charge first (first-in, first-out). Partial payments reduce the outstanding balance but do not pause daily accrual.</li>
<li><strong>Final day.</strong> When the Customer returns the vehicle and the Rental Company closes the rental, a final pro-rated charge is posted for the time elapsed since the most recent 24-hour accrual.</li>
</ol>

<h2>Payment Obligations & Reminders</h2>
<p>The Customer authorizes the Rental Company to charge the payment method on file for all amounts that accrue under this Agreement, including the daily rate, taxes, service fees, tolls, fines, damage charges, and any other amounts owed.</p>
<ul>
<li><strong>Reminders.</strong> The Rental Company will send periodic payment reminders by email (and, where enabled, SMS or WhatsApp) showing the outstanding balance and the number of days the rental has been active. Reminders begin after a short grace period from the rental start (typically two (2) days) and recur on a regular cadence (typically every four (4) days) until the balance is settled or a maximum reminder count is reached. Exact intervals follow the Rental Company's current configuration.</li>
<li><strong>Non-payment.</strong> If the Customer's payment method declines, expires, or is revoked, the Customer remains liable for all accrued charges. The Rental Company may suspend, terminate, or recover the vehicle, report the account for collection, and pursue all remedies available under applicable law.</li>
<li><strong>Disputes.</strong> Any chargeback or dispute initiated against legitimate charges under this Agreement constitutes a material breach and may result in immediate termination and recovery of the vehicle.</li>
</ul>

<h2>Pause, Finalization & Maximum Duration</h2>
<ul>
<li><strong>Pause.</strong> The Rental Company may, at its sole discretion, pause the daily accrual (for example, while the vehicle is undergoing maintenance the Customer did not cause). No daily charges accrue during a paused period. The Customer cannot self-pause the rental.</li>
<li><strong>Finalization.</strong> The rental ends only when the Customer returns the vehicle to the Return Location (or another location agreed in writing) and the Rental Company marks the rental as closed. Until then, daily charges continue to accrue.</li>
<li><strong>Maximum duration.</strong> For safety and review purposes, daily accrual may automatically pause if the rental exceeds a configured maximum duration (typically ninety (90) days). The Customer remains in possession of the vehicle subject to all other terms of this Agreement, and the Rental Company will contact the Customer to convert, close, or extend the arrangement.</li>
</ul>

<hr>

<h2>Use of Vehicle</h2>
<p>The vehicle is provided in safe, operable condition. The Customer agrees to operate the vehicle lawfully, with a valid driver's license, and only for the purposes permitted by this Agreement. The vehicle may not be subleased, sold, used for commercial passenger transport without written authorization, raced, used for towing (unless approved), driven off-road, or operated by any driver not expressly authorized by the Rental Company. The vehicle may not be operated while the driver is impaired by alcohol, drugs, or any substance that affects safe operation.</p>
<p>The Customer is responsible for fuel level, cleanliness, all tolls, congestion charges, parking fees, traffic violations, and any administrative fees associated with such items, including those processed after the vehicle is returned.</p>

<h2>Damage, Loss & Liability</h2>
<p>The Customer assumes full responsibility for any loss, damage, theft, or liability arising during the rental period, including diminution of value, loss of use, towing, storage, administrative, and recovery fees, unless such amounts are expressly covered by an accepted protection product.</p>
<p>The Rental Company does not provide primary automobile liability insurance unless explicitly stated in writing. The Customer confirms that they maintain valid automobile liability insurance or have elected to purchase optional protection products, if offered. Optional protection products are subject to separate terms, may be administered by third-party providers, and are not insurance unless expressly stated. Coverage exclusions may apply. The Rental Company makes no representation as to the adequacy of any insurance or protection selected.</p>

<h2>Termination</h2>
<p>The Rental Company may terminate this Agreement and recover the vehicle at any time in the event of non-payment, payment-method failure, misuse, breach of these terms, or any conduct that creates a risk to the vehicle or third parties. Termination does not relieve the Customer of any outstanding charges accrued through the date of termination, including the final pro-rated day and any recovery costs.</p>

<h2>Governing Law</h2>
<p>This Agreement shall be governed by the laws of the jurisdiction in which the Rental Company operates, without regard to conflict-of-law principles.</p>

<p><strong>By signing below, the Customer acknowledges that they have read, understood, and agree to the Pay As You Go billing model and all Terms & Conditions above, and authorizes the Rental Company to charge the payment method on file for all amounts that accrue under this Agreement until the rental is closed.</strong></p>

<hr>

<h2>Signatures</h2>
<p><strong>Customer Signature:</strong> _______________________________</p>
<p><strong>Date:</strong> _______________________________</p>
<p>&nbsp;</p>
<p><strong>For {{company_name}}</strong></p>
<p><strong>Authorized Signature:</strong> _______________________________</p>
<p><strong>Date:</strong> _______________________________</p>
`;

// Extension-tailored default template — for agreements sent when the rental
// is being extended past its original end date. References the original rental
// and the extension period only; carries forward all terms of the original.
export const EXTENSION_AGREEMENT_TEMPLATE = `<h1>RENTAL EXTENSION AGREEMENT</h1>
<p><strong>Agreement Date:</strong> {{agreement_date}}</p>
<p><strong>Rental Reference:</strong> {{rental_number}}</p>
<p><strong>Extension Number:</strong> #{{extension_number}}</p>
<hr>

<h2>Original Rental</h2>
<table>
<tr><td><strong>Rental Reference</strong></td><td>{{rental_number}}</td></tr>
<tr><td><strong>Customer</strong></td><td>{{customer_name}}</td></tr>
<tr><td><strong>Vehicle</strong></td><td>{{vehicle_year}} {{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td></tr>
<tr><td><strong>Original Start Date</strong></td><td>{{rental_start_date}}</td></tr>
<tr><td><strong>Previous End Date</strong></td><td>{{extension_previous_end_date}}</td></tr>
</table>

<h2>Extension Period</h2>
<table>
<tr><td><strong>Extension #</strong></td><td>{{extension_number}}</td></tr>
<tr><td><strong>Extension Starts</strong></td><td>{{extension_previous_end_date}}</td></tr>
<tr><td><strong>New End Date</strong></td><td>{{extension_new_end_date}}</td></tr>
<tr><td><strong>Additional Days</strong></td><td>{{extension_days}}</td></tr>
<tr><td><strong>Rate ({{rental_period_type}})</strong></td><td>{{rental_price}}</td></tr>
</table>

{{installment_schedule}}

<hr>

<h2>Purpose of This Agreement</h2>
<p>This document is an extension to the existing Rental Agreement identified above (the "Original Agreement"). The Customer is requesting, and the Rental Company is granting, additional use of the same vehicle from the Previous End Date through the New End Date shown above. No other terms of the Original Agreement are renegotiated by this extension.</p>

<h2>Continuation of Original Terms</h2>
<p>All terms, conditions, obligations, and protections set out in the Original Agreement — including without limitation those covering use of vehicle, prohibited use, fuel and condition on return, traffic violations and tolls, damage and loss, insurance and liability, payment authorization, late payment, chargebacks, termination, and governing law — remain in full force during this extension period. The Customer reaffirms each of those terms by signing this extension.</p>

<h2>Charges for This Extension</h2>
<p>The Customer agrees to pay all charges associated with this extension period, including the rental rate, taxes, service fees, tolls, fines, and any damage or loss incurred during the extension. Charges accrue under the same billing cadence as the Original Agreement (upfront for fixed-term extensions, or per the installment schedule above where applicable).</p>
<ul>
<li><strong>Payment authorization.</strong> The Customer authorizes the Rental Company to charge the payment method on file for all amounts arising under this extension. Failed payments, expired cards, declines, or chargebacks may result in immediate termination and recovery of the vehicle.</li>
<li><strong>Pre-authorization.</strong> Where required, the Rental Company may place an additional pre-authorization hold on the Customer's payment method to cover the extension period. This hold is released or captured against actual charges in accordance with the card network's rules.</li>
<li><strong>No further extension implied.</strong> Granting this extension does not entitle the Customer to any further extension. Each subsequent extension requires a separate written agreement.</li>
</ul>

<h2>Vehicle Condition &amp; Return</h2>
<p>The Customer acknowledges that the vehicle remains in safe, operable condition as of the start of this extension and accepts the vehicle in its current state. The Customer agrees to return the vehicle by the New End Date, in substantially the same condition, fueled and clean to the same standard required under the Original Agreement, reasonable wear and tear excepted.</p>
<p>If the vehicle is not returned by the New End Date and no further extension has been agreed in writing, the Rental Company may treat the vehicle as overdue, terminate the rental, charge a late return fee in accordance with its policy, and pursue recovery of the vehicle and all amounts owed.</p>

<h2>Termination</h2>
<p>The Rental Company may terminate this extension and recover the vehicle at any time in the event of non-payment, payment-method failure, misuse, breach of these or the Original Agreement's terms, or any conduct that creates a risk to the vehicle or third parties. Termination of this extension does not relieve the Customer of any outstanding charges accrued through the date of termination, including under the Original Agreement.</p>

<p><strong>By signing below, the Customer acknowledges that they have read and understood this Extension Agreement, reaffirm all terms of the Original Rental Agreement, and authorize the Rental Company to charge the payment method on file for all amounts that accrue during the extension period.</strong></p>

<hr>

<h2>Signatures</h2>
<p><strong>Customer Signature:</strong> _______________________________</p>
<p><strong>Date:</strong> _______________________________</p>
<p>&nbsp;</p>
<p><strong>For {{company_name}}</strong></p>
<p><strong>Authorized Signature:</strong> _______________________________</p>
<p><strong>Date:</strong> _______________________________</p>
`;

export const DEFAULT_TEMPLATE_NAME = 'Default Template';

// Template type identifier
export type TemplateType = 'default' | 'custom';

// Default Installment Plan Agreement (HTML format for TipTap editor)
// Purpose-built for an installment plan: explains why the agreement exists,
// embeds the full schedule, off-session charging authorisation, default/
// acceleration terms, and the duty to keep the saved card current.
// Mirrors the SQL v2 seed used by 20260427120800_installment_agreement_template_v2.sql
// so portal-side reset / fresh-tenant init match the DB content.
export const DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE = `<h1>Installment Payment Plan — Vehicle Rental Agreement</h1>
<p><strong>Operator:</strong> {{tenant_name}}</p>
<p><strong>Renter:</strong> {{customer_name}}</p>
<p><strong>Agreement Date:</strong> {{agreement_date}}</p>
<p><strong>Rental Reference:</strong> {{rental_number}}</p>
<hr>

<h2>Rental Summary</h2>
<table>
<tr><td><strong>Vehicle</strong></td><td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td></tr>
<tr><td><strong>Rental Period</strong></td><td>{{rental_start_date}} to {{rental_end_date}}</td></tr>
<tr><td><strong>Pickup</strong></td><td>{{pickup_location}}</td></tr>
<tr><td><strong>Return</strong></td><td>{{return_location}}</td></tr>
</table>
<p><em>This document supplements the Operator's standard Vehicle Rental Agreement. Terms defined there have the same meaning here. Where this document conflicts with the standard agreement, this document prevails for matters of payment.</em></p>

<hr>

<h2>1. Why this agreement exists</h2>
<p>You have elected <strong>not</strong> to pay for this rental in full at the start of the rental period. Instead, the Operator has agreed to split the splittable portion of the rental cost into a series of scheduled installment payments. This document records:</p>
<ul>
<li>the schedule of those payments,</li>
<li>your authorisation for the Operator to collect them automatically,</li>
<li>what happens if a payment cannot be collected, and</li>
<li>your obligations in respect of the saved payment method.</li>
</ul>

<h2>2. Payment plan summary</h2>
<table>
<tr><td><strong>Plan type</strong></td><td>{{plan_type}} — {{frequency_label}}</td></tr>
<tr><td><strong>Rental total</strong></td><td>{{rental_total}}</td></tr>
<tr><td><strong>Payable today</strong></td><td>{{upfront_amount}}</td></tr>
<tr><td><strong>Comprising</strong></td><td>{{upfront_breakdown}}</td></tr>
<tr><td><strong>Splittable amount</strong></td><td>{{splittable_amount}}</td></tr>
<tr><td><strong>Number of installments</strong></td><td>{{total_installments}}</td></tr>
<tr><td><strong>Per-installment amount</strong></td><td>{{installment_amount}}</td></tr>
<tr><td><strong>First installment due</strong></td><td>{{first_payment_date}}</td></tr>
<tr><td><strong>Final installment due</strong></td><td>{{last_payment_date}}</td></tr>
<tr><td><strong>Collection mode</strong></td><td>{{collection_mode}}</td></tr>
<tr><td><strong>Saved payment method</strong></td><td>{{payment_method_label}}</td></tr>
</table>
<p>For clarity: insurance premiums, the refundable security deposit, the booking fee and any delivery fee are <strong>not</strong> split. They are collected in full as part of the upfront amount above. Only the rental base, taxes and the Operator's service fee are split into installments.</p>

<h2>3. Full payment schedule</h2>
<p>The full schedule of installments under this plan is:</p>
<p>{{payment_schedule}}</p>
<p>Each installment is due at the start of the day shown. The Operator's collection process evaluates due installments shortly after midnight in the Operator's local time zone.</p>

<h2>4. Authorisation for automatic charging (off-session)</h2>
<p>Where the collection mode is <strong>"Automatic card charging"</strong>, you expressly authorise the Operator (and its payment processor, Stripe) to debit the saved payment method shown in section 2 for each installment listed in section 3, on each scheduled due date, without further consent or notification.</p>
<p>You confirm that:</p>
<ul>
<li>you are the named cardholder, or are otherwise authorised to use the card to pay for this rental;</li>
<li>the card will remain valid and adequately funded throughout the plan;</li>
<li>you understand each charge is an "off-session" charge under PSD2 / card-scheme rules, and may be subject to issuer-driven Strong Customer Authentication ("SCA") at any time; and</li>
<li>you will not initiate a chargeback for any installment that has been charged in accordance with this schedule.</li>
</ul>
<p>This authorisation continues until the final installment has been paid in full or the Operator confirms in writing that the plan has been terminated.</p>

<h2>5. Cumulative balance and missed payments</h2>
<p>{{cumulative_clause}}</p>
<p>In plain language: if a scheduled payment cannot be collected, any later payments accumulate together with the missed amount. You will receive a daily email reminder containing a secure link to settle the full outstanding balance. Settling that link clears all earlier unpaid installments at once.</p>

<h2>6. Reminder policy</h2>
<p>{{reminder_policy}}</p>
<p>Reminder emails will be sent to the email address on file for the Renter ({{customer_email}}). If the email address changes, you must update it in the customer portal. Reminders sent to the previous address will still count as delivered notice for the purposes of this agreement.</p>

<h2>7. Default, grace period and acceleration</h2>
<p>If <strong>three (3) consecutive automatic charge attempts fail</strong> because the saved card requires re-authentication, the plan will be moved to manual collection and the saved card will no longer be charged without your direct action.</p>
<p>If the cumulative outstanding balance remains unpaid for <strong>seven (7) calendar days</strong> after a missed installment, the Operator may, at its sole discretion:</p>
<ul>
<li>declare the plan in default,</li>
<li>accelerate the schedule so that <strong>all remaining installments become immediately due and payable</strong>,</li>
<li>recover the vehicle in accordance with the standard rental agreement,</li>
<li>report the outstanding balance to a debt collection agency or small claims process, and</li>
<li>refuse to enter into future installment plans with you.</li>
</ul>
<p>Acceleration does not waive any other right under the standard rental agreement, including charges for late return, mileage overage, or damage.</p>

<h2>8. Early settlement</h2>
<p>You may settle the outstanding balance in full at any time by using the <strong>"Pay off remaining"</strong> action in the customer portal, or by paying the Operator directly via any method shown on your invoice. There is <strong>no early-settlement penalty</strong>. Once the final balance is settled, the authorisation in section 4 ends automatically.</p>

<h2>9. Security deposit</h2>
<p>A refundable security hold of <strong>{{deposit_amount}}</strong> is placed on the Renter's card at the start of the rental period and released after the vehicle is returned in acceptable condition. The deposit is held <strong>separately</strong> from this installment plan, is not split into installments, and does not count toward any unpaid balance.</p>

<h2>10. Cancellation and refunds</h2>
<p>If the rental is cancelled <strong>before commencement</strong>, any installments already paid (less the non-refundable booking fee and any insurance premium where the policy has activated) will be refunded to the saved card within <strong>fourteen (14) calendar days</strong>. Future-dated installments will not be charged.</p>
<p>If the rental is cancelled <strong>after commencement</strong>, the Operator may retain installments already paid up to the value of the rental days already consumed plus any applicable cancellation fee per the standard agreement.</p>
<p>Insurance premiums are non-refundable once the underwriter has confirmed activation of the policy.</p>

<h2>11. Keeping the saved card current</h2>
<p>You must maintain a valid, in-date payment method for the duration of the plan. If the card is replaced, expired, lost, or otherwise becomes unusable, you must update the saved payment method in the customer portal <strong>before the next scheduled installment</strong>.</p>
<p>Failure to keep a valid card on file is a breach of this agreement and may, at the Operator's discretion, trigger the default and acceleration clause in section 7.</p>

<h2>12. Communications consent</h2>
<p>You consent to receive payment reminders, receipts, default notices, and other plan-related communications by email at the address on file. You may also receive optional SMS or WhatsApp reminders if these channels are configured by the Operator and not separately opted out. You may opt out of optional channels at any time without affecting email reminders, which are mandatory while the plan is active.</p>

<h2>13. Acceptance</h2>
<p>By signing below, the Renter confirms that they:</p>
<ul>
<li>have read, understood and agreed to the full payment schedule in section 3;</li>
<li>authorise the automatic charging of the saved payment method under section 4;</li>
<li>accept the cumulative-balance and reminder policy in sections 5–6;</li>
<li>understand the default, grace period and acceleration terms in section 7;</li>
<li>accept the cancellation and refund terms in section 10; and</li>
<li>undertake to keep a valid payment method on file as required by section 11.</li>
</ul>

<hr>

<h2>Signatures</h2>
<p><strong>Renter:</strong> {{customer_name}}</p>
<p><strong>Signature:</strong> {{@sig1}}</p>
<p><strong>Date:</strong> {{@date1}}</p>
<p>&nbsp;</p>
<p><strong>For and on behalf of {{tenant_name}}</strong></p>
<p><strong>Authorised Signature:</strong> _______________________________</p>
<p><strong>Date:</strong> _______________________________</p>
`;

// Template category — defined here (not in the hook) so getDefaultTemplateForCategory
// can reference it without creating a circular import.
export type TemplateCategory = 'standard' | 'payg' | 'extension' | 'installment';

// Per-category default template lookup. Each category routes to its purpose-built
// template; standard / unknown categories fall back to DEFAULT_AGREEMENT_TEMPLATE.
export function getDefaultTemplateForCategory(category: TemplateCategory): string {
  switch (category) {
    case 'payg':
      return PAYG_AGREEMENT_TEMPLATE;
    case 'extension':
      return EXTENSION_AGREEMENT_TEMPLATE;
    case 'installment':
      return DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE;
    default:
      return DEFAULT_AGREEMENT_TEMPLATE;
  }
}
