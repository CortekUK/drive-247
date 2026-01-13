import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { corsHeaders } from "../_shared/aws-config.ts";
import {
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate,
} from "../_shared/resend-service.ts";

interface SendInvoiceEmailRequest {
  invoiceId: string;
  tenantId: string;
  recipientEmail?: string;
}

interface InvoiceData {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  notes: string | null;
  customers: {
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  vehicles: {
    reg: string;
    make: string;
    model: string;
  } | null;
  rentals: {
    start_date: string;
    end_date: string;
    monthly_amount: number;
  } | null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function generateInvoicePDF(invoice: InvoiceData, branding: TenantBranding): string {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 20;

  // Company Header
  doc.setFontSize(24);
  doc.setTextColor(parseInt(branding.accentColor.slice(1, 3), 16), parseInt(branding.accentColor.slice(3, 5), 16), parseInt(branding.accentColor.slice(5, 7), 16));
  doc.text(branding.companyName.toUpperCase(), 20, yPos);
  yPos += 15;

  // Invoice Title
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text("INVOICE", pageWidth - 20, 20, { align: "right" });

  // Invoice Number and Date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Invoice #: ${invoice.invoice_number}`, pageWidth - 20, 30, { align: "right" });
  doc.text(`Date: ${formatDate(invoice.invoice_date)}`, pageWidth - 20, 37, { align: "right" });
  if (invoice.due_date) {
    doc.text(`Due Date: ${formatDate(invoice.due_date)}`, pageWidth - 20, 44, { align: "right" });
  }

  // Horizontal line
  yPos = 55;
  doc.setDrawColor(200, 200, 200);
  doc.line(20, yPos, pageWidth - 20, yPos);
  yPos += 15;

  // Bill To Section
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text("Bill To:", 20, yPos);
  yPos += 7;
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  if (invoice.customers) {
    doc.text(invoice.customers.name, 20, yPos);
    yPos += 5;
    if (invoice.customers.email) {
      doc.text(invoice.customers.email, 20, yPos);
      yPos += 5;
    }
    if (invoice.customers.phone) {
      doc.text(invoice.customers.phone, 20, yPos);
      yPos += 5;
    }
  }

  // Vehicle & Rental Info Box
  yPos += 10;
  doc.setFillColor(248, 249, 250);
  doc.roundedRect(20, yPos, pageWidth - 40, 35, 3, 3, "F");
  yPos += 8;

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text("Rental Information", 25, yPos);
  yPos += 8;

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  if (invoice.vehicles) {
    doc.text(`Vehicle: ${invoice.vehicles.make} ${invoice.vehicles.model} (${invoice.vehicles.reg})`, 25, yPos);
    yPos += 5;
  }
  if (invoice.rentals) {
    doc.text(`Period: ${formatDate(invoice.rentals.start_date)} - ${formatDate(invoice.rentals.end_date)}`, 25, yPos);
  }

  // Invoice Items Table
  yPos += 25;

  // Table Header
  doc.setFillColor(240, 240, 240);
  doc.rect(20, yPos, pageWidth - 40, 10, "F");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text("Description", 25, yPos + 7);
  doc.text("Amount", pageWidth - 25, yPos + 7, { align: "right" });
  yPos += 15;

  // Rental Fee Row
  doc.setTextColor(60, 60, 60);
  doc.text("Rental Fee", 25, yPos);
  doc.text(formatCurrency(invoice.subtotal), pageWidth - 25, yPos, { align: "right" });
  yPos += 8;

  // Tax Row (if applicable)
  if (invoice.tax_amount > 0) {
    doc.text("Taxes & Fees", 25, yPos);
    doc.text(formatCurrency(invoice.tax_amount), pageWidth - 25, yPos, { align: "right" });
    yPos += 8;
  }

  // Divider line
  doc.setDrawColor(200, 200, 200);
  doc.line(20, yPos, pageWidth - 20, yPos);
  yPos += 8;

  // Total Row
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text("Total", 25, yPos);
  doc.setTextColor(parseInt(branding.accentColor.slice(1, 3), 16), parseInt(branding.accentColor.slice(3, 5), 16), parseInt(branding.accentColor.slice(5, 7), 16));
  doc.text(formatCurrency(invoice.total_amount), pageWidth - 25, yPos, { align: "right" });

  // Notes (if any)
  if (invoice.notes) {
    yPos += 20;
    doc.setFillColor(248, 249, 250);
    doc.roundedRect(20, yPos, pageWidth - 40, 25, 3, 3, "F");
    yPos += 8;
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text("Notes:", 25, yPos);
    yPos += 6;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(invoice.notes, 25, yPos);
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 20;
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text("Thank you for your business!", pageWidth / 2, footerY, { align: "center" });
  doc.text(`${branding.companyName} | ${branding.contactEmail}`, pageWidth / 2, footerY + 5, { align: "center" });

  // Return base64 encoded PDF
  return doc.output("datauristring").split(",")[1];
}

function generateEmailContent(invoice: InvoiceData, branding: TenantBranding): string {
  return `
    <tr>
      <td style="padding: 30px 30px 0; text-align: center;">
        <span style="display: inline-block; background: #f0f9ff; color: #0369a1; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
          INVOICE
        </span>
      </td>
    </tr>
    <tr>
      <td style="padding: 30px;">
        <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${invoice.customers?.name || "Customer"},</h2>
        <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
          Please find attached your invoice <strong>${invoice.invoice_number}</strong> from ${branding.companyName}.
        </p>
        <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-left: 4px solid ${branding.accentColor}; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
          <tr>
            <td style="padding: 20px;">
              <h3 style="margin: 0 0 15px; color: #1a1a1a; font-size: 16px;">Invoice Details</h3>
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #666; font-size: 14px;">Invoice #:</td>
                  <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${invoice.invoice_number}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666; font-size: 14px;">Date:</td>
                  <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;">${formatDate(invoice.invoice_date)}</td>
                </tr>
                ${invoice.due_date ? `
                <tr>
                  <td style="padding: 8px 0; color: #666; font-size: 14px;">Due Date:</td>
                  <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;">${formatDate(invoice.due_date)}</td>
                </tr>
                ` : ""}
                ${invoice.vehicles ? `
                <tr>
                  <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                  <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;">${invoice.vehicles.make} ${invoice.vehicles.model} (${invoice.vehicles.reg})</td>
                </tr>
                ` : ""}
              </table>
            </td>
          </tr>
        </table>
        <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, ${branding.accentColor} 0%, #d4b896 100%); border-radius: 8px; margin-bottom: 25px;">
          <tr>
            <td style="padding: 20px; text-align: center;">
              <p style="margin: 0 0 5px; color: rgba(255,255,255,0.9); font-size: 14px;">Total Amount</p>
              <p style="margin: 0; color: white; font-size: 32px; font-weight: bold;">${formatCurrency(invoice.total_amount)}</p>
            </td>
          </tr>
        </table>
        <p style="margin: 0 0 15px; color: #444; line-height: 1.6; font-size: 16px;">
          The invoice PDF is attached to this email for your records.
        </p>
        <p style="margin: 0 0 15px; color: #444; line-height: 1.6; font-size: 16px;">
          If you have any questions about this invoice, please don't hesitate to contact us.
        </p>
        <p style="margin: 0; color: #444; font-size: 16px;">Thank you for choosing ${branding.companyName}!</p>
      </td>
    </tr>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { invoiceId, tenantId, recipientEmail }: SendInvoiceEmailRequest = await req.json();

    if (!invoiceId || !tenantId) {
      throw new Error("Missing required fields: invoiceId and tenantId");
    }

    console.log(`Sending invoice email for invoice: ${invoiceId}, tenant: ${tenantId}`);

    // Fetch invoice with related data
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select(`
        *,
        customers:customer_id (name, email, phone),
        vehicles:vehicle_id (reg, make, model),
        rentals:rental_id (start_date, end_date, monthly_amount)
      `)
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
      .single();

    if (invoiceError || !invoice) {
      console.error("Error fetching invoice:", invoiceError);
      throw new Error("Invoice not found or access denied");
    }

    // Get tenant branding
    const branding = await getTenantBranding(tenantId, supabase);
    console.log("Using tenant branding:", branding.companyName);

    // Determine recipient email
    const toEmail = recipientEmail || invoice.customers?.email;
    if (!toEmail) {
      throw new Error("No recipient email available. Please add an email address for this customer.");
    }

    // Generate PDF
    console.log("Generating invoice PDF...");
    const pdfBase64 = generateInvoicePDF(invoice as InvoiceData, branding);
    console.log("PDF generated successfully");

    // Generate email HTML
    const emailContent = generateEmailContent(invoice as InvoiceData, branding);
    const emailHtml = wrapWithBrandedTemplate(emailContent, branding);

    // Send via Resend with attachment
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY) {
      console.log("RESEND_API_KEY not configured, simulating email send");
      return new Response(
        JSON.stringify({
          success: true,
          simulated: true,
          messageId: "simulated-" + Date.now(),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const fromEmail = `${branding.slug}@drive-247.com`;
    const fromName = branding.companyName;

    console.log(`Sending email from: ${fromName} <${fromEmail}> to: ${toEmail}`);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [toEmail],
        subject: `Invoice ${invoice.invoice_number} - ${branding.companyName}`,
        html: emailHtml,
        attachments: [
          {
            filename: `Invoice-${invoice.invoice_number}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    });

    const result = await response.json();
    console.log("Resend API response:", response.status, result);

    if (!response.ok) {
      throw new Error(result.message || "Failed to send email via Resend");
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId: result.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in send-invoice-email:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
