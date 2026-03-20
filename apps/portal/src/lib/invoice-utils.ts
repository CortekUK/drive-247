import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export interface InvoiceData {
  rental_id: string;
  customer_id: string;
  vehicle_id: string;
  invoice_date: Date;
  due_date?: Date;
  subtotal: number;
  tax_amount?: number;
  service_fee?: number;
  security_deposit?: number;
  insurance_premium?: number;
  delivery_fee?: number;
  extras_total?: number;
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
  tax_amount: number;
  service_fee?: number;
  security_deposit?: number;
  insurance_premium?: number;
  delivery_fee?: number;
  extras_total?: number;
  total_amount: number;
  status: string;
  notes?: string;
  created_at: string;
}

// Generate unique invoice number
export const generateInvoiceNumber = async (tenantId?: string): Promise<string> => {
  const now = new Date();
  const year = format(now, 'yyyy');
  const month = format(now, 'MM');

  // Find the highest sequence number used this month
  const prefix = `INV-${year}${month}-`;
  const { data: latestInvoice } = await supabase
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', `${prefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextSeq = 1;
  if (latestInvoice?.invoice_number) {
    const lastSeq = parseInt(latestInvoice.invoice_number.replace(prefix, ''), 10);
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  const sequence = String(nextSeq).padStart(4, '0');
  return `${prefix}${sequence}`;
};

// Create invoice (retries once on unique constraint conflict)
export const createInvoice = async (data: InvoiceData): Promise<Invoice> => {
  const maxRetries = 2;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const invoiceNumber = await generateInvoiceNumber(data.tenant_id);

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert({
        rental_id: data.rental_id,
        customer_id: data.customer_id,
        vehicle_id: data.vehicle_id,
        invoice_number: invoiceNumber,
        invoice_date: format(data.invoice_date, 'yyyy-MM-dd'),
        due_date: data.due_date ? format(data.due_date, 'yyyy-MM-dd') : null,
        subtotal: data.subtotal,
        rental_fee: data.subtotal,
        tax_amount: data.tax_amount || 0,
        service_fee: data.service_fee || 0,
        security_deposit: data.security_deposit || 0,
        insurance_premium: data.insurance_premium || 0,
        delivery_fee: data.delivery_fee || 0,
        extras_total: data.extras_total || 0,
        total_amount: data.total_amount,
        status: 'pending',
        notes: data.notes,
        tenant_id: data.tenant_id,
      })
      .select()
      .single();

    if (error) {
      // Retry on unique constraint violation (duplicate invoice number)
      if (error.code === '23505' && attempt < maxRetries - 1) {
        console.warn(`Invoice number ${invoiceNumber} conflict, retrying...`);
        continue;
      }
      console.error('Error creating invoice:', error.message, error.code, error.details);
      throw error;
    }

    return invoice as Invoice;
  }

  throw new Error('Failed to create invoice after retries');
};

// Re-export formatCurrency from shared format-utils
export { formatCurrency } from "@/lib/format-utils";
