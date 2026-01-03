// Default Email Templates
// These are the default templates used when a tenant hasn't customized their email templates

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
    subject: 'Booking Received - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Thank you for choosing {{company_name}}! We've received your booking request and our team is reviewing it.</p>

<p>You'll receive a confirmation email within <strong>24 hours</strong> once your booking is approved.</p>

<h3>Booking Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
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
    <td><strong>Amount:</strong></td>
    <td>{{rental_amount}}</td>
  </tr>
</table>

<p>If you have any questions, please don't hesitate to contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  {
    key: 'booking_approved',
    name: 'Booking Approved',
    subject: 'Booking Confirmed - {{rental_number}}',
    content: `<h2>Great news, {{customer_name}}!</h2>

<p>Your booking has been <strong>approved</strong> and confirmed. We're excited to have you as our customer!</p>

<h3>Booking Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
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
    <td><strong>Amount:</strong></td>
    <td>{{rental_amount}}</td>
  </tr>
</table>

<h3>Next Steps</h3>
<ul>
  <li>You'll receive a rental agreement to sign via DocuSign</li>
  <li>Please bring a valid driver's license on pickup day</li>
  <li>Contact us if you need to make any changes</li>
</ul>

<p>If you have any questions, please contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  {
    key: 'booking_rejected',
    name: 'Booking Rejected',
    subject: 'Booking Update - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Unfortunately, we were unable to approve your booking request at this time.</p>

<h3>Booking Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Requested Dates:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<p><strong>Reason:</strong> {{rejection_reason}}</p>

<p>Any pre-authorization on your card will be released within 5-7 business days.</p>

<p>We'd love to help you find an alternative. Please browse our available vehicles or contact us for assistance.</p>

<p>Contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  {
    key: 'booking_cancelled',
    name: 'Booking Cancelled',
    subject: 'Booking Cancelled - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Your booking has been cancelled as requested.</p>

<h3>Cancelled Booking Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Original Dates:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<p>Any applicable refunds will be processed according to our cancellation policy.</p>

<p>We hope to serve you again in the future. If you'd like to make a new booking, please visit our website or contact us.</p>

<p>Contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  {
    key: 'rental_started',
    name: 'Rental Started',
    subject: 'Your Rental Has Started - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Your rental has officially started. We hope you enjoy your driving experience!</p>

<h3>Rental Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Start Date:</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
</table>

<h3>Important Reminders</h3>
<ul>
  <li>Drive safely and follow all traffic laws</li>
  <li>Keep the vehicle clean and report any issues immediately</li>
  <li>Return the vehicle with the same fuel level</li>
  <li>Contact us immediately in case of an accident or emergency</li>
</ul>

<p>If you need any assistance during your rental, please contact us at {{company_email}} or {{company_phone}}.</p>

<p>Enjoy your ride!<br>{{company_name}} Team</p>`,
  },
  {
    key: 'rental_reminder',
    name: 'Rental Reminder',
    subject: 'Reminder - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>This is a friendly reminder about your rental with {{company_name}}.</p>

<h3>Rental Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
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

<p>Please ensure your payment is made on time to avoid any interruption to your rental.</p>

<p>If you have any questions or concerns, please contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  {
    key: 'rental_completed',
    name: 'Rental Completed',
    subject: 'Thank You - Rental Complete {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Thank you for renting with {{company_name}}! Your rental has been successfully completed.</p>

<h3>Rental Summary</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
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

<p>We hope you had a great experience with us. We'd love to have you back for your next rental!</p>

<p>If you have any feedback or questions, please don't hesitate to contact us at {{company_email}}.</p>

<p>Thank you for choosing {{company_name}}!<br>{{company_name}} Team</p>`,
  },
  {
    key: 'return_due',
    name: 'Return Due',
    subject: 'Return Reminder - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>This is a friendly reminder that your vehicle return is coming up soon.</p>

<h3>Rental Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
</table>

<h3>Return Checklist</h3>
<ul>
  <li>Return the vehicle with the same fuel level</li>
  <li>Remove all personal belongings</li>
  <li>Ensure the vehicle is clean</li>
  <li>Return keys and all accessories</li>
</ul>

<p>Need to extend your rental? Contact us as soon as possible at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  {
    key: 'payment_failed',
    name: 'Payment Failed',
    subject: 'Payment Issue - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>We were unable to process your recent payment.</p>

<h3>Payment Details</h3>
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

<p><strong>Action Required:</strong> Please update your payment method or contact us to resolve this issue as soon as possible to avoid any interruption to your rental.</p>

<p>Contact us at {{company_email}} or {{company_phone}} for assistance.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  {
    key: 'refund_processed',
    name: 'Refund Processed',
    subject: 'Refund Processed - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Your refund has been processed successfully.</p>

<h3>Refund Details</h3>
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

<p>The refund will be credited to your original payment method within 5-10 business days, depending on your bank.</p>

<p>If you have any questions, please contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
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
