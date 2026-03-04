// Chat Edge Function
// RAG-powered conversational AI for Drive247 portal
// Uses semantic search + GPT to answer questions about business data

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { generateEmbedding, chatCompletion, ChatMessage } from '../_shared/openai.ts';
import { corsHeaders, jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts';
import { formatCurrency, getCurrencySymbol } from '../_shared/format-utils.ts';

const MAX_HISTORY_MESSAGES = 10;
const MATCH_THRESHOLD = 0.7;
const MATCH_COUNT = 8;

interface ChatRequest {
  message: string;
  conversationId?: string;
  userName?: string;
  tenantId?: string; // Can be passed explicitly (e.g., for super admins)
}

interface ChartData {
  type: 'bar' | 'pie' | 'line';
  title: string;
  data: Array<{ name: string; value: number }>;
}

interface ChatResponse {
  response: string;
  conversationId: string;
  sources: Array<{ table: string; id: string }>;
  chart?: ChartData;
}

// System prompt for the AI assistant
function getSystemPrompt(userName: string, metricsJson: string, currencyCode: string = 'GBP'): string {
  const sym = getCurrencySymbol(currencyCode);
  return `You are Trax AI, a helpful AI assistant for the Drive247 car rental management portal. You help users understand their business data and answer questions about customers, vehicles, rentals, payments, fines, invoices, expenses, P&L, reviews, leads, reminders, staff, and more.

${userName ? `You're speaking with ${userName}. Be friendly and personalized.` : ''}

All data below is for the current tenant ONLY. Never reference, suggest, or imply data from other businesses or tenants.

## LIVE BUSINESS METRICS
The following JSON contains exact, real-time metrics from the database. These numbers are authoritative — use them directly. Do NOT invent, estimate, or round values.

\`\`\`json
${metricsJson}
\`\`\`

### Key fields explained:
- **Counts**: total_customers, active_customers, inactive_customers, gig_driver_customers, blocked_customers, total_vehicles, available_vehicles, rented_vehicles, maintenance_vehicles, disposed_vehicles, total_rentals, active_rentals, pending_rentals, closed_rentals, cancelled_rentals, completed_rentals, gig_driver_rentals, lockbox_rentals, total_payments_count, pending_payments_count, refunded_payments_count, total_fines, paid_fines, unpaid_fines, waived_fines, total_invoices, pending_invoices, total_expenses_count, total_reviews, skipped_reviews, total_agreements, total_leads, total_reminders, pending_reminders, total_staff
- **Amounts** (in ${currencyCode}): total_fleet_value, total_payments_amount, pending_payments, completed_payments_amount, refunded_payments_amount, total_fine_amount, unpaid_fine_amount, total_invoiced_amount, pending_invoiced_amount, total_revenue, total_collected, total_refunds, outstanding_balance, total_expenses_amount, average_review_rating
- **Breakdown arrays** (pre-built chart data — use directly as the "data" array in charts): vehicles_by_make, rentals_by_status, payments_by_status, fines_by_status, revenue_by_category, expenses_by_category, leads_by_status, staff_by_role

You have access to search results from the database that will be provided as context. Use this data to answer questions accurately.

## CHARTS
When users ask for a chart, graph, visualization, or breakdown, include a chart in your response using this exact format:

---CHART_DATA---
{"type":"bar","title":"Chart Title","data":[{"name":"Label","value":123}]}
---END_CHART---

Chart types: "bar", "pie", "line". Always include the chart AFTER your text explanation.

CRITICAL CHART RULES:
1. Copy values DIRECTLY from the metrics JSON above. For breakdown arrays (vehicles_by_make, rentals_by_status, etc.), use them directly as the "data" field — they are already in {"name","value"} format.
2. Before outputting chart JSON, verify EVERY value matches the metrics exactly.
3. If a metric is 0, use 0. Do not skip it or substitute another number.
4. If you cannot find the exact value, say so in text — do NOT guess.

Guidelines:
- Be concise and helpful
- Reference specific data when available
- If you don't have enough information, say so
- Format currency using the ${sym} symbol (${currencyCode})
- Use British English spelling and date formats (DD/MM/YYYY)
- When mentioning specific records, include relevant identifiers (rental numbers, registration plates, etc.)`;
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

    // Parse request body first to check if tenantId is provided
    let body: ChatRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid request body', 400);
    }

    const { message, conversationId: existingConversationId, tenantId: requestTenantId } = body;

    // Get user's profile from app_users
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('tenant_id, full_name, email, role')
      .eq('id', user.id)
      .single();

    // Determine tenant ID: use request body tenantId if provided, otherwise use user's tenant
    let tenantId: string | null = null;

    if (requestTenantId) {
      // tenantId provided in request (e.g., from super admin via tenant context)
      tenantId = requestTenantId;
      console.log(`Using tenantId from request: ${tenantId}`);
    } else if (appUser?.tenant_id) {
      // Use user's own tenant
      tenantId = appUser.tenant_id;
      console.log(`Using user's tenantId: ${tenantId}`);
    }

    if (!tenantId) {
      return errorResponse('No tenant context available. Please select a tenant or ensure you are associated with one.', 403);
    }

    // Verify the tenant exists and get currency code
    const { data: tenantExists, error: tenantError } = await supabase
      .from('tenants')
      .select('id, currency_code')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenantExists) {
      return errorResponse('Invalid tenant', 403);
    }

    const tenantCurrencyCode = tenantExists.currency_code || 'GBP';

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return errorResponse('Message is required', 400);
    }

    // Get or create conversation ID
    const conversationId = existingConversationId || crypto.randomUUID();

    // Get user's name for personalization
    const userName = body.userName ||
      appUser?.full_name ||
      (appUser?.email ? appUser.email.split('@')[0] : null) ||
      (user.email ? user.email.split('@')[0] : null) ||
      'there';

    console.log(`Chat request from ${userName} (${user.id}) in tenant ${tenantId}`);
    console.log(`Message: ${message.substring(0, 100)}...`);

    // Step 1: Generate embedding for the user's query
    const queryEmbedding = await generateEmbedding(message);

    // Step 2: Semantic search for relevant documents
    const { data: matchedDocs, error: matchError } = await supabase
      .rpc('match_documents', {
        p_tenant_id: tenantId,
        query_embedding: queryEmbedding,
        match_threshold: MATCH_THRESHOLD,
        match_count: MATCH_COUNT,
        filter_tables: null,
      });

    if (matchError) {
      console.error('Match documents error:', matchError);
    }

    console.log(`Found ${matchedDocs?.length || 0} relevant documents`);

    // Step 3: Get business metrics for context
    const { data: metrics, error: metricsError } = await supabase
      .rpc('get_rag_metrics', { p_tenant_id: tenantId });

    if (metricsError) {
      console.error('Get metrics error:', metricsError);
    }

    // Log the raw metrics so we can debug data issues
    console.log(`Raw metrics for tenant ${tenantId}:`, JSON.stringify(metrics));

    // Serialize metrics as a clean JSON string for the system prompt
    const metricsJson = JSON.stringify(metrics || {}, null, 2);

    // Step 4: Get conversation history
    const { data: history, error: historyError } = await supabase
      .rpc('get_chat_history', {
        p_tenant_id: tenantId,
        p_conversation_id: conversationId,
        p_limit: MAX_HISTORY_MESSAGES,
      });

    if (historyError) {
      console.error('Get history error:', historyError);
    }

    // Step 5: Build messages array for chat completion
    const messages: ChatMessage[] = [];

    // System prompt with context
    messages.push({
      role: 'system',
      content: getSystemPrompt(userName, metricsJson, tenantCurrencyCode),
    });

    // Add relevant context from semantic search
    if (matchedDocs && matchedDocs.length > 0) {
      const contextContent = matchedDocs
        .map((doc: { content: string; source_table: string; source_id: string; similarity: number }) =>
          `[${doc.source_table}] ${doc.content}`
        )
        .join('\n\n');

      messages.push({
        role: 'system',
        content: `Relevant data from your database:\n\n${contextContent}`,
      });
    }

    // Add conversation history (reverse order since we got most recent first)
    if (history && history.length > 0) {
      const reversedHistory = [...history].reverse();
      for (const msg of reversedHistory) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message,
    });

    // Step 6: Get AI response
    const completion = await chatCompletion(messages, {
      temperature: 0.3,
      max_tokens: 2048,
    });

    const aiResponseContent = completion.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response.';

    // Parse chart data from response
    const { cleanContent, chart } = parseChartData(aiResponseContent);

    // Step 7: Save messages to database
    const messagesToSave = [
      {
        tenant_id: tenantId,
        user_id: user.id,
        conversation_id: conversationId,
        role: 'user',
        content: message,
        sources: [],
      },
      {
        tenant_id: tenantId,
        user_id: user.id,
        conversation_id: conversationId,
        role: 'assistant',
        content: cleanContent,
        sources: matchedDocs?.map((doc: { source_table: string; source_id: string }) => ({
          table: doc.source_table,
          id: doc.source_id,
        })) || [],
        chart_data: chart || null,
      },
    ];

    const { error: saveError } = await supabase
      .from('chat_messages')
      .insert(messagesToSave);

    if (saveError) {
      console.error('Failed to save messages:', saveError);
    }

    // Step 8: Return response
    const response: ChatResponse = {
      response: cleanContent,
      conversationId,
      sources: matchedDocs?.map((doc: { source_table: string; source_id: string }) => ({
        table: doc.source_table,
        id: doc.source_id,
      })) || [],
    };

    if (chart) {
      response.chart = chart;
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('Chat error:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});
