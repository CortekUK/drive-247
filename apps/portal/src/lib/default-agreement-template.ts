// Default Agreement Template (HTML format for TipTap editor)
// A clean, professional template that tenants can customize

export const DEFAULT_AGREEMENT_TEMPLATE = `<h1>RENTAL AGREEMENT</h1>
<p><strong>Date:</strong> {{agreement_date}} &nbsp;|&nbsp; <strong>Reference:</strong> {{rental_number}}</p>
<hr>
<h2>Parties</h2>
<p><strong>Landlord:</strong> {{company_name}}<br>{{company_email}} | {{company_phone}}</p>
<p><strong>Customer:</strong> {{customer_name}}<br>{{customer_email}} | {{customer_phone}}<br>{{customer_address}}</p>
<hr>
<h2>Vehicle</h2>
<table>
  <tr>
    <td><strong>Registration</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Make & Model</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Year</strong></td>
    <td>{{vehicle_year}}</td>
  </tr>
</table>
<hr>
<h2>Rental Terms</h2>
<table>
  <tr>
    <td><strong>Period</strong></td>
    <td>{{rental_period_type}}</td>
  </tr>
  <tr>
    <td><strong>Start Date</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>End Date</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
  <tr>
    <td><strong>Amount</strong></td>
    <td>{{monthly_amount}}</td>
  </tr>
</table>
<hr>
<h2>Terms & Conditions</h2>
<ol>
  <li>The Customer agrees to rent the vehicle described above for the specified period.</li>
  <li>Payment is due on the agreed schedule. Late payments may incur additional charges.</li>
  <li>The Customer will maintain the vehicle in good condition and return it as received.</li>
  <li>The Customer is responsible for all damage during the rental period.</li>
  <li>The vehicle must not be used for illegal purposes or sub-leased to others.</li>
  <li>Adequate insurance coverage must be maintained throughout the rental.</li>
  <li>Either party may terminate with appropriate notice per company policy.</li>
</ol>
<hr>
<h2>Signatures</h2>
<p><strong>Customer Signature:</strong> _________________________</p>
<p><strong>Date:</strong> _________________________</p>
<p>&nbsp;</p>
<p><strong>{{company_name}} Signature:</strong> _________________________</p>
<p><strong>Date:</strong> _________________________</p>
`;

export const DEFAULT_TEMPLATE_NAME = 'Standard Rental Agreement';
