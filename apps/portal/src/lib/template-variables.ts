// Agreement Template Variables
// These variables can be used in agreement templates and will be replaced with actual data

export interface TemplateVariable {
  key: string;
  label: string;
  description: string;
  sample: string;
  category: 'customer' | 'vehicle' | 'rental' | 'company';
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
    description: 'Full address of the customer',
    sample: '123 Main Street, London, UK',
    category: 'customer',
  },
  {
    key: 'customer_type',
    label: 'Customer Type',
    description: 'Type of customer (Individual/Business)',
    sample: 'Individual',
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

  // Rental variables
  {
    key: 'rental_number',
    label: 'Rental Number',
    description: 'Unique rental reference number',
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
    key: 'monthly_amount',
    label: 'Monthly Amount',
    description: 'Monthly rental amount',
    sample: '$2,500.00',
    category: 'rental',
  },
  {
    key: 'rental_period_type',
    label: 'Rental Period Type',
    description: 'Type of rental period (Daily/Weekly/Monthly)',
    sample: 'Monthly',
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
    key: 'agreement_date',
    label: 'Agreement Date',
    description: 'Date the agreement is created',
    sample: 'January 10, 2025',
    category: 'rental',
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

// Replace variables in template with actual data
export function replaceVariables(
  template: string,
  data: Record<string, string | number | null | undefined>
): string {
  let result = template;

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

// Format currency for display
export function formatCurrency(
  amount: number | null | undefined,
  currency: string = 'USD'
): string {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

// Build data object from rental, customer, vehicle, and tenant data
export function buildTemplateData(
  rental: {
    id: string;
    rental_number?: string | null;
    start_date: string;
    end_date?: string | null;
    monthly_amount: number;
    rental_period_type?: string | null;
  },
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    address?: string | null;
    customer_type?: string | null;
  },
  vehicle: {
    make: string;
    model: string;
    year?: number | null;
    reg: string;
    color?: string | null;
    vin?: string | null;
  },
  tenant: {
    company_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
  }
): Record<string, string> {
  return {
    // Customer
    customer_name: customer.name || '',
    customer_email: customer.email || '',
    customer_phone: customer.phone || '',
    customer_address: customer.address || '',
    customer_type: customer.customer_type || 'Individual',

    // Vehicle
    vehicle_make: vehicle.make || '',
    vehicle_model: vehicle.model || '',
    vehicle_year: vehicle.year?.toString() || '',
    vehicle_reg: vehicle.reg || '',
    vehicle_color: vehicle.color || '',
    vehicle_vin: vehicle.vin || '',

    // Rental
    rental_number: rental.rental_number || rental.id.substring(0, 8).toUpperCase(),
    rental_start_date: formatDate(rental.start_date),
    rental_end_date: rental.end_date ? formatDate(rental.end_date) : 'Ongoing',
    monthly_amount: formatCurrency(rental.monthly_amount),
    rental_period_type: rental.rental_period_type || 'Monthly',

    // Company
    company_name: tenant.company_name || '',
    company_email: tenant.contact_email || '',
    company_phone: tenant.contact_phone || '',

    // Agreement
    agreement_date: formatDate(new Date()),
  };
}
