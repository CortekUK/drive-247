import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/aws-config.ts";
import {
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate,
  sendResendEmail,
} from "../_shared/resend-service.ts";
import { getStripeClient, getConnectAccountId, type StripeMode } from "../_shared/stripe-client.ts";
import { formatCurrency } from "../_shared/format-utils.ts";

interface SendInvoiceEmailRequest {
  invoiceId?: string;
  tenantId: string;
  recipientEmail?: string;
  rentalId?: string;
  customerName?: string;
  amount?: number;
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
  rental_id: string | null;
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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function generateEmailContent(invoice: InvoiceData, branding: TenantBranding, currencyCode: string, paymentUrl?: string, overrideAmount?: number, overrideDescription?: string, depositHoldAmount?: number): string {
  const displayAmount = overrideAmount ?? invoice.total_amount;
  const depositNotice = depositHoldAmount && depositHoldAmount > 0 ? `
        <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; margin-bottom: 25px;">
          <tr>
            <td style="padding: 16px;">
              <p style="margin: 0 0 8px; color: #92400e; font-size: 14px; font-weight: 600;">Heads up: what happens when you pay</p>
              <ul style="margin: 0; padding-left: 18px; color: #78350f; font-size: 13px; line-height: 1.6;">
                <li>You will be charged <strong>${formatCurrency(displayAmount, currencyCode)}</strong> for your rental fees (the amount shown above).</li>
                <li>Right after that, a separate <strong>${formatCurrency(depositHoldAmount, currencyCode)} security deposit hold</strong> will be authorised on the same card. This is <em>not</em> a charge &mdash; the amount is reserved on your card and released when your rental ends (or captured if there is damage / unpaid extras).</li>
                <li>You only enter your card details once.</li>
              </ul>
            </td>
          </tr>
        </table>` : "";
  const payNowButton = paymentUrl ? `
        <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
          <tr>
            <td style="text-align: center;">
              <a href="${paymentUrl}" style="display: inline-block; background: ${branding.accentColor}; color: #ffffff; padding: 14px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; text-decoration: none;">
                Pay Now - ${formatCurrency(displayAmount, currencyCode)}
              </a>
            </td>
          </tr>
        </table>` : "";

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
          Here is your invoice <strong>${invoice.invoice_number}</strong> from ${branding.companyName}.
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
              <p style="margin: 0 0 5px; color: rgba(255,255,255,0.9); font-size: 14px;">${overrideDescription ? 'Amount Due' : 'Total Amount'}</p>
              <p style="margin: 0; color: white; font-size: 32px; font-weight: bold;">${formatCurrency(displayAmount, currencyCode)}</p>
              ${overrideDescription ? `<p style="margin: 5px 0 0; color: rgba(255,255,255,0.8); font-size: 13px;">${overrideDescription}</p>` : ''}
            </td>
          </tr>
        </table>
        ${depositNotice}
        ${payNowButton}
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

    const { invoiceId, tenantId, recipientEmail, paymentUrl: externalPaymentUrl, overrideAmount, overrideDescription, rentalId: bodyRentalId, customerName: bodyCustomerName, amount: bodyAmount, depositHoldAmount }: SendInvoiceEmailRequest & { paymentUrl?: string; overrideAmount?: number; overrideDescription?: string; depositHoldAmount?: number } = await req.json();

    if (!tenantId) {
      throw new Error("Missing required field: tenantId");
    }

    let invoice: InvoiceData | null = null;

    if (invoiceId) {
      console.log(`Sending invoice email for invoice: ${invoiceId}, tenant: ${tenantId}`);

      // Fetch invoice with related data
      const { data: invoiceData, error: invoiceError } = await supabase
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

      if (invoiceError || !invoiceData) {
        console.error("Error fetching invoice:", invoiceError);
        throw new Error("Invoice not found or access denied");
      }
      invoice = invoiceData as InvoiceData;
    } else if (bodyRentalId) {
      // No invoice — build a minimal invoice-like object from rental data
      console.log(`Sending payment link email for rental: ${bodyRentalId}, tenant: ${tenantId}`);

      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .select(`
          id, start_date, end_date, monthly_amount,
          customers:customer_id (name, email, phone),
          vehicles:vehicle_id (reg, make, model)
        `)
        .eq("id", bodyRentalId)
        .single();

      if (rentalError || !rental) {
        console.error("Error fetching rental:", rentalError);
        throw new Error("Rental not found");
      }

      invoice = {
        id: bodyRentalId,
        invoice_number: `PAY-${bodyRentalId.slice(0, 8).toUpperCase()}`,
        invoice_date: new Date().toISOString(),
        due_date: null,
        subtotal: bodyAmount || rental.monthly_amount || 0,
        tax_amount: 0,
        total_amount: bodyAmount || rental.monthly_amount || 0,
        notes: null,
        rental_id: bodyRentalId,
        customers: rental.customers as InvoiceData["customers"],
        vehicles: rental.vehicles as InvoiceData["vehicles"],
        rentals: { start_date: rental.start_date, end_date: rental.end_date, monthly_amount: rental.monthly_amount },
      };
    } else if (externalPaymentUrl && recipientEmail) {
      // Account-level payment link (no invoice, no rental) — e.g. the customer
      // "collect then decide" credit flow. Build a minimal invoice-like object
      // straight from the supplied amount + name + the pre-made Stripe link.
      console.log(`Sending account-level payment link email to: ${recipientEmail}, tenant: ${tenantId}`);
      const amt = bodyAmount || overrideAmount || 0;
      invoice = {
        id: `account-${Date.now()}`,
        invoice_number: "PAYMENT",
        invoice_date: new Date().toISOString(),
        due_date: null,
        subtotal: amt,
        tax_amount: 0,
        total_amount: amt,
        notes: null,
        rental_id: null as unknown as string,
        customers: { name: bodyCustomerName || "Customer", email: recipientEmail, phone: null } as InvoiceData["customers"],
        vehicles: null as unknown as InvoiceData["vehicles"],
        rentals: null as unknown as InvoiceData["rentals"],
      };
    } else {
      throw new Error("Missing required field: invoiceId or rentalId");
    }

    // Get tenant branding
    const branding = await getTenantBranding(tenantId, supabase);
    console.log("Using tenant branding:", branding.companyName);

    // Determine recipient email
    const toEmail = recipientEmail || invoice.customers?.email;
    if (!toEmail) {
      throw new Error("No recipient email available. Please add an email address for this customer.");
    }

    // Fetch tenant data for Stripe and currency
    const { data: tenant } = await supabase
      .from("tenants")
      .select("slug, stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code")
      .eq("id", tenantId)
      .single();

    const tenantCurrencyCode = tenant?.currency_code || "USD";

    // Use external payment URL if provided (from create-checkout-session), otherwise create our own
    let paymentUrl: string | undefined = externalPaymentUrl || undefined;
    if (!paymentUrl) try {
      if (tenant) {
        const stripeMode = (tenant.stripe_mode as StripeMode) || "test";
        const stripe = getStripeClient(stripeMode);
        const connectAccountId = getConnectAccountId(tenant);
        const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;
        const currencyCode = tenantCurrencyCode.toLowerCase();
        const tenantSlug = tenant.slug || branding.slug;
        const bookingDomain = `https://${tenantSlug}.drive-247.com`;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [{
            price_data: {
              currency: currencyCode,
              product_data: {
                name: `Invoice ${invoice.invoice_number}`,
                description: `Payment for invoice ${invoice.invoice_number} - ${branding.companyName}`,
              },
              unit_amount: Math.round(invoice.total_amount * 100),
            },
            quantity: 1,
          }],
          mode: "payment",
          customer_email: toEmail,
          success_url: `${bookingDomain}/booking-success?type=invoice&status=paid`,
          cancel_url: `${bookingDomain}/portal/payments`,
          payment_intent_data: {
            receipt_email: toEmail,
            // Save the card so create-deposit-hold can preauth the Security Deposit
            // on the same payment method after the invoice is paid.
            setup_future_usage: 'off_session',
          },
          metadata: {
            invoice_id: invoiceId,
            tenant_id: tenantId,
            rental_id: invoice.rental_id || "",
            type: "invoice_payment",
          },
        }, stripeOptions);

        paymentUrl = session.url || undefined;
        console.log("Stripe checkout session created:", session.id);

        // Pre-create payment record so webhook can find and update it
        if (session.id && invoice.rental_id) {
          const { error: paymentInsertError } = await supabase.from("payments").insert({
            customer_id: invoice.customer_id,
            vehicle_id: invoice.vehicle_id,
            rental_id: invoice.rental_id,
            amount: invoice.total_amount,
            payment_type: "Payment",
            status: "Pending",
            method: "Card",
            stripe_checkout_session_id: session.id,
            tenant_id: tenantId,
          });
          if (paymentInsertError) {
            console.error("Failed to pre-create payment record:", paymentInsertError);
          } else {
            console.log("Payment record pre-created for session:", session.id);
          }
        }
      }
    } catch (stripeError) {
      console.error("Failed to create Stripe checkout session (continuing without payment link):", stripeError);
    }

    // Generate email HTML
    const emailContent = generateEmailContent(invoice as InvoiceData, branding, tenantCurrencyCode, paymentUrl, overrideAmount, overrideDescription, depositHoldAmount);
    const emailHtml = wrapWithBrandedTemplate(emailContent, branding);

    console.log(`Sending invoice email to: ${toEmail}`);

    const result = await sendResendEmail(
      {
        to: toEmail,
        subject: `Invoice ${invoice.invoice_number} - ${branding.companyName}`,
        html: emailHtml,
        tenantId,
      },
      supabase
    );

    if (!result.success) {
      throw new Error(result.error || "Failed to send email via Resend");
    }

    return new Response(
      JSON.stringify({ success: true, messageId: result.messageId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
