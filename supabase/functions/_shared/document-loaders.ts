// Document loaders for converting Drive247 database records to text for RAG indexing
// Each function converts a record to { content: string, metadata: object }

export interface DocumentResult {
  content: string;
  metadata: Record<string, unknown>;
}

// Type definitions for database records
interface CustomerRecord {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  customer_type?: string | null;
  type?: string;
  status?: string | null;
  is_blocked?: boolean | null;
  blocked_reason?: string | null;
  license_number?: string | null;
  id_number?: string | null;
  identity_verification_status?: string | null;
  created_at?: string | null;
}

interface VehicleRecord {
  id: string;
  reg: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  colour?: string | null;
  fuel_type?: string | null;
  status?: string | null;
  daily_rent?: number | null;
  weekly_rent?: number | null;
  monthly_rent?: number | null;
  acquisition_type?: string | null;
  acquisition_date?: string | null;
  mot_due_date?: string | null;
  tax_due_date?: string | null;
  is_disposed?: boolean | null;
  vin?: string | null;
  description?: string | null;
  created_at?: string | null;
}

interface RentalRecord {
  id: string;
  rental_number?: string | null;
  status?: string | null;
  start_date: string;
  end_date?: string | null;
  monthly_amount: number;
  payment_mode?: string | null;
  approval_status?: string | null;
  payment_status?: string | null;
  insurance_status?: string | null;
  document_status?: string | null;
  pickup_location?: string | null;
  return_location?: string | null;
  promo_code?: string | null;
  discount_applied?: number | null;
  customer_id?: string | null;
  vehicle_id?: string | null;
  created_at?: string | null;
  // Joined data
  customer?: { name: string; email?: string | null } | null;
  vehicle?: { reg: string; make?: string | null; model?: string | null } | null;
}

interface PaymentRecord {
  id: string;
  amount: number;
  payment_type: string;
  payment_date: string;
  status?: string | null;
  method?: string | null;
  verification_status?: string | null;
  is_early?: boolean;
  capture_status?: string | null;
  refund_status?: string | null;
  refund_amount?: number | null;
  customer_id: string;
  rental_id?: string | null;
  vehicle_id?: string | null;
  created_at: string;
  // Joined data
  customer?: { name: string } | null;
  rental?: { rental_number?: string | null } | null;
  vehicle?: { reg: string } | null;
}

interface FineRecord {
  id: string;
  type: string;
  amount: number;
  issue_date: string;
  due_date: string;
  status?: string | null;
  liability?: string | null;
  reference_no?: string | null;
  notes?: string | null;
  vehicle_id: string;
  customer_id?: string | null;
  created_at?: string | null;
  // Joined data
  customer?: { name: string } | null;
  vehicle?: { reg: string } | null;
}

interface PlateRecord {
  id: string;
  plate_number: string;
  status?: string | null;
  cost?: number | null;
  order_date?: string | null;
  supplier?: string | null;
  notes?: string | null;
  vehicle_id?: string | null;
  assigned_vehicle_id?: string | null;
  created_at?: string | null;
  // Joined data
  vehicle?: { reg: string } | null;
}

/**
 * Convert customer record to searchable text
 */
export function customerToDocument(customer: CustomerRecord): DocumentResult {
  const parts: string[] = [
    `Customer: ${customer.name}`,
  ];

  if (customer.email) parts.push(`Email: ${customer.email}`);
  if (customer.phone) parts.push(`Phone: ${customer.phone}`);
  if (customer.customer_type) parts.push(`Type: ${customer.customer_type}`);
  if (customer.type) parts.push(`Category: ${customer.type}`);
  if (customer.status) parts.push(`Status: ${customer.status}`);
  if (customer.is_blocked) parts.push(`Blocked: Yes, Reason: ${customer.blocked_reason || 'Not specified'}`);
  if (customer.license_number) parts.push(`License: ${customer.license_number}`);
  if (customer.id_number) parts.push(`ID Number: ${customer.id_number}`);
  if (customer.identity_verification_status) {
    parts.push(`Identity Verification: ${customer.identity_verification_status}`);
  }

  return {
    content: parts.join('. '),
    metadata: {
      entity_type: 'customer',
      customer_id: customer.id,
      name: customer.name,
      email: customer.email,
      status: customer.status,
      is_blocked: customer.is_blocked,
    },
  };
}

/**
 * Convert vehicle record to searchable text
 */
export function vehicleToDocument(vehicle: VehicleRecord): DocumentResult {
  const color = vehicle.colour || vehicle.color;
  const vehicleName = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  const parts: string[] = [
    `Vehicle: ${vehicle.reg}`,
    vehicleName ? `${vehicleName}` : '',
  ].filter(Boolean);

  if (color) parts.push(`Color: ${color}`);
  if (vehicle.fuel_type) parts.push(`Fuel: ${vehicle.fuel_type}`);
  if (vehicle.status) parts.push(`Status: ${vehicle.status}`);
  if (vehicle.vin) parts.push(`VIN: ${vehicle.vin}`);

  // Pricing info
  const pricing: string[] = [];
  if (vehicle.daily_rent) pricing.push(`£${vehicle.daily_rent}/day`);
  if (vehicle.weekly_rent) pricing.push(`£${vehicle.weekly_rent}/week`);
  if (vehicle.monthly_rent) pricing.push(`£${vehicle.monthly_rent}/month`);
  if (pricing.length > 0) parts.push(`Rental rates: ${pricing.join(', ')}`);

  if (vehicle.acquisition_type) parts.push(`Acquisition: ${vehicle.acquisition_type}`);
  if (vehicle.mot_due_date) parts.push(`MOT due: ${formatDate(vehicle.mot_due_date)}`);
  if (vehicle.tax_due_date) parts.push(`Tax due: ${formatDate(vehicle.tax_due_date)}`);
  if (vehicle.is_disposed) parts.push(`Disposed: Yes`);
  if (vehicle.description) parts.push(`Description: ${vehicle.description}`);

  return {
    content: parts.join('. '),
    metadata: {
      entity_type: 'vehicle',
      vehicle_id: vehicle.id,
      registration: vehicle.reg,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      status: vehicle.status,
    },
  };
}

/**
 * Convert rental record to searchable text
 */
export function rentalToDocument(rental: RentalRecord): DocumentResult {
  const parts: string[] = [];

  if (rental.rental_number) {
    parts.push(`Rental #${rental.rental_number}`);
  } else {
    parts.push(`Rental ${rental.id.substring(0, 8)}`);
  }

  if (rental.customer?.name) parts.push(`Customer: ${rental.customer.name}`);
  if (rental.vehicle?.reg) {
    const vehicleInfo = [rental.vehicle.reg, rental.vehicle.make, rental.vehicle.model]
      .filter(Boolean).join(' ');
    parts.push(`Vehicle: ${vehicleInfo}`);
  }

  parts.push(`Start: ${formatDate(rental.start_date)}`);
  if (rental.end_date) parts.push(`End: ${formatDate(rental.end_date)}`);
  if (rental.status) parts.push(`Status: ${rental.status}`);
  parts.push(`Monthly amount: £${rental.monthly_amount}`);

  if (rental.payment_mode) parts.push(`Payment mode: ${rental.payment_mode}`);
  if (rental.approval_status) parts.push(`Approval: ${rental.approval_status}`);
  if (rental.payment_status) parts.push(`Payment status: ${rental.payment_status}`);
  if (rental.insurance_status) parts.push(`Insurance: ${rental.insurance_status}`);
  if (rental.document_status) parts.push(`Documents: ${rental.document_status}`);
  if (rental.pickup_location) parts.push(`Pickup: ${rental.pickup_location}`);
  if (rental.return_location) parts.push(`Return: ${rental.return_location}`);
  if (rental.promo_code) parts.push(`Promo code: ${rental.promo_code}`);
  if (rental.discount_applied) parts.push(`Discount: £${rental.discount_applied}`);

  return {
    content: parts.join('. '),
    metadata: {
      entity_type: 'rental',
      rental_id: rental.id,
      rental_number: rental.rental_number,
      customer_id: rental.customer_id,
      vehicle_id: rental.vehicle_id,
      status: rental.status,
      monthly_amount: rental.monthly_amount,
    },
  };
}

/**
 * Convert payment record to searchable text
 */
export function paymentToDocument(payment: PaymentRecord): DocumentResult {
  const parts: string[] = [
    `Payment of £${payment.amount}`,
    `Type: ${payment.payment_type}`,
    `Date: ${formatDate(payment.payment_date)}`,
  ];

  if (payment.status) parts.push(`Status: ${payment.status}`);
  if (payment.method) parts.push(`Method: ${payment.method}`);
  if (payment.customer?.name) parts.push(`Customer: ${payment.customer.name}`);
  if (payment.rental?.rental_number) parts.push(`Rental: #${payment.rental.rental_number}`);
  if (payment.vehicle?.reg) parts.push(`Vehicle: ${payment.vehicle.reg}`);
  if (payment.verification_status) parts.push(`Verification: ${payment.verification_status}`);
  if (payment.is_early) parts.push(`Early payment: Yes`);
  if (payment.capture_status) parts.push(`Capture: ${payment.capture_status}`);
  if (payment.refund_status) {
    parts.push(`Refund status: ${payment.refund_status}`);
    if (payment.refund_amount) parts.push(`Refund amount: £${payment.refund_amount}`);
  }

  return {
    content: parts.join('. '),
    metadata: {
      entity_type: 'payment',
      payment_id: payment.id,
      amount: payment.amount,
      payment_type: payment.payment_type,
      customer_id: payment.customer_id,
      rental_id: payment.rental_id,
      status: payment.status,
    },
  };
}

/**
 * Convert fine record to searchable text
 */
export function fineToDocument(fine: FineRecord): DocumentResult {
  const parts: string[] = [
    `Fine: ${fine.type}`,
    `Amount: £${fine.amount}`,
    `Issue date: ${formatDate(fine.issue_date)}`,
    `Due date: ${formatDate(fine.due_date)}`,
  ];

  if (fine.status) parts.push(`Status: ${fine.status}`);
  if (fine.liability) parts.push(`Liability: ${fine.liability}`);
  if (fine.reference_no) parts.push(`Reference: ${fine.reference_no}`);
  if (fine.customer?.name) parts.push(`Customer: ${fine.customer.name}`);
  if (fine.vehicle?.reg) parts.push(`Vehicle: ${fine.vehicle.reg}`);
  if (fine.notes) parts.push(`Notes: ${fine.notes}`);

  return {
    content: parts.join('. '),
    metadata: {
      entity_type: 'fine',
      fine_id: fine.id,
      type: fine.type,
      amount: fine.amount,
      vehicle_id: fine.vehicle_id,
      customer_id: fine.customer_id,
      status: fine.status,
    },
  };
}

/**
 * Convert plate record to searchable text
 */
export function plateToDocument(plate: PlateRecord): DocumentResult {
  const parts: string[] = [
    `Plate: ${plate.plate_number}`,
  ];

  if (plate.status) parts.push(`Status: ${plate.status}`);
  if (plate.cost) parts.push(`Cost: £${plate.cost}`);
  if (plate.supplier) parts.push(`Supplier: ${plate.supplier}`);
  if (plate.order_date) parts.push(`Order date: ${formatDate(plate.order_date)}`);
  if (plate.vehicle?.reg) parts.push(`Assigned to vehicle: ${plate.vehicle.reg}`);
  if (plate.notes) parts.push(`Notes: ${plate.notes}`);

  return {
    content: parts.join('. '),
    metadata: {
      entity_type: 'plate',
      plate_id: plate.id,
      plate_number: plate.plate_number,
      vehicle_id: plate.vehicle_id || plate.assigned_vehicle_id,
      status: plate.status,
    },
  };
}

/**
 * Get document loader for a given table
 */
export function getDocumentLoader(tableName: string): ((record: unknown) => DocumentResult) | null {
  const loaders: Record<string, (record: unknown) => DocumentResult> = {
    customers: (r) => customerToDocument(r as CustomerRecord),
    vehicles: (r) => vehicleToDocument(r as VehicleRecord),
    rentals: (r) => rentalToDocument(r as RentalRecord),
    payments: (r) => paymentToDocument(r as PaymentRecord),
    fines: (r) => fineToDocument(r as FineRecord),
    plates: (r) => plateToDocument(r as PlateRecord),
  };

  return loaders[tableName] || null;
}

/**
 * Get list of tables that are indexed for RAG
 */
export function getIndexedTables(): string[] {
  return ['customers', 'vehicles', 'rentals', 'payments', 'fines', 'plates'];
}

/**
 * Get select query fields for each table (with joins)
 */
export function getSelectFields(tableName: string): string {
  const selectFields: Record<string, string> = {
    customers: '*',
    vehicles: '*',
    rentals: '*, customer:customers(name, email), vehicle:vehicles(reg, make, model)',
    payments: '*, customer:customers(name), rental:rentals(rental_number), vehicle:vehicles(reg)',
    fines: '*, customer:customers(name), vehicle:vehicles(reg)',
    plates: '*, vehicle:vehicles(reg)',
  };

  return selectFields[tableName] || '*';
}

// Helper to format dates
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}
