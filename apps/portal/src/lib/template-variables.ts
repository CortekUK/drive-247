// Agreement Template Variables
// These variables can be used in agreement templates and will be replaced with actual data

import { formatCurrency } from "@/lib/format-utils";

export interface TemplateVariable {
  key: string;
  label: string;
  description: string;
  sample: string;
  category: 'customer' | 'vehicle' | 'rental' | 'company' | 'payment' | 'extension' | 'additional_driver';
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
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
  {
    key: 'customer_address',
    label: 'Customer Address',
    description: 'Full address (street, city, state, zip)',
    sample: '123 Main Street, Las Vegas, NV 89120',
    category: 'customer',
  },
  {
    key: 'customer_type',
    label: 'Customer Type',
    description: 'Type of customer (Individual/Business)',
    sample: 'Individual',
    category: 'customer',
  },
  {
    key: 'customer_date_of_birth',
    label: 'Date of Birth',
    description: 'Customer date of birth',
    sample: 'March 15, 1990',
    category: 'customer',
  },
  {
    key: 'customer_license_number',
    label: 'License / ID Number',
    description: "Document number from ID verification (license, passport, or ID card)",
    sample: 'DL-12345678',
    category: 'customer',
  },
  {
    key: 'customer_license_expiry',
    label: 'Document Expiry Date',
    description: "Expiry date of the verified document",
    sample: 'March 20, 2028',
    category: 'customer',
  },
  {
    key: 'customer_document_type',
    label: 'Document Type',
    description: "Type of ID document (Driver's License, Passport, ID Card)",
    sample: "Driver's License",
    category: 'customer',
  },
  {
    key: 'customer_license_state',
    label: 'License State',
    description: 'State/province where license was issued',
    sample: 'Nevada (NV)',
    category: 'customer',
  },
  {
    key: 'customer_id_number',
    label: 'ID Number',
    description: 'Customer identification number',
    sample: 'ID-98765432',
    category: 'customer',
  },
  {
    key: 'nok_name',
    label: 'Next of Kin Name',
    description: 'Emergency contact / next of kin name',
    sample: 'Jane Smith',
    category: 'customer',
  },
  {
    key: 'nok_phone',
    label: 'Next of Kin Phone',
    description: 'Emergency contact phone number',
    sample: '+1 234 567 8901',
    category: 'customer',
  },
  {
    key: 'is_gig_driver',
    label: 'Gig Driver',
    description: 'Whether the customer declared themselves a gig driver (Uber/Lyft/etc). Resolves to "Yes" or "No". You can also wrap an agreement section in {{#if is_gig_driver}}...{{/if}} to make it appear only for gig drivers.',
    sample: 'Yes',
    category: 'customer',
  },
  {
    key: 'additional_drivers_list',
    label: 'Additional Drivers',
    description: 'Comma-separated list of additional drivers attached to this rental, formatted as "Name (DL: licence)" when a licence number is available, else "Name (email)". Empty string when there are no additional drivers — the surrounding line in the template will collapse naturally.',
    sample: 'Jane Doe (DL: ABC123), John Doe (DL: XYZ789)',
    category: 'rental',
  },

  // ── Additional driver variables (granular) ─────────────────────────────
  // Complement to the flat {{additional_drivers_list}}. Use these when you
  // want explicit placement (e.g., one signature block per driver) or finer
  // control over each driver's fields. Empty strings render naturally when
  // a slot is unused. Supports up to 5 additional drivers.
  {
    key: 'additional_drivers_count',
    label: 'Additional Drivers Count',
    description: 'Number of additional drivers on this rental',
    sample: '2',
    category: 'additional_driver',
  },
  {
    key: 'additional_drivers',
    label: 'Additional Drivers Block',
    description: 'Auto-generated block listing every additional driver (name, email, phone, license). One paragraph per driver. Empty if none.',
    sample: 'Driver 1: Jane Doe · Email: jane@example.com · Phone: +1 555 0123 · License/ID: DL-12345678',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_1_name',
    label: 'Additional Driver 1 — Name',
    description: 'Full name of additional driver 1',
    sample: 'Jane Doe',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_1_email',
    label: 'Additional Driver 1 — Email',
    description: 'Email address of additional driver 1',
    sample: 'jane@example.com',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_1_phone',
    label: 'Additional Driver 1 — Phone',
    description: 'Phone number of additional driver 1',
    sample: '+1 555 0123',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_1_license',
    label: 'Additional Driver 1 — License/ID',
    description: 'License or ID number of additional driver 1 (empty until verified)',
    sample: 'DL-12345678',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_2_name',
    label: 'Additional Driver 2 — Name',
    description: 'Full name of additional driver 2',
    sample: 'John Smith',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_2_email',
    label: 'Additional Driver 2 — Email',
    description: 'Email address of additional driver 2',
    sample: 'john@example.com',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_2_phone',
    label: 'Additional Driver 2 — Phone',
    description: 'Phone number of additional driver 2',
    sample: '+1 555 0124',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_2_license',
    label: 'Additional Driver 2 — License/ID',
    description: 'License or ID number of additional driver 2 (empty until verified)',
    sample: 'DL-87654321',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_3_name',
    label: 'Additional Driver 3 — Name',
    description: 'Full name of additional driver 3',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_3_email',
    label: 'Additional Driver 3 — Email',
    description: 'Email address of additional driver 3',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_3_phone',
    label: 'Additional Driver 3 — Phone',
    description: 'Phone number of additional driver 3',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_3_license',
    label: 'Additional Driver 3 — License/ID',
    description: 'License or ID number of additional driver 3 (empty until verified)',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_4_name',
    label: 'Additional Driver 4 — Name',
    description: 'Full name of additional driver 4',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_4_email',
    label: 'Additional Driver 4 — Email',
    description: 'Email address of additional driver 4',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_4_phone',
    label: 'Additional Driver 4 — Phone',
    description: 'Phone number of additional driver 4',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_4_license',
    label: 'Additional Driver 4 — License/ID',
    description: 'License or ID number of additional driver 4 (empty until verified)',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_5_name',
    label: 'Additional Driver 5 — Name',
    description: 'Full name of additional driver 5',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_5_email',
    label: 'Additional Driver 5 — Email',
    description: 'Email address of additional driver 5',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_5_phone',
    label: 'Additional Driver 5 — Phone',
    description: 'Phone number of additional driver 5',
    sample: '',
    category: 'additional_driver',
  },
  {
    key: 'additional_driver_5_license',
    label: 'Additional Driver 5 — License/ID',
    description: 'License or ID number of additional driver 5 (empty until verified)',
    sample: '',
    category: 'additional_driver',
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
    key: 'vehicle_year',
    label: 'Vehicle Year',
    description: 'Year of manufacture',
    sample: '2024',
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
    key: 'vehicle_color',
    label: 'Vehicle Color',
    description: 'Color of the vehicle',
    sample: 'Black',
    category: 'vehicle',
  },
  {
    key: 'vehicle_vin',
    label: 'Vehicle VIN',
    description: 'Vehicle Identification Number',
    sample: 'WDB1234567890123',
    category: 'vehicle',
  },
  {
    key: 'vehicle_fuel_type',
    label: 'Fuel Type',
    description: 'Type of fuel (Petrol/Diesel/Electric/Hybrid)',
    sample: 'Petrol',
    category: 'vehicle',
  },
  {
    key: 'vehicle_daily_rent',
    label: 'Daily Rent',
    description: 'Daily rental rate for the vehicle',
    sample: '$220.00',
    category: 'vehicle',
  },
  {
    key: 'vehicle_weekly_rent',
    label: 'Weekly Rent',
    description: 'Weekly rental rate for the vehicle',
    sample: '$1,200.00',
    category: 'vehicle',
  },
  {
    key: 'vehicle_monthly_rent',
    label: 'Monthly Rent',
    description: 'Monthly rental rate for the vehicle',
    sample: '$4,500.00',
    category: 'vehicle',
  },
  {
    key: 'mileage_allowance',
    label: 'Mileage Allowance',
    description:
      "Mileage included for this rental, resolved from the rental's override or the vehicle's allowance for the billing tier. Shows 'Not specified' when none is configured — never 'Unlimited'.",
    sample: '4,500 miles total (4,500 per month over 30 days)',
    category: 'vehicle',
  },
  {
    key: 'excess_mileage_rate',
    label: 'Excess Mileage Rate',
    description: 'Charge per additional mile/km beyond the allowance, in the tenant currency.',
    sample: '$0.30 per additional mile',
    category: 'vehicle',
  },
  {
    key: 'terms_and_conditions',
    label: 'Terms & Conditions',
    description:
      "Your own Terms & Conditions from the CMS Terms page. Added automatically before the signature if you don't place it yourself.",
    sample: 'Operator Terms & Conditions\n1. Agreement to Terms...',
    category: 'rental',
  },
  {
    key: 'bonzah_insurance_addendum',
    label: 'Bonzah Insurance Addendum',
    description:
      "Bonzah's required insurance addendum, added automatically before the signature when Bonzah is connected. Insurer-supplied wording that cannot be edited. Place it yourself only if you want it somewhere else in the document; it is blank for tenants without Bonzah.",
    sample: 'Pablow, Inc. dba bonzah.com - Insurance Addendum\n1. Insurance Requirement...',
    category: 'rental',
  },

  // Rental variables
  {
    key: 'rental_number',
    label: 'Rental Number',
    description: 'Unique rental reference number',
    sample: 'R-B0F986',
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
    key: 'rental_days',
    label: 'Days Rented',
    description: 'Number of days between start and end date',
    sample: '30',
    category: 'rental',
  },
  {
    key: 'monthly_amount',
    label: 'Total Amount',
    description: 'Total payment amount, after any discount (includes taxes, fees, deposit)',
    sample: '$2,500.00',
    category: 'rental',
  },
  {
    key: 'rental_discount',
    label: 'Discount Applied',
    description: 'Discount agreed on this rental, per period. Empty when there is no discount.',
    sample: '$78.00',
    category: 'rental',
  },
  {
    key: 'rental_price',
    label: 'Rental Price',
    description: 'Agreed rental rate for the period, after any discount',
    sample: '$100.00',
    category: 'rental',
  },
  {
    key: 'rental_period_type',
    label: 'Rental Period Type',
    description: 'Type of rental period (Daily/Weekly/Monthly)',
    sample: 'Monthly',
    category: 'rental',
  },
  {
    key: 'rental_status',
    label: 'Rental Status',
    description: 'Current status of the rental',
    sample: 'Started',
    category: 'rental',
  },
  {
    key: 'pickup_location',
    label: 'Pickup Location',
    description: 'Vehicle pickup location',
    sample: '3430 East Russell Road, Las Vegas, NV 89120',
    category: 'rental',
  },
  {
    key: 'return_location',
    label: 'Return Location',
    description: 'Vehicle return location',
    sample: '3430 East Russell Road, Las Vegas, NV 89120',
    category: 'rental',
  },
  {
    key: 'delivery_address',
    label: 'Delivery Address',
    description: 'Delivery address for the vehicle',
    sample: '456 Oak Avenue, Las Vegas, NV 89101',
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
  {
    key: 'company_address',
    label: 'Company Address',
    description: 'Address of the rental company',
    sample: '3430 East Russell Road, Las Vegas, NV 89120',
    category: 'company',
  },
  {
    key: 'agreement_date',
    label: 'Agreement Date',
    description: 'Date the agreement is created',
    sample: 'January 10, 2025',
    category: 'rental',
  },

  {
    key: 'deposit_amount',
    label: 'Deposit Amount',
    description: 'Refundable security hold (separate from installments)',
    sample: '$200.00 (refundable hold)',
    category: 'payment',
  },
  {
    key: 'tenant_name',
    label: 'Tenant Name',
    description: 'Operator company name (alias of company_name)',
    sample: 'Acme Car Rentals',
    category: 'company',
  },

  // Extension variables — populated by the esign route when sending an extension agreement.
  // Empty string in the editor preview unless rendered with extension sample data.
  {
    key: 'extension_number',
    label: 'Extension Number',
    description: 'Sequential number of this extension (1 = first extension, 2 = second, ...)',
    sample: '1',
    category: 'extension',
  },
  {
    key: 'extension_previous_end_date',
    label: 'Previous End Date',
    description: 'The end date of the rental immediately before this extension was created',
    sample: 'February 15, 2025',
    category: 'extension',
  },
  {
    key: 'extension_new_end_date',
    label: 'New End Date',
    description: 'The new end date of the rental after this extension is applied',
    sample: 'March 15, 2025',
    category: 'extension',
  },
  {
    key: 'extension_days',
    label: 'Extension Days',
    description: 'Number of additional days added by this extension',
    sample: '28',
    category: 'extension',
  },
];

// Get variables grouped by category
export function getVariablesByCategory(): Record<string, TemplateVariable[]> {
  return TEMPLATE_VARIABLES.reduce((acc, variable) => {
    if (!acc[variable.category]) {
      acc[variable.category] = [];
    }
    acc[variable.category].push(variable);
    return acc;
  }, {} as Record<string, TemplateVariable[]>);
}

// Get sample data for preview
export function getSampleData(): Record<string, string> {
  return TEMPLATE_VARIABLES.reduce((acc, variable) => {
    acc[variable.key] = variable.sample;
    return acc;
  }, {} as Record<string, string>);
}

// Replace variables in template with actual data.
//
// First pass: strip / keep `{{#if is_gig_driver}}...{{/if}}` blocks based on
// the resolved gig-driver value so tenants can hide gig-worker-specific terms
// for non-gig-drivers. Only `is_gig_driver` is conditioned for now; nested
// blocks and `{{else}}` are intentionally unsupported in v1 — keep the surface
// area small until more conditionals are actually needed.
//
// Second pass: simple `{{key}}` substitution against TEMPLATE_VARIABLES.
export function replaceVariables(
  template: string,
  data: Record<string, string | number | null | undefined>
): string {
  let result = template;

  // Conditional block pass (must run before simple substitution so the inner
  // content's variables can still be replaced in the surviving branch).
  result = result.replace(
    /\{\{#if is_gig_driver\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, inner) => (data.is_gig_driver === 'Yes' ? inner : ''),
  );
  for (const variable of TEMPLATE_VARIABLES) {
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
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Format currency for display (delegates to shared format-utils)
export function formatTemplateCurrency(
  amount: number | null | undefined,
  currencyCode: string = 'USD'
): string {
  if (amount === null || amount === undefined) return '';
  return formatCurrency(amount, currencyCode);
}

// Build data object from rental, customer, vehicle, and tenant data
export function buildTemplateData(
  rental: Record<string, any>,
  customer: Record<string, any>,
  vehicle: Record<string, any>,
  tenant: Record<string, any>,
  currencyCode: string = 'USD'
): Record<string, string> {
  const customerAddress = [
    customer?.address_street,
    customer?.address_city,
    customer?.address_state,
    customer?.address_zip,
  ].filter(Boolean).join(', ') || customer?.address || '';

  return {
    // Customer — basic
    customer_name: customer?.name || '',
    customer_email: customer?.email || '',
    customer_phone: customer?.phone || '',
    customer_type: customer?.customer_type || customer?.type || 'Individual',
    customer_address: customerAddress,

    // Customer — identity & license
    customer_date_of_birth: customer?.date_of_birth ? formatDate(customer.date_of_birth) : '',
    customer_license_number: customer?.license_number || '',
    customer_license_expiry: '',
    customer_document_type: '',
    customer_license_state: customer?.license_state || '',
    customer_id_number: customer?.id_number || '',
    nok_name: customer?.nok_full_name || '',
    nok_phone: customer?.nok_phone || '',

    // Gig driver: prefer the rental's snapshot (captured at booking/checkout
    // time) over the customer's current flag. Falls back to customer when the
    // rental row hasn't been populated (e.g., portal-created rentals before
    // is_gig_driver was wired into the form).
    is_gig_driver: (rental?.is_gig_driver ?? customer?.is_gig_driver) ? 'Yes' : 'No',

    // Vehicle
    vehicle_make: vehicle?.make || '',
    vehicle_model: vehicle?.model || '',
    vehicle_year: vehicle?.year?.toString() || '',
    vehicle_reg: vehicle?.reg || '',
    vehicle_color: vehicle?.color || '',
    vehicle_vin: vehicle?.vin || 'Not Added',
    vehicle_fuel_type: vehicle?.fuel_type || '',
    vehicle_daily_rent: formatTemplateCurrency(vehicle?.daily_rent, currencyCode),
    vehicle_weekly_rent: formatTemplateCurrency(vehicle?.weekly_rent, currencyCode),
    vehicle_monthly_rent: formatTemplateCurrency(vehicle?.monthly_rent, currencyCode),

    // Rental
    rental_number: rental?.rental_number || rental?.id?.substring(0, 8)?.toUpperCase() || '',
    rental_start_date: formatDate(rental?.start_date),
    rental_end_date: rental?.end_date ? formatDate(rental.end_date) : 'Ongoing',
    // NET of discount_applied. monthly_amount is stored GROSS with the agreed
    // reduction in its own column, and these two variables are rendered into
    // customer emails and signed agreements. api/esign/route.ts has always
    // subtracted it, so leaving these gross meant two documents for the same
    // rental quoting different money.
    monthly_amount: formatTemplateCurrency(
      Math.max(0, (Number(rental?.monthly_amount) || 0) - (Number(rental?.discount_applied) || 0)),
      currencyCode,
    ),
    rental_discount: (Number(rental?.discount_applied) || 0) > 0
      ? formatTemplateCurrency(Number(rental?.discount_applied), currencyCode)
      : '',
    rental_price: (() => {
      const type = rental?.rental_period_type || 'Monthly';
      const discount = Number(rental?.discount_applied) || 0;
      // With a discount the vehicle's list rate is not what this customer pays,
      // so quote the agreed per-period figure instead.
      if (discount > 0) {
        return formatTemplateCurrency(
          Math.max(0, (Number(rental?.monthly_amount) || 0) - discount),
          currencyCode,
        );
      }
      const rate = type === 'Daily' ? vehicle?.daily_rent : type === 'Weekly' ? vehicle?.weekly_rent : vehicle?.monthly_rent;
      return formatTemplateCurrency(rate, currencyCode);
    })(),
    rental_period_type: rental?.rental_period_type || 'Monthly',
    rental_status: rental?.status || '',
    pickup_location: rental?.pickup_location || '',
    return_location: rental?.return_location || '',
    delivery_address: rental?.delivery_address || '',
    // Pre-formatted by the BoldSign edge function when sending; in the
    // template editor preview the rental row doesn't carry this so it
    // resolves to an empty string (acceptable — operators see the sample
    // value via the variable catalogue instead).
    additional_drivers_list: (rental as any)?.additional_drivers_list || '',

    // Granular additional driver variables — same story: populated at send
    // time by the edge function / esign route. Empty in editor preview.
    additional_drivers_count: '',
    additional_drivers: '',
    additional_driver_1_name: '',
    additional_driver_1_email: '',
    additional_driver_1_phone: '',
    additional_driver_1_license: '',
    additional_driver_2_name: '',
    additional_driver_2_email: '',
    additional_driver_2_phone: '',
    additional_driver_2_license: '',
    additional_driver_3_name: '',
    additional_driver_3_email: '',
    additional_driver_3_phone: '',
    additional_driver_3_license: '',
    additional_driver_4_name: '',
    additional_driver_4_email: '',
    additional_driver_4_phone: '',
    additional_driver_4_license: '',
    additional_driver_5_name: '',
    additional_driver_5_email: '',
    additional_driver_5_phone: '',
    additional_driver_5_license: '',

    // Company
    company_name: tenant?.company_name || '',
    company_email: tenant?.contact_email || '',
    company_phone: tenant?.contact_phone || '',
    company_address: tenant?.address || '',

    // Agreement
    agreement_date: formatDate(new Date()),
  };
}
