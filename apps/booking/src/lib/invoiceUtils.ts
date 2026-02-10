import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export interface InvoiceData {
  rental_id: string;
  customer_id: string;
  vehicle_id: string;
  invoice_date: Date;
  due_date?: Date;
  subtotal: number;
  rental_fee?: number;
  protection_fee?: number;
  tax_amount?: number;
  service_fee?: number;
  security_deposit?: number;
  insurance_premium?: number;
  delivery_fee?: number;
  extras_total?: number;
  discount_amount?: number;
  promo_code?: string | null;
  total_amount: number;
  notes?: string;
  tenant_id?: string;
}

export interface Invoice {
  id: string;
  rental_id: string;
  customer_id: string;
  vehicle_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date?: string;
  subtotal: number;
  rental_fee?: number;
  protection_fee?: number;
  tax_amount: number;
  service_fee?: number;
  security_deposit?: number;
  insurance_premium?: number;
  delivery_fee?: number;
  extras_total?: number;
  discount_amount?: number;
  promo_code?: string | null;
  total_amount: number;
  status: string;
  notes?: string;
  created_at: string;
}

// Generate unique invoice number using timestamp + random
export const generateInvoiceNumber = (): string => {
  const now = new Date();
  const year = format(now, 'yyyy');
  const month = format(now, 'MM');
  const day = format(now, 'dd');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${year}${month}${day}-${random}`;
};

// Create invoice in database
export const createInvoice = async (data: InvoiceData): Promise<Invoice> => {
  const invoiceNumber = generateInvoiceNumber();

  console.log('📄 Creating invoice with data:', {
    rental_id: data.rental_id,
    customer_id: data.customer_id,
    vehicle_id: data.vehicle_id,
    invoice_number: invoiceNumber,
    total_amount: data.total_amount,
  });

  // Note: discount_amount and promo_code are intentionally excluded from DB insert
  // as these columns don't exist in the current invoices table schema.
  // The total_amount already reflects any applied discounts.
  const invoiceData: any = {
    rental_id: data.rental_id,
    customer_id: data.customer_id,
    vehicle_id: data.vehicle_id,
    invoice_number: invoiceNumber,
    invoice_date: format(data.invoice_date, 'yyyy-MM-dd'),
    due_date: data.due_date ? format(data.due_date, 'yyyy-MM-dd') : null,
    subtotal: data.subtotal,
    rental_fee: data.rental_fee || data.subtotal,
    protection_fee: data.protection_fee || 0,
    tax_amount: data.tax_amount || 0,
    service_fee: data.service_fee || 0,
    security_deposit: data.security_deposit || 0,
    insurance_premium: data.insurance_premium || 0,
    delivery_fee: data.delivery_fee || 0,
    extras_total: data.extras_total || 0,
    total_amount: data.total_amount,
    status: 'pending',
    notes: data.notes || undefined,
  };

  if (data.tenant_id) {
    invoiceData.tenant_id = data.tenant_id;
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert(invoiceData)
    .select()
    .single();

  if (error) {
    console.error('❌ Error creating invoice in database:', error);
    throw error;
  }

  console.log('✅ Invoice created:', invoice.invoice_number);
  return invoice as Invoice;
};

// Create a local invoice object (without saving to database)
// Use this as fallback if database insert fails
export const createLocalInvoice = (data: InvoiceData): Invoice => {
  const invoiceNumber = generateInvoiceNumber();
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    rental_id: data.rental_id,
    customer_id: data.customer_id,
    vehicle_id: data.vehicle_id,
    invoice_number: invoiceNumber,
    invoice_date: format(data.invoice_date, 'yyyy-MM-dd'),
    due_date: data.due_date ? format(data.due_date, 'yyyy-MM-dd') : undefined,
    subtotal: data.subtotal,
    rental_fee: data.rental_fee || data.subtotal,
    protection_fee: data.protection_fee || 0,
    tax_amount: data.tax_amount || 0,
    service_fee: data.service_fee || 0,
    security_deposit: data.security_deposit || 0,
    insurance_premium: data.insurance_premium || 0,
    delivery_fee: data.delivery_fee || 0,
    extras_total: data.extras_total || 0,
    discount_amount: data.discount_amount || 0,
    promo_code: data.promo_code || null,
    total_amount: data.total_amount,
    status: 'pending',
    notes: data.notes,
    created_at: now,
  };
};

// Try to create invoice in DB, fallback to local if fails
export const createInvoiceWithFallback = async (data: InvoiceData): Promise<Invoice> => {
  try {
    return await createInvoice(data);
  } catch (error) {
    console.warn('⚠️ Database invoice creation failed, using local invoice:', error);
    return createLocalInvoice(data);
  }
};

// Re-export formatCurrency from shared utility (accepts currencyCode parameter)
export { formatCurrency } from '@/lib/format-utils';
