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

  // Calculate next month (handle December -> January rollover)
  const nextMonth = Number(month) === 12 ? 1 : Number(month) + 1;
  const nextYear = Number(month) === 12 ? Number(year) + 1 : Number(year);

  // Get count of invoices this month
  let query = supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .gte('invoice_date', `${year}-${month}-01`)
    .lt('invoice_date', `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { count, error } = await query;

  if (error) {
    console.error('Error counting invoices:', error);
    throw error;
  }

  const sequence = String((count || 0) + 1).padStart(4, '0');
  return `INV-${year}${month}-${sequence}`;
};

// Create invoice
export const createInvoice = async (data: InvoiceData): Promise<Invoice> => {
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
    console.error('Error creating invoice:', error);
    throw error;
  }

  return invoice as Invoice;
};

// Format currency
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};
