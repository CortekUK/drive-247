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
  total_amount: number;
  notes?: string;
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
  total_amount: number;
  status: string;
  notes?: string;
  created_at: string;
}

// Generate unique invoice number
export const generateInvoiceNumber = async (): Promise<string> => {
  const now = new Date();
  const year = format(now, 'yyyy');
  const month = format(now, 'MM');

  // Get count of invoices this month
  const { count, error } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .gte('invoice_date', `${year}-${month}-01`)
    .lt('invoice_date', `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`);

  if (error) {
    console.error('Error counting invoices:', error);
    throw error;
  }

  const sequence = String((count || 0) + 1).padStart(4, '0');
  return `INV-${year}${month}-${sequence}`;
};

// Create invoice
export const createInvoice = async (data: InvoiceData): Promise<Invoice> => {
  const invoiceNumber = await generateInvoiceNumber();

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
      total_amount: data.total_amount,
      status: 'pending',
      notes: data.notes,
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
