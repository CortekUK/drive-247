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
