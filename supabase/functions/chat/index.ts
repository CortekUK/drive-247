// Chat Edge Function
// RAG-powered conversational AI for Drive247 portal
// Uses semantic search + GPT to answer questions about business data
// Supports AI actions (tool calling) for executing portal operations

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { generateEmbedding, chatCompletion, ChatMessage } from '../_shared/openai.ts';
import { corsHeaders, jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts';
import { formatCurrency, getCurrencySymbol } from '../_shared/format-utils.ts';
import { getToolsForRole, getAction } from './actions/registry.ts';
import type { ActionContext } from './actions/registry.ts';

const MAX_HISTORY_MESSAGES = 10;
const MATCH_THRESHOLD = 0.7;
const MATCH_COUNT = 8;

interface ChatRequestBody {
  // Regular chat message
  message?: string;
  conversationId?: string;
  userName?: string;
  tenantId?: string;
  // Action execution
  type?: 'execute_action';
  actionName?: string;
  resolvedParams?: Record<string, unknown>;
}

interface ChartData {
  type: 'bar' | 'pie' | 'line';
  title: string;
  data: Array<{ name: string; value: number }>;
}

interface ActionProposal {
  actionId: string;
  actionName: string;
  displayTitle: string;
  summary: string;
  details: Record<string, string>;
  destructive: boolean;
  resolvedParams: Record<string, unknown>;
}

interface ChatResponse {
  response: string;
  conversationId: string;
  sources: Array<{ table: string; id: string }>;
  chart?: ChartData;
  rentalRequests?: RentalRequestsData;
  action?: ActionProposal;
  actionResult?: { success: boolean; message: string; entityType?: string; entityId?: string };
}

// System prompt for the AI assistant
function getSystemPrompt(userName: string, metricsJson: string, currencyCode: string = 'GBP', hasActions: boolean = false, pendingRequests?: { extension_requests: any[]; cancellation_requests: any[] }): string {
  const sym = getCurrencySymbol(currencyCode);
  let prompt = `You are Trax AI, the intelligent assistant built into the Drive247 car rental management portal. You have three core capabilities:

1. **Navigate** — Tell users exactly where to find features and settings in the portal (specific sidebar items, settings tabs, sections)
2. **Educate** — Explain how features work with clear step-by-step guides and real examples
3. **Analyse** — Pull up real-time business data, metrics, and charts

When users ask "where" questions or "how to find" something, give precise navigation paths using bold text (e.g., **Settings** > **Bookings** tab > **Installment Payments** card).

When users ask "how does X work", "tell me about X", "explain X", or want to learn/understand something, you MUST:
1. Start with a simple 1-2 sentence explanation of what it is
2. **Always include a concrete, real-world example** using realistic numbers and scenarios. For example: "Say a customer rents a BMW 3 Series for £1,200/month. Instead of collecting £1,200 upfront, you split it into 3 installments: £400 on the 1st, £400 on the 10th, £400 on the 20th."
3. Then give step-by-step instructions with exact UI locations

The example is critical — it helps the user instantly understand the concept before reading the details. Always use realistic car rental scenarios with specific vehicle names, amounts, and dates.

You have access to knowledge articles about every feature in the portal. When a search result contains "[Knowledge Article]", prioritise that information — it is the most accurate source for feature explanations and navigation guidance. Use the article content directly but rephrase it naturally in your own words.

${userName ? `You're speaking with ${userName}. Use their name occasionally to feel personal — maybe once every 3-4 messages or when greeting, thanking, or wrapping up. Don't use it in every response.` : ''}

All data below is for the current tenant ONLY. Never reference, suggest, or imply data from other businesses or tenants.

## LIVE BUSINESS METRICS
The following JSON contains exact, real-time metrics from the database. These numbers are authoritative — use them directly. Do NOT invent, estimate, or round values.

\`\`\`json
${metricsJson}
\`\`\`

### Key fields explained:
- **Counts**: total_customers, active_customers, inactive_customers, gig_driver_customers, blocked_customers, total_vehicles, available_vehicles, rented_vehicles, maintenance_vehicles, disposed_vehicles, total_rentals, active_rentals, pending_rentals, closed_rentals, cancelled_rentals, completed_rentals, gig_driver_rentals, lockbox_rentals, pending_extension_requests, pending_cancellation_requests, total_payments_count, pending_payments_count, refunded_payments_count, total_fines, paid_fines, unpaid_fines, waived_fines, total_invoices, pending_invoices, total_expenses_count, total_reviews, skipped_reviews, total_agreements, total_leads, total_reminders, pending_reminders, total_staff
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

## PENDING CUSTOMER REQUESTS
Customers can request rental extensions and cancellations from the customer portal. These require admin review. The data below shows all pending requests that have NOT been acted on yet.

**Extension requests** (customer wants to extend their rental):
${pendingRequests && pendingRequests.extension_requests.length > 0
  ? '```json\n' + JSON.stringify(pendingRequests.extension_requests, null, 2) + '\n```\nNote: "requested_end_date" is the new end date the customer wants. "current_end_date" is their current end date.'
  : 'No pending extension requests.'}

**Cancellation requests** (customer wants to cancel their booking):
${pendingRequests && pendingRequests.cancellation_requests.length > 0
  ? '```json\n' + JSON.stringify(pendingRequests.cancellation_requests, null, 2) + '\n```'
  : 'No pending cancellation requests.'}

When users ask about pending requests, extensions, or cancellations, use this data and output it using the RENTAL_REQUESTS format below. If there are no pending requests, say so clearly in text.

## RENTAL REQUESTS DISPLAY
When showing extension or cancellation request data, output structured data using this format AFTER your text:

---RENTAL_REQUESTS---
{"type":"cancellations","title":"Pending Cancellation Requests","cancellations":[...array from above...]}
---END_RENTAL_REQUESTS---

Or for extensions:
---RENTAL_REQUESTS---
{"type":"extensions","title":"Pending Extension Requests","extensions":[...array from above...]}
---END_RENTAL_REQUESTS---

Or for both:
---RENTAL_REQUESTS---
{"type":"both","title":"Pending Customer Requests","extensions":[...],"cancellations":[...]}
---END_RENTAL_REQUESTS---

CRITICAL RULES for rental requests:
1. Copy the rental request objects EXACTLY from the data above. Do not modify, summarize, or omit any fields. Include ALL items.
2. Always output the structured block — do NOT list them as bullet points or numbered lists.
3. Your text response should ONLY be a brief summary sentence (e.g., "There are 2 pending cancellation requests."). Do NOT repeat the individual rental details in text — the structured block handles the display. Never list rental numbers, customer names, vehicles, dates, or reasons in the text itself.

Guidelines:
- Be concise and helpful
- Reference specific data when available
- If you don't have enough information, say so
- Format currency using the ${sym} symbol (${currencyCode})
- Use British English spelling and date formats (DD/MM/YYYY)
- When mentioning specific records, include relevant identifiers (rental numbers, registration plates, etc.)
- Use **markdown formatting** for all responses: bold for emphasis, numbered lists for steps, bullet points for options
- When explaining how to navigate to a feature, be specific: mention the exact sidebar item, tab name, and section`;

  if (hasActions) {
    prompt += `

## ACTIONS
You have access to tools that can perform real actions in the portal. ONLY use them when the user **explicitly and clearly** asks you to perform a specific action.

CRITICAL RULES — read carefully:
1. **NEVER call a tool for greetings, thank-yous, general chat, or vague messages.** "thank u", "hi", "ok", "cool", "what can you do?" → just respond normally with text. No tool calls.
2. **NEVER call a tool when the user is asking about something or wants to learn.** "how do I set a reminder?" → EXPLAIN the process. "what are reminders?" → EDUCATE.
3. **ONLY call a tool when the user gives a clear, specific instruction to DO something.** "remind me to collect £500 from John next Friday" → YES, use the tool. "set a reminder for MOT check on AB12 CDE" → YES.
4. If critical information is missing (like a date or who it's about), ASK the user first — do not guess or use today's date as a default.
5. For ambiguous references (e.g. "John" could match multiple customers), the system will ask for clarification automatically.
6. Today's date is ${new Date().toISOString().split('T')[0]}. Use this to calculate relative dates like "tomorrow", "next week", "in 3 days".`;
  }

  return prompt;
}

interface RentalRequestsData {
  type: 'extensions' | 'cancellations' | 'both';
  title: string;
  extensions?: any[];
  cancellations?: any[];
}

// Parse structured data blocks from AI response (charts and rental requests)
function parseResponseData(content: string): { cleanContent: string; chart?: ChartData; rentalRequests?: RentalRequestsData } {
  let cleanContent = content;
  let chart: ChartData | undefined;
  let rentalRequests: RentalRequestsData | undefined;

  // Parse chart data
  const chartMatch = cleanContent.match(/---CHART_DATA---\n?([\s\S]*?)\n?---END_CHART---/);
  if (chartMatch) {
    try {
      chart = JSON.parse(chartMatch[1].trim()) as ChartData;
      cleanContent = cleanContent.replace(/---CHART_DATA---[\s\S]*?---END_CHART---/, '').trim();
    } catch (e) {
      console.error('Failed to parse chart data:', e);
    }
  }

  // Parse rental requests data
  const rentalMatch = cleanContent.match(/---RENTAL_REQUESTS---\n?([\s\S]*?)\n?---END_RENTAL_REQUESTS---/);
  if (rentalMatch) {
    try {
      rentalRequests = JSON.parse(rentalMatch[1].trim()) as RentalRequestsData;
      cleanContent = cleanContent.replace(/---RENTAL_REQUESTS---[\s\S]*?---END_RENTAL_REQUESTS---/, '').trim();
    } catch (e) {
      console.error('Failed to parse rental requests data:', e);
    }
  }

  return { cleanContent, chart, rentalRequests };
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

    // Parse request body
    let body: ChatRequestBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid request body', 400);
    }

    // Get user's profile from app_users
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('id, tenant_id, name, email, role')
      .eq('auth_user_id', user.id)
      .single();

    if (appUserError) {
      console.error('Failed to fetch app_user:', appUserError.message);
    }
    console.log(`App user: ${appUser?.name}, role: ${appUser?.role}`);

    // Determine tenant ID
    const tenantId = body.tenantId || appUser?.tenant_id || null;

    if (!tenantId) {
      return errorResponse('No tenant context available.', 403);
    }

    // Verify tenant and get currency
    const { data: tenantData, error: tenantError } = await supabase
      .from('tenants')
      .select('id, currency_code')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenantData) {
      return errorResponse('Invalid tenant', 403);
    }

    const currencyCode = tenantData.currency_code || 'GBP';
    const userRole = appUser?.role || 'viewer';

    // Build action context (used for both chat and execute_action)
    const actionCtx: ActionContext = {
      supabase,
      tenantId,
      userId: user.id,
      appUser: {
        id: appUser?.id || user.id,
        role: userRole,
        name: appUser?.name || appUser?.full_name || null,
        email: appUser?.email || user.email || '',
      },
      currencyCode,
    };

    // ─── ROUTE: Execute an action ────────────────────────────────
    if (body.type === 'execute_action') {
      return await handleActionExecution(body, actionCtx);
    }

    // ─── ROUTE: Regular chat message ─────────────────────────────
    return await handleChatMessage(body, user, appUser, actionCtx);

  } catch (error) {
    console.error('Chat error:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});

// ── Handle action execution ────────────────────────────────────────
async function handleActionExecution(
  body: ChatRequestBody,
  ctx: ActionContext,
): Promise<Response> {
  const { actionName, resolvedParams, conversationId } = body;

  if (!actionName || !resolvedParams) {
    return errorResponse('Missing actionName or resolvedParams', 400);
  }

  const action = getAction(actionName);
  if (!action) {
    return errorResponse(`Unknown action: ${actionName}`, 400);
  }

  // Re-check RBAC
  if (!action.minRoles.includes(ctx.appUser.role)) {
    return errorResponse('You do not have permission to perform this action.', 403);
  }

  console.log(`Executing action: ${actionName} by ${ctx.appUser.email} in tenant ${ctx.tenantId}`);

  const result = await action.execute(resolvedParams, ctx);

  console.log(`Action result: ${result.success ? 'success' : 'failed'} — ${result.message}`);

  const response: ChatResponse = {
    response: result.success
      ? `Done! ${result.message}`
      : `Sorry, that didn't work. ${result.message}`,
    conversationId: conversationId || crypto.randomUUID(),
    sources: [],
    actionResult: result,
  };

  return jsonResponse(response);
}

// ── Handle regular chat message ────────────────────────────────────
async function handleChatMessage(
  body: ChatRequestBody,
  user: { id: string; email?: string },
  appUser: { id?: string; tenant_id?: string; name?: string; email?: string; role?: string } | null,
  ctx: ActionContext,
): Promise<Response> {
  const { message, conversationId: existingConversationId } = body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return errorResponse('Message is required', 400);
  }

  const conversationId = existingConversationId || crypto.randomUUID();

  // Get user's name for personalization
  const userName = body.userName ||
    appUser?.name ||
    (appUser?.email ? appUser.email.split('@')[0] : null) ||
    (user.email ? user.email.split('@')[0] : null) ||
    'there';

  console.log(`Chat request from ${userName} (${user.id}) in tenant ${ctx.tenantId}`);

  // Step 1: Generate embedding for the user's query
  const queryEmbedding = await generateEmbedding(message);

  // Step 2: Semantic search for relevant documents
  const { data: matchedDocs, error: matchError } = await ctx.supabase
    .rpc('match_documents', {
      p_tenant_id: ctx.tenantId,
      query_embedding: queryEmbedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      filter_tables: null,
    });

  if (matchError) {
    console.error('Match documents error:', matchError);
  }

  // Step 3: Get business metrics for context
  const [metricsResult, requestsResult] = await Promise.all([
    ctx.supabase.rpc('get_rag_metrics', { p_tenant_id: ctx.tenantId }),
    ctx.supabase.rpc('get_pending_rental_requests', { p_tenant_id: ctx.tenantId }),
  ]);

  if (metricsResult.error) {
    console.error('Get metrics error:', metricsResult.error);
  }
  if (requestsResult.error) {
    console.error('Get pending requests error:', requestsResult.error);
  }

  const metricsJson = JSON.stringify(metricsResult.data || {}, null, 2);
  const pendingRequests = requestsResult.data || { extension_requests: [], cancellation_requests: [] };

  // Step 4: Get conversation history
  const { data: history, error: historyError } = await ctx.supabase
    .rpc('get_chat_history', {
      p_tenant_id: ctx.tenantId,
      p_conversation_id: conversationId,
      p_limit: MAX_HISTORY_MESSAGES,
    });

  if (historyError) {
    console.error('Get history error:', historyError);
  }

  // Step 5: Get available tools based on user role
  const tools = getToolsForRole(ctx.appUser.role);
  const hasActions = tools.length > 0;

  console.log(`User role: ${ctx.appUser.role}, available tools: ${tools.length}`);

  // Step 6: Build messages array for chat completion
  const messages: ChatMessage[] = [];

  messages.push({
    role: 'system',
    content: getSystemPrompt(userName, metricsJson, ctx.currencyCode, hasActions, pendingRequests),
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

  // Add conversation history
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

  // Step 7: Get AI response (with tools if available)
  const completion = await chatCompletion(messages, {
    temperature: 0.3,
    max_tokens: 2048,
    tools: hasActions ? tools : undefined,
  });

  const choice = completion.choices[0];
  const toolCalls = choice?.message?.tool_calls;

  // ── Handle tool call (action proposal) ──────────────────────────
  if (toolCalls && toolCalls.length > 0) {
    const toolCall = toolCalls[0]; // Handle first tool call
    const actionName = toolCall.function.name;
    let actionParams: Record<string, unknown>;

    try {
      actionParams = JSON.parse(toolCall.function.arguments);
    } catch {
      console.error('Failed to parse tool call arguments:', toolCall.function.arguments);
      return jsonResponse({
        response: "I tried to perform an action but couldn't parse the parameters. Could you rephrase your request?",
        conversationId,
        sources: [],
      });
    }

    console.log(`AI proposed action: ${actionName}`, actionParams);

    const action = getAction(actionName);
    if (!action) {
      return jsonResponse({
        response: `I tried to use an action called "${actionName}" but it doesn't exist. Let me help you another way.`,
        conversationId,
        sources: [],
      });
    }

    // Resolve: look up entities, validate params, build confirmation
    const resolveResult = await action.resolve(actionParams, ctx);

    // If resolve returns a string, it's a clarification question
    if (typeof resolveResult === 'string') {
      // Save the clarification as a normal chat message
      await saveChatMessages(ctx.supabase, ctx.tenantId, user.id, conversationId, message, resolveResult, matchedDocs);

      return jsonResponse({
        response: resolveResult,
        conversationId,
        sources: [],
      });
    }

    // We have a proposal — return it with the AI's conversational text
    const aiText = choice?.message?.content || `I'll set that up for you. Please confirm below:`;

    // Save chat messages (the proposal text)
    await saveChatMessages(ctx.supabase, ctx.tenantId, user.id, conversationId, message, aiText, matchedDocs);

    const response: ChatResponse = {
      response: aiText,
      conversationId,
      sources: matchedDocs?.map((doc: { source_table: string; source_id: string }) => ({
        table: doc.source_table,
        id: doc.source_id,
      })) || [],
      action: resolveResult,
    };

    return jsonResponse(response);
  }

  // ── Handle normal text response ─────────────────────────────────
  const aiResponseContent = choice?.message?.content || 'I apologize, but I was unable to generate a response.';

  // Parse structured data from response (charts, rental requests)
  const { cleanContent, chart, rentalRequests } = parseResponseData(aiResponseContent);

  // Save messages to database
  await saveChatMessages(ctx.supabase, ctx.tenantId, user.id, conversationId, message, cleanContent, matchedDocs, chart);

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

  if (rentalRequests) {
    response.rentalRequests = rentalRequests;
  }

  return jsonResponse(response);
}

// ── Save chat messages helper ──────────────────────────────────────
async function saveChatMessages(
  supabase: any,
  tenantId: string,
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
  matchedDocs?: any[] | null,
  chart?: ChartData | null,
) {
  const messagesToSave = [
    {
      tenant_id: tenantId,
      user_id: userId,
      conversation_id: conversationId,
      role: 'user',
      content: userMessage,
      sources: [],
    },
    {
      tenant_id: tenantId,
      user_id: userId,
      conversation_id: conversationId,
      role: 'assistant',
      content: assistantMessage,
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
}
