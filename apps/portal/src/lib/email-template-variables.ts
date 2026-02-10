// Email Template Variables
// These variables can be used in email templates and will be replaced with actual data

import { formatCurrency } from "@/lib/format-utils";

export interface EmailTemplateVariable {
  key: string;
  label: string;
  description: string;
  sample: string;
  category: 'customer' | 'vehicle' | 'rental' | 'company' | 'email';
}

export const EMAIL_TEMPLATE_VARIABLES: EmailTemplateVariable[] = [
  // Customer variables
  {
    key: 'customer_name',
    label: 'Customer Name',
    description: 'Full name of the customer',
    sample: 'John Smith',
    category: 'customer',
  },
  {
    key: 'customer_email',
    label: 'Customer Email',
    description: 'Email address of the customer',
    sample: 'john.smith@example.com',
    category: 'customer',
  },
  {
    key: 'customer_phone',
    label: 'Customer Phone',
    description: 'Phone number of the customer',
    sample: '+1 234 567 8900',
    category: 'customer',
  },

  // Vehicle variables
  {
    key: 'vehicle_make',
    label: 'Vehicle Make',
    description: 'Manufacturer of the vehicle',
    sample: 'Mercedes-Benz',
    category: 'vehicle',
  },
  {
    key: 'vehicle_model',
    label: 'Vehicle Model',
    description: 'Model of the vehicle',
    sample: 'S-Class',
    category: 'vehicle',
  },
  {
    key: 'vehicle_reg',
    label: 'Vehicle Registration',
    description: 'License plate number',
    sample: 'ABC 123',
    category: 'vehicle',
  },
  {
    key: 'vehicle_year',
    label: 'Vehicle Year',
    description: 'Year of manufacture',
    sample: '2024',
    category: 'vehicle',
  },

  // Rental variables
  {
    key: 'rental_number',
    label: 'Booking Reference',
    description: 'Unique booking/rental reference number',
    sample: 'RNT-2024-001',
    category: 'rental',
  },
  {
    key: 'rental_start_date',
    label: 'Start Date',
    description: 'Rental start date',
    sample: 'January 15, 2025',
    category: 'rental',
  },
  {
    key: 'rental_end_date',
    label: 'End Date',
    description: 'Rental end date',
    sample: 'February 15, 2025',
    category: 'rental',
  },
  {
    key: 'rental_amount',
    label: 'Rental Amount',
    description: 'Total rental amount',
    sample: '$2,500.00',
    category: 'rental',
  },
  {
    key: 'rental_period_type',
    label: 'Rental Period',
    description: 'Type of rental period (Daily/Weekly/Monthly)',
    sample: 'Weekly',
    category: 'rental',
  },

  // Company variables
  {
    key: 'company_name',
    label: 'Company Name',
    description: 'Name of the rental company',
    sample: 'Acme Car Rentals',
    category: 'company',
  },
  {
    key: 'company_email',
    label: 'Company Email',
    description: 'Contact email of the company',
    sample: 'contact@acmerentals.com',
    category: 'company',
  },
  {
    key: 'company_phone',
    label: 'Company Phone',
    description: 'Contact phone of the company',
    sample: '+1 800 555 0000',
    category: 'company',
  },

  // Email-specific variables
  {
    key: 'rejection_reason',
    label: 'Rejection Reason',
    description: 'Reason for booking rejection (booking_rejected only)',
    sample: 'Vehicle not available for selected dates',
    category: 'email',
  },
  {
    key: 'payment_amount',
    label: 'Payment Amount',
    description: 'Amount of payment (payment emails only)',
    sample: '$500.00',
    category: 'email',
  },
  {
    key: 'refund_amount',
    label: 'Refund Amount',
    description: 'Amount refunded (refund_processed only)',
    sample: '$250.00',
    category: 'email',
  },
  {
    key: 'due_date',
    label: 'Due Date',
    description: 'Payment or return due date',
    sample: 'January 20, 2025',
    category: 'email',
  },
];

// Email template types with metadata
export interface EmailTemplateType {
  key: string;
  name: string;
  description: string;
  defaultSubject: string;
  availableVariables: string[]; // Keys of variables available for this template type
}

export const EMAIL_TEMPLATE_TYPES: EmailTemplateType[] = [
  {
    key: 'booking_pending',
    name: 'Booking Pending',
    description: 'Sent when a new booking is submitted and awaiting approval',
    defaultSubject: 'Booking Received - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'vehicle_make', 'vehicle_model', 'vehicle_reg', 'rental_number', 'rental_start_date', 'rental_end_date', 'rental_amount', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'booking_approved',
    name: 'Booking Approved',
    description: 'Sent when a booking is approved',
    defaultSubject: 'Booking Confirmed - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'vehicle_make', 'vehicle_model', 'vehicle_reg', 'rental_number', 'rental_start_date', 'rental_end_date', 'rental_amount', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'booking_rejected',
    name: 'Booking Rejected',
    description: 'Sent when a booking is rejected',
    defaultSubject: 'Booking Update - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'vehicle_make', 'vehicle_model', 'vehicle_reg', 'rental_number', 'rental_start_date', 'rental_end_date', 'rejection_reason', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'booking_cancelled',
    name: 'Booking Cancelled',
    description: 'Sent when a booking is cancelled',
    defaultSubject: 'Booking Cancelled - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'vehicle_make', 'vehicle_model', 'vehicle_reg', 'rental_number', 'rental_start_date', 'rental_end_date', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'rental_started',
    name: 'Rental Started',
    description: 'Sent when a rental period begins',
    defaultSubject: 'Your Rental Has Started - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'vehicle_make', 'vehicle_model', 'vehicle_reg', 'rental_number', 'rental_start_date', 'rental_end_date', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'rental_reminder',
    name: 'Rental Reminder',
    description: 'Payment or general reminders during rental',
    defaultSubject: 'Reminder - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'vehicle_make', 'vehicle_model', 'vehicle_reg', 'rental_number', 'payment_amount', 'due_date', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'rental_completed',
    name: 'Rental Completed',
    description: 'Sent when a rental period ends',
    defaultSubject: 'Thank You - Rental Complete {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'vehicle_make', 'vehicle_model', 'vehicle_reg', 'rental_number', 'rental_start_date', 'rental_end_date', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'return_due',
    name: 'Return Due',
    description: 'Reminder that vehicle return is due soon',
    defaultSubject: 'Return Reminder - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'vehicle_make', 'vehicle_model', 'vehicle_reg', 'rental_number', 'rental_end_date', 'due_date', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'payment_failed',
    name: 'Payment Failed',
    description: 'Sent when a payment fails',
    defaultSubject: 'Payment Issue - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'rental_number', 'payment_amount', 'company_name', 'company_email', 'company_phone'],
  },
  {
    key: 'refund_processed',
    name: 'Refund Processed',
    description: 'Sent when a refund is issued',
    defaultSubject: 'Refund Processed - {{rental_number}}',
    availableVariables: ['customer_name', 'customer_email', 'rental_number', 'refund_amount', 'company_name', 'company_email', 'company_phone'],
  },
];

// Get variables grouped by category
export function getEmailVariablesByCategory(): Record<string, EmailTemplateVariable[]> {
  return EMAIL_TEMPLATE_VARIABLES.reduce((acc, variable) => {
    if (!acc[variable.category]) {
      acc[variable.category] = [];
    }
    acc[variable.category].push(variable);
    return acc;
  }, {} as Record<string, EmailTemplateVariable[]>);
}

// Get sample data for preview
export function getEmailSampleData(): Record<string, string> {
  return EMAIL_TEMPLATE_VARIABLES.reduce((acc, variable) => {
    acc[variable.key] = variable.sample;
    return acc;
  }, {} as Record<string, string>);
}

// Replace variables in template with actual data
export function replaceEmailVariables(
  template: string,
  data: Record<string, string | number | null | undefined>
): string {
  let result = template;

  for (const variable of EMAIL_TEMPLATE_VARIABLES) {
    const placeholder = `{{${variable.key}}}`;
    const value = data[variable.key];
    result = result.replace(
      new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'),
      value?.toString() || ''
    );
  }

  return result;
}

// Format date for display
export function formatEmailDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Format currency for display (delegates to shared format-utils)
export function formatEmailCurrency(
  amount: number | null | undefined,
  currencyCode: string = 'GBP'
): string {
  if (amount === null || amount === undefined) return '';
  return formatCurrency(amount, currencyCode);
}

// Get template type by key
export function getEmailTemplateType(key: string): EmailTemplateType | undefined {
  return EMAIL_TEMPLATE_TYPES.find(t => t.key === key);
}

// Get variables available for a specific template type
export function getVariablesForTemplateType(templateKey: string): EmailTemplateVariable[] {
  const templateType = getEmailTemplateType(templateKey);
  if (!templateType) return EMAIL_TEMPLATE_VARIABLES;

  return EMAIL_TEMPLATE_VARIABLES.filter(v =>
    templateType.availableVariables.includes(v.key)
  );
}
