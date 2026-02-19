// Default Email Templates
// These are the default templates used when a tenant hasn't customized their email templates
// Templates are designed to be professional and ready-to-use with minimal changes needed

export interface DefaultEmailTemplate {
  key: string;
  name: string;
  subject: string;
  content: string;
}

export const DEFAULT_EMAIL_TEMPLATES: DefaultEmailTemplate[] = [
  {
    key: 'booking_pending',
    name: 'Booking Pending',
    subject: 'Booking Received - {{rental_number}} | {{company_name}}',
    content: `<h1>Thank You for Your Booking Request</h1>

<p>Dear {{customer_name}},</p>

<p>Thank you for choosing <strong>{{company_name}}</strong> for your vehicle rental needs. We have successfully received your booking request and our team is currently reviewing it.</p>

<p>You can expect to receive a confirmation email within <strong>24 hours</strong> once your booking has been approved.</p>

<hr>

<h2>Booking Summary</h2>

<table>
  <tr>
    <td><strong>Booking Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Registration:</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Pickup Date:</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
  <tr>
    <td><strong>Rental Amount:</strong></td>
    <td>{{rental_amount}}</td>
  </tr>
</table>

<hr>

<h2>What Happens Next?</h2>

<ol>
  <li>Our team will review your booking details and verify availability</li>
  <li>You will receive a confirmation email once approved</li>
  <li>A rental agreement will be sent for your electronic signature</li>
  <li>Bring your valid driving licence and booking confirmation on pickup day</li>
</ol>

<p><strong>Please Note:</strong> A temporary hold has been placed on your payment card. This will only be charged once your booking is confirmed.</p>

<hr>

<h2>Need Help?</h2>

<p>If you have any questions about your booking or need to make changes, please don't hesitate to contact us:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>We look forward to serving you!</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'booking_approved',
    name: 'Booking Approved',
    subject: 'Booking Confirmed - {{rental_number}} | {{company_name}}',
    content: `<h1>Your Booking is Confirmed!</h1>

<p>Dear {{customer_name}},</p>

<p>Great news! Your booking with <strong>{{company_name}}</strong> has been <strong>approved and confirmed</strong>. Your vehicle is reserved and ready for collection on your scheduled pickup date.</p>

<hr>

<h2>Booking Confirmation</h2>

<table>
  <tr>
    <td><strong>Confirmation Number:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Registration:</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Pickup Date:</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
  <tr>
    <td><strong>Total Amount:</strong></td>
    <td>{{rental_amount}}</td>
  </tr>
</table>

<hr>

<h2>Before Your Pickup</h2>

<p>Please ensure you complete the following before collecting your vehicle:</p>

<ol>
  <li><strong>Sign Your Rental Agreement</strong> - You will receive a separate email with your rental agreement. Please review and sign it electronically before pickup.</li>
  <li><strong>Prepare Your Documents</strong> - Bring a valid driving licence (held for minimum 1 year) and a secondary form of ID.</li>
  <li><strong>Payment Card</strong> - Bring the same card used for booking for verification purposes.</li>
</ol>

<hr>

<h2>Pickup Location</h2>

<p>Please arrive at our location at your scheduled pickup time. Our team will be ready to assist you with the handover process and answer any questions.</p>

<hr>

<h2>Important Information</h2>

<ul>
  <li>Please inspect the vehicle thoroughly before driving away</li>
  <li>Report any existing damage to our staff during handover</li>
  <li>Keep this email as your booking confirmation</li>
  <li>Contact us immediately if you need to reschedule</li>
</ul>

<hr>

<h2>Contact Us</h2>

<p>If you have any questions or need to make changes to your booking:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for choosing {{company_name}}. We look forward to seeing you!</p>

<p>Safe travels,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'booking_rejected',
    name: 'Booking Rejected',
    subject: 'Booking Update - {{rental_number}} | {{company_name}}',
    content: `<h1>Booking Update</h1>

<p>Dear {{customer_name}},</p>

<p>Thank you for your interest in renting with <strong>{{company_name}}</strong>. Unfortunately, we were unable to approve your booking request at this time.</p>

<hr>

<h2>Booking Details</h2>

<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle Requested:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Requested Dates:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Reason</h2>

<p>{{rejection_reason}}</p>

<hr>

<h2>No Charges Applied</h2>

<p>Please be assured that <strong>no payment has been taken</strong> from your card. Any temporary authorisation hold will be automatically released within 3-5 business days, depending on your bank.</p>

<hr>

<h2>Alternative Options</h2>

<p>We would still love to help you find the perfect vehicle. Here are some options:</p>

<ul>
  <li>Browse our current vehicle availability on our website</li>
  <li>Contact us to discuss alternative dates or vehicles</li>
  <li>Submit a new booking request with different criteria</li>
</ul>

<hr>

<h2>Questions?</h2>

<p>If you believe this decision was made in error or would like more information, please contact our team:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>We appreciate your understanding and hope to serve you in the future.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'booking_cancelled',
    name: 'Booking Cancelled',
    subject: 'Booking Cancelled - {{rental_number}} | {{company_name}}',
    content: `<h1>Booking Cancellation Confirmation</h1>

<p>Dear {{customer_name}},</p>

<p>This email confirms that your booking with <strong>{{company_name}}</strong> has been cancelled.</p>

<hr>

<h2>Cancelled Booking Details</h2>

<table>
  <tr>
    <td><strong>Booking Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Original Rental Period:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Refund Information</h2>

<p>Any applicable refunds will be processed according to our cancellation policy. If a refund is due, it will be credited to your original payment method within 5-10 business days.</p>

<p>You will receive a separate confirmation email once your refund has been processed.</p>

<hr>

<h2>Book Again</h2>

<p>We hope to have the opportunity to serve you in the future. When you're ready to book again, visit our website or contact us directly.</p>

<hr>

<h2>Contact Us</h2>

<p>If you have any questions about your cancellation or refund:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for considering {{company_name}}.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'rental_started',
    name: 'Rental Started',
    subject: 'Your Rental Has Begun - {{rental_number}} | {{company_name}}',
    content: `<h1>Your Rental Has Started!</h1>

<p>Dear {{customer_name}},</p>

<p>Welcome aboard! Your rental with <strong>{{company_name}}</strong> has officially begun. We hope you enjoy your driving experience.</p>

<hr>

<h2>Your Rental Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Registration:</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Rental Start:</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>Rental End:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Important Reminders</h2>

<ul>
  <li><strong>Drive Safely</strong> - Always follow traffic laws and drive responsibly</li>
  <li><strong>Fuel Policy</strong> - Please return the vehicle with the same fuel level as pickup</li>
  <li><strong>Mileage</strong> - Check your rental agreement for any mileage limits</li>
  <li><strong>Cleanliness</strong> - Please keep the vehicle clean during your rental</li>
  <li><strong>Smoking</strong> - Smoking is strictly prohibited in all our vehicles</li>
</ul>

<hr>

<h2>In Case of Emergency</h2>

<p>If you experience a breakdown, accident, or any emergency situation:</p>

<ol>
  <li>Ensure your safety first - move to a safe location if possible</li>
  <li>Contact us immediately on our 24/7 emergency line</li>
  <li>Do not arrange repairs without our authorisation</li>
  <li>In case of an accident, exchange details with other parties and take photos</li>
</ol>

<hr>

<h2>24/7 Support</h2>

<p>We're here to help throughout your rental period:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Have a safe and enjoyable journey!</p>

<p>Best wishes,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'rental_reminder',
    name: 'Rental Reminder',
    subject: 'Payment Reminder - {{rental_number}} | {{company_name}}',
    content: `<h1>Payment Reminder</h1>

<p>Dear {{customer_name}},</p>

<p>This is a friendly reminder about an upcoming payment for your rental with <strong>{{company_name}}</strong>.</p>

<hr>

<h2>Payment Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Amount Due:</strong></td>
    <td>{{payment_amount}}</td>
  </tr>
  <tr>
    <td><strong>Due Date:</strong></td>
    <td>{{due_date}}</td>
  </tr>
</table>

<hr>

<h2>How to Pay</h2>

<p>To ensure uninterrupted service, please ensure your payment is made by the due date. You can:</p>

<ul>
  <li>Log in to your account to make a payment online</li>
  <li>Contact us to process payment over the phone</li>
  <li>Set up automatic payments to avoid future reminders</li>
</ul>

<hr>

<h2>Already Paid?</h2>

<p>If you've already made this payment, please disregard this reminder. Payments can take 1-2 business days to reflect in our system.</p>

<hr>

<h2>Need Assistance?</h2>

<p>If you're experiencing any difficulties or need to discuss payment options, please contact us:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for your prompt attention to this matter.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'rental_completed',
    name: 'Rental Completed',
    subject: 'Thank You for Renting With Us - {{rental_number}} | {{company_name}}',
    content: `<h1>Thank You!</h1>

<p>Dear {{customer_name}},</p>

<p>Thank you for choosing <strong>{{company_name}}</strong>! Your rental has been successfully completed and the vehicle has been returned.</p>

<hr>

<h2>Rental Summary</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Rental Period:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Final Settlement</h2>

<p>Your final invoice will be processed and any applicable charges or refunds will be reflected within 3-5 business days. You will receive a separate email with your final invoice.</p>

<hr>

<h2>We Value Your Feedback</h2>

<p>Your opinion matters to us! We would love to hear about your experience. Your feedback helps us improve our service and assist future customers in making informed decisions.</p>

<hr>

<h2>Book Again</h2>

<p>We hope you had a great experience with us. When you need a vehicle in the future, we'd be delighted to serve you again. As a valued customer, you may be eligible for special offers on your next booking.</p>

<hr>

<h2>Stay Connected</h2>

<p>For any questions about your completed rental or to book again:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for choosing {{company_name}}. We look forward to seeing you again!</p>

<p>Warm regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'return_due',
    name: 'Return Due',
    subject: 'Vehicle Return Reminder - {{rental_number}} | {{company_name}}',
    content: `<h1>Vehicle Return Reminder</h1>

<p>Dear {{customer_name}},</p>

<p>This is a friendly reminder that your vehicle rental with <strong>{{company_name}}</strong> is coming to an end soon.</p>

<hr>

<h2>Return Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Registration:</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Return Checklist</h2>

<p>Please ensure you complete the following before returning your vehicle:</p>

<ul>
  <li><strong>Fuel Level</strong> - Return the vehicle with the same fuel level as at pickup (usually full tank)</li>
  <li><strong>Personal Belongings</strong> - Check all compartments and remove your personal items</li>
  <li><strong>Vehicle Condition</strong> - Give the vehicle a quick clean inside</li>
  <li><strong>Documents</strong> - Ensure all rental documents are in the vehicle</li>
  <li><strong>Keys & Accessories</strong> - Return all keys, fobs, and any accessories provided</li>
</ul>

<hr>

<h2>Late Returns</h2>

<p>If you anticipate returning the vehicle late, please contact us as soon as possible. Unauthorised late returns may incur additional charges as per your rental agreement.</p>

<hr>

<h2>Need to Extend?</h2>

<p>If you would like to extend your rental, please contact us before your scheduled return date. Extensions are subject to vehicle availability.</p>

<hr>

<h2>Contact Us</h2>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for renting with {{company_name}}!</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'payment_failed',
    name: 'Payment Failed',
    subject: 'Action Required: Payment Issue - {{rental_number}} | {{company_name}}',
    content: `<h1>Payment Issue - Action Required</h1>

<p>Dear {{customer_name}},</p>

<p>We were unable to process your recent payment for your rental with <strong>{{company_name}}</strong>. Please don't worry - we're here to help you resolve this quickly.</p>

<hr>

<h2>Payment Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Amount:</strong></td>
    <td>{{payment_amount}}</td>
  </tr>
</table>

<hr>

<h2>What You Need to Do</h2>

<p>To resolve this issue and avoid any interruption to your rental service, please:</p>

<ol>
  <li><strong>Check Your Card Details</strong> - Ensure your card number, expiry date, and CVV are correct</li>
  <li><strong>Verify Available Funds</strong> - Make sure sufficient funds are available in your account</li>
  <li><strong>Contact Your Bank</strong> - Your bank may have blocked the transaction for security reasons</li>
  <li><strong>Try an Alternative Card</strong> - If issues persist, consider using a different payment method</li>
</ol>

<hr>

<h2>Update Your Payment</h2>

<p>Please update your payment method or retry the payment as soon as possible. You can do this by:</p>

<ul>
  <li>Logging into your account online</li>
  <li>Contacting our team directly to process payment</li>
</ul>

<hr>

<h2>Need Help?</h2>

<p>If you're experiencing difficulties or need assistance, our team is ready to help:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Please resolve this issue promptly to avoid any impact on your rental service.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'refund_processed',
    name: 'Refund Processed',
    subject: 'Refund Processed - {{rental_number}} | {{company_name}}',
    content: `<h1>Refund Confirmation</h1>

<p>Dear {{customer_name}},</p>

<p>Good news! We have successfully processed a refund to your account from <strong>{{company_name}}</strong>.</p>

<hr>

<h2>Refund Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Refund Amount:</strong></td>
    <td>{{refund_amount}}</td>
  </tr>
</table>

<hr>

<h2>When Will I Receive My Refund?</h2>

<p>The refund has been submitted to your original payment method. Please allow:</p>

<ul>
  <li><strong>Debit Cards:</strong> 5-10 business days</li>
  <li><strong>Credit Cards:</strong> 5-10 business days (may appear on your next statement)</li>
</ul>

<p>Processing times may vary depending on your bank or card issuer.</p>

<hr>

<h2>Refund Not Received?</h2>

<p>If you haven't received your refund after 10 business days, please:</p>

<ol>
  <li>Check your bank statement for the refund transaction</li>
  <li>Contact your bank to enquire about pending credits</li>
  <li>Reach out to us with your bank's response</li>
</ol>

<hr>

<h2>Questions?</h2>

<p>If you have any questions about this refund, please contact us:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for your patience and for choosing {{company_name}}.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  {
    key: 'rental_extended',
    name: 'Rental Extended',
    subject: 'Rental Extended - {{rental_number}} | {{company_name}}',
    content: `<h1>Your Rental Has Been Extended</h1>

<p>Dear {{customer_name}},</p>

<p>Your rental with <strong>{{company_name}}</strong> has been extended. Below are the updated details:</p>

<hr>

<h2>Extension Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Previous End Date:</strong></td>
    <td>{{previous_end_date}}</td>
  </tr>
  <tr>
    <td><strong>New End Date:</strong></td>
    <td>{{new_end_date}}</td>
  </tr>
  <tr>
    <td><strong>Extension:</strong></td>
    <td>{{extension_days}} day(s)</td>
  </tr>
  <tr>
    <td><strong>Extension Cost:</strong></td>
    <td>{{extension_amount}}</td>
  </tr>
</table>

<hr>

<h2>Payment</h2>

<p>Please complete the extension payment at your earliest convenience. If a payment link has been provided, you can pay securely online.</p>

<hr>

<h2>Important Reminders</h2>

<ul>
  <li>Your insurance coverage may need to be reviewed for the extended period</li>
  <li>Please ensure your driving licence remains valid for the extended duration</li>
  <li>The vehicle must be returned by the new end date to avoid late fees</li>
</ul>

<hr>

<h2>Contact Us</h2>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for continuing to rent with {{company_name}}.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
];

// Get default template by key
export function getDefaultEmailTemplate(key: string): DefaultEmailTemplate | undefined {
  return DEFAULT_EMAIL_TEMPLATES.find(t => t.key === key);
}

// Get all default templates
export function getAllDefaultEmailTemplates(): DefaultEmailTemplate[] {
  return DEFAULT_EMAIL_TEMPLATES;
}
