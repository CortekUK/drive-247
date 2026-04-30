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

// Per-category default template lookup. Falls back to the standard rental
// agreement when a category does not have a purpose-built default.
export function getDefaultTemplateForCategory(
  category: 'standard' | 'payg' | 'extension' | 'installment'
): string {
  if (category === 'installment') return DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE;
  return DEFAULT_AGREEMENT_TEMPLATE;
}
