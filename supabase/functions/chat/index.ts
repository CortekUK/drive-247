// Chat Edge Function
// RAG-powered conversational AI for Drive247 portal
// Uses semantic search + GPT to answer questions about business data

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { generateEmbedding, chatCompletion, ChatMessage } from '../_shared/openai.ts';
import { corsHeaders, jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts';

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
function getSystemPrompt(userName: string, metrics: Record<string, unknown>): string {
  return `You are Drive247 Assistant, a helpful AI assistant for the Drive247 car rental management portal. You help users understand their business data and answer questions about customers, vehicles, rentals, payments, and fines.

${userName ? `You're speaking with ${userName}. Be friendly and personalized.` : ''}

Current Business Metrics:
- Total Customers: ${metrics.total_customers || 0} (${metrics.active_customers || 0} active)
- Total Vehicles: ${metrics.total_vehicles || 0} (${metrics.available_vehicles || 0} available)
- Active Rentals: ${metrics.active_rentals || 0} of ${metrics.total_rentals || 0} total
- Pending Payments: £${metrics.pending_payments || 0}
- Fines: ${metrics.total_fines || 0} total (${metrics.unpaid_fines || 0} unpaid)

You have access to search results from the database that will be provided as context. Use this data to answer questions accurately.

When users ask for data visualizations or breakdowns, you can include a chart in your response using this exact format (the system will parse and render it):

---CHART_DATA---
{"type":"bar","title":"Chart Title","data":[{"name":"Category 1","value":100},{"name":"Category 2","value":200}]}
---END_CHART---

Chart types available: "bar", "pie", "line"
Always include the chart AFTER your text explanation.

Guidelines:
- Be concise and helpful
- Reference specific data when available
- If you don't have enough information, say so
- Format currency as £X,XXX
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

    // Verify the tenant exists
    const { data: tenantExists, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenantExists) {
      return errorResponse('Invalid tenant', 403);
    }

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
      content: getSystemPrompt(userName, metrics || {}),
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
      temperature: 0.7,
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
