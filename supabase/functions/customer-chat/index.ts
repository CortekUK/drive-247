// Customer AI Chat Edge Function (Trax)
// Self-contained - no shared module dependencies for MCP deployment

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// ============================================================================
// CORS Helpers (inlined)
// ============================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ error: message }, status);
}

function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

// ============================================================================
// OpenAI Helpers (inlined)
// ============================================================================
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const CHAT_MODEL = 'gpt-4o-mini';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  temperature?: number;
  max_tokens?: number;
  model?: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResponse> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const { temperature = 0.7, max_tokens = 2048, model = CHAT_MODEL } = options;

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI chat completion error: ${response.status} - ${error}`);
  }

  return await response.json();
}

// ============================================================================
// Request/Response Types
// ============================================================================
interface CustomerChatRequest {
  message: string;
}

interface ChartData {
  type: 'bar' | 'pie' | 'line';
  title: string;
  data: Array<{ name: string; value: number }>;
}

// Parse chart data from AI response
function parseChartData(content: string): { cleanContent: string; chart?: ChartData } {
  const chartMatch = content.match(/---CHART_DATA---\n?([\s\S]*?)\n?---END_CHART---/);

  if (!chartMatch) {
    return { cleanContent: content };
  }

  try {
    const chartJson = chartMatch[1].trim();
    const chart = JSON.parse(chartJson) as ChartData;
    const cleanContent = content.replace(/---CHART_DATA---[\s\S]*?---END_CHART---/, '').trim();
    return { cleanContent, chart };
  } catch (e) {
    console.error('Failed to parse chart data:', e);
    return { cleanContent: content };
  }
}

// ============================================================================
// Currency Helpers (inlined - this function is self-contained)
// ============================================================================
function getCurrencySymbolLocal(currencyCode: string = 'GBP'): string {
  const symbols: Record<string, string> = { USD: '$', GBP: '\u00a3', EUR: '\u20ac' };
  return symbols[currencyCode?.toUpperCase()] || currencyCode;
}

function formatCurrencyLocal(amount: number, currencyCode: string = 'GBP'): string {
  const code = currencyCode?.toUpperCase() || 'GBP';
  const localeMap: Record<string, string> = { USD: 'en-US', GBP: 'en-GB', EUR: 'en-IE' };
  const locale = localeMap[code] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

// ============================================================================
// System Prompt Builder
// ============================================================================
function getSystemPrompt(customerName: string, context: Record<string, unknown>, tenantName: string, currencyCode: string = 'GBP'): string {
  const currencySymbol = getCurrencySymbolLocal(currencyCode);
  const customer = context.customer as Record<string, unknown> || {};
  const rentals = context.rentals as Array<Record<string, unknown>> || [];
  const payments = context.payments as Array<Record<string, unknown>> || [];
  const agreements = context.agreements as Array<Record<string, unknown>> || [];
  const installments = context.installments as Array<Record<string, unknown>> || [];
  const bonzahPolicies = context.bonzah_policies as Array<Record<string, unknown>> || [];
  const verification = context.verification as Record<string, unknown> || null;

  const customerInfo = customer ? `
Customer Profile:
- Name: ${customer.name || 'N/A'}
- Email: ${customer.email || 'N/A'}
- Phone: ${customer.phone || 'N/A'}
- Verification Status: ${customer.identity_verification_status || 'Not verified'}
- Account Status: ${customer.status || 'N/A'}` : '';

  const rentalsInfo = rentals.length > 0 ? `
Recent Rentals (${rentals.length}):
${rentals.map((r, i) => `${i + 1}. Rental #${r.rental_number || 'N/A'}
   - Status: ${r.status || 'N/A'}
   - Vehicle: ${r.vehicle_make || ''} ${r.vehicle_model || ''} (${r.vehicle_registration || 'N/A'})
   - Dates: ${r.start_date || 'N/A'} to ${r.end_date || 'N/A'}
   - Monthly: ${formatCurrencyLocal(Number(r.monthly_amount) || 0, currencyCode)}
   - Payment Status: ${r.payment_status || 'N/A'}`).join('\n')}` : '\nNo recent rentals.';

  const paymentsInfo = payments.length > 0 ? `
Recent Payments (${payments.length}):
${payments.slice(0, 5).map((p, i) => `${i + 1}. ${formatCurrencyLocal(Number(p.amount) || 0, currencyCode)} - ${p.status || 'N/A'} (${p.payment_type || 'N/A'})
   - Rental: ${p.rental_number || 'N/A'}
   - Date: ${p.created_at ? new Date(p.created_at as string).toLocaleDateString('en-GB') : 'N/A'}`).join('\n')}` : '\nNo recent payments.';

  const agreementsInfo = agreements.length > 0 ? `
Rental Agreements:
${agreements.map((a, i) => `${i + 1}. Rental #${a.rental_number || 'N/A'}
   - Status: ${a.status || 'N/A'}
   - Agreement Status: ${a.docusign_status || 'N/A'}
   - Signed: ${a.signed_at ? 'Yes' : 'No'}`).join('\n')}` : '';

  const installmentsInfo = installments.length > 0 ? `
Active Installment Plans:
${installments.map((ip, i) => `${i + 1}. Rental #${ip.rental_number || 'N/A'}
   - Total: ${formatCurrencyLocal(Number(ip.total_amount) || 0, currencyCode)}
   - Paid: ${formatCurrencyLocal(Number(ip.paid_amount) || 0, currencyCode)}
   - Remaining: ${formatCurrencyLocal(Number(ip.remaining_amount) || 0, currencyCode)}
   - Next Payment: ${ip.next_payment_date || 'N/A'}`).join('\n')}` : '';

  const insuranceInfo = bonzahPolicies.length > 0 ? `
Insurance Policies:
${bonzahPolicies.map((bp, i) => `${i + 1}. Policy #${bp.policy_number || 'N/A'}
   - Rental: #${bp.rental_number || 'N/A'}
   - Coverage: ${bp.coverage_type || 'N/A'}
   - Status: ${bp.status || 'N/A'}
   - Valid: ${bp.start_date || 'N/A'} to ${bp.end_date || 'N/A'}`).join('\n')}` : '';

  const verificationInfo = verification ? `
Identity Verification:
- Status: ${verification.status || 'N/A'}
- Type: ${verification.verification_type || 'N/A'}
- Verified: ${verification.verified_at ? 'Yes' : 'No'}` : '';

  return `You are Trax, a friendly and helpful AI assistant for ${tenantName} car rentals. You help customers understand their bookings, payments, agreements, and answer questions about their rentals.

Company name: ${tenantName}

When introducing yourself or asked "who are you", naturally mention that you're Trax, the AI assistant for ${tenantName}. Use the company name conversationally - for example: "Hi! I'm Trax, your AI assistant here at ${tenantName}. How can I help you today?"

${customerName ? `You're speaking with ${customerName}. Be friendly, warm, and personalized.` : ''}

${customerInfo}
${rentalsInfo}
${paymentsInfo}
${agreementsInfo}
${installmentsInfo}
${insuranceInfo}
${verificationInfo}

When users ask for data visualizations, breakdowns, or comparisons, you can include a chart in your response using this exact format (the system will parse and render it):

---CHART_DATA---
{"type":"bar","title":"Chart Title","data":[{"name":"Category 1","value":100},{"name":"Category 2","value":200}]}
---END_CHART---

Chart types available: "bar", "pie", "line"
Always include the chart AFTER your text explanation.

Guidelines:
- Be friendly, helpful, and conversational
- Use the customer's data above to answer questions accurately
- Format currency using the ${currencySymbol} symbol (${currencyCode})
- Use British date formats (DD/MM/YYYY)
- If you don't have specific information, say so politely
- For complex issues (disputes, refunds, changes), suggest contacting support via the Chat tab
- NEVER reveal information about other customers or business metrics
- NEVER make up information - only use the data provided above
- Keep responses concise but helpful
- If asked about something not in your data, politely explain you can only help with their account info

Common topics you can help with:
- Rental status and details
- Payment history and upcoming payments
- Installment plan details
- Agreement/contract status
- Insurance policy information
- Identity verification status
- General booking questions`;
}

// ============================================================================
// Main Handler
// ============================================================================
serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Missing Supabase configuration', 500);
    }

    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('Authorization required', 401);
    }

    // Create client with user's auth token to get user info
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: authHeader } },
    });

    // Get authenticated user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return errorResponse('Invalid authentication', 401);
    }

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get customer user from customer_users table
    const { data: customerUser, error: customerUserError } = await supabase
      .from('customer_users')
      .select(`
        id,
        customer_id,
        tenant_id,
        customer:customers (
          id,
          name,
          email,
          tenant_id
        )
      `)
      .eq('auth_user_id', user.id)
      .single();

    if (customerUserError || !customerUser) {
      console.error('Customer user lookup error:', customerUserError);
      return errorResponse('Customer account not found. Please ensure you are logged in as a customer.', 403);
    }

    const customerId = customerUser.customer_id;
    const tenantId = customerUser.tenant_id || (customerUser.customer as { tenant_id?: string })?.tenant_id;

    if (!tenantId) {
      return errorResponse('No tenant context found for customer', 403);
    }

    // Get tenant name and currency for personalized branding
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('company_name, currency_code')
      .eq('id', tenantId)
      .single();

    const tenantName = tenantData?.company_name || 'Drive247';
    const currencyCode = tenantData?.currency_code || 'GBP';

    // Parse request body
    let body: CustomerChatRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid request body', 400);
    }

    const { message } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return errorResponse('Message is required', 400);
    }

    // Get customer name for personalization
    const customerName = (customerUser.customer as { name?: string })?.name ||
      (customerUser.customer as { email?: string })?.email?.split('@')[0] ||
      'there';

    console.log(`Customer chat request from ${customerName}`);
    console.log(`Customer ID: ${customerId}`);
    console.log(`Tenant ID: ${tenantId}`);

    // Get customer-specific context - try RPC first, fallback to direct queries
    let context: Record<string, unknown> = {};

    const { data: rpcContext, error: contextError } = await supabase
      .rpc('get_customer_rag_context', {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
      });

    if (contextError) {
      console.error('RPC error, using direct queries:', contextError);

      // Fallback: Query data directly
      const { data: customerData } = await supabase
        .from('customers')
        .select('id, name, email, phone, identity_verification_status, status')
        .eq('id', customerId)
        .single();

      const { data: rentalsData } = await supabase
        .from('rentals')
        .select('id, rental_number, status, start_date, end_date, monthly_amount, payment_status, vehicle:vehicles(reg, make, model)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(5);

      const { data: paymentsData } = await supabase
        .from('payments')
        .select('id, amount, status, payment_method, payment_type, created_at, rental:rentals(rental_number)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(10);

      context = {
        customer: customerData,
        rentals: rentalsData?.map(r => ({
          ...r,
          vehicle_registration: r.vehicle?.reg,
          vehicle_make: r.vehicle?.make,
          vehicle_model: r.vehicle?.model,
        })) || [],
        payments: paymentsData?.map(p => ({
          ...p,
          rental_number: p.rental?.rental_number,
        })) || [],
        agreements: [],
        installments: [],
        bonzah_policies: [],
        verification: null,
      };

      console.log('Fallback context:', JSON.stringify(context, null, 2));
    } else {
      context = rpcContext || {};
      console.log('RPC context:', JSON.stringify(context, null, 2));
    }

    // Build messages array for chat completion
    const messages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt(customerName, context || {}, tenantName, currencyCode) },
      { role: 'user', content: message },
    ];

    // Get AI response
    const completion = await chatCompletion(messages, {
      temperature: 0.7,
      max_tokens: 1024,
    });

    const aiResponseContent = completion.choices[0]?.message?.content ||
      'I apologize, but I was unable to generate a response. Please try again or contact support.';

    // Parse chart data from response
    const { cleanContent, chart } = parseChartData(aiResponseContent);

    const responseData: { response: string; chart?: ChartData } = { response: cleanContent };
    if (chart) {
      responseData.chart = chart;
    }

    return jsonResponse(responseData);

  } catch (error) {
    console.error('Customer chat error:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});
