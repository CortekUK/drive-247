// Shared OpenAI client helper for RAG chatbot
// Provides functions for embeddings and chat completions
// Logs every call to public.openai_usage_logs for cost tracking

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// Embedding model - 1536 dimensions
const EMBEDDING_MODEL = 'text-embedding-ada-002';
// Chat model - gpt-4o for reliable function calling and quality responses
const CHAT_MODEL = 'gpt-4o';

// ─── Usage logging ─────────────────────────────────────────────────────────

// USD per 1M tokens
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'text-embedding-ada-002': { input: 0.10, output: 0 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  'whisper-1': { input: 0, output: 0 }, // priced per-minute, computed by caller
};

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] ?? PRICING['gpt-4o'];
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000;
}

export interface UsageContext {
  tenantId?: string | null;
  functionName: string;
  isFallback?: boolean;
  metadata?: Record<string, unknown>;
}

interface LogUsageParams {
  context: UsageContext;
  endpoint: 'chat/completions' | 'embeddings' | 'audio/transcriptions' | 'images/generations';
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  status: 'success' | 'error';
  durationMs: number;
  errorMessage?: string;
  costOverride?: number; // for whisper (per-minute pricing)
}

/**
 * Fire-and-forget: write a row to openai_usage_logs.
 * Never throws — logging failures must not break the AI call.
 */
async function logUsage(params: LogUsageParams): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return;

    const cost = params.costOverride ?? calculateCost(
      params.model,
      params.promptTokens,
      params.completionTokens,
    );

    await fetch(`${supabaseUrl}/rest/v1/openai_usage_logs`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        tenant_id: params.context.tenantId ?? null,
        function_name: params.context.functionName,
        endpoint: params.endpoint,
        model: params.model,
        prompt_tokens: params.promptTokens,
        completion_tokens: params.completionTokens,
        total_tokens: params.totalTokens,
        cost_usd: cost,
        status: params.status,
        is_fallback: params.context.isFallback ?? false,
        duration_ms: params.durationMs,
        error_message: params.errorMessage ?? null,
        metadata: params.context.metadata ?? null,
      }),
    });
  } catch (err) {
    console.error('[openai-usage-log] Failed to log usage:', err);
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionOptions {
  temperature?: number;
  max_tokens?: number;
  model?: string;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function validateApiKey(): void {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }
}

/**
 * Generate embedding for a single text.
 * Pass `context` to track usage; if omitted, the call is logged with function_name 'unknown'.
 */
export async function generateEmbedding(
  text: string,
  context?: UsageContext,
): Promise<number[]> {
  validateApiKey();
  const ctx = context ?? { functionName: 'unknown' };
  const startedAt = Date.now();

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logUsage({
        context: ctx,
        endpoint: 'embeddings',
        model: EMBEDDING_MODEL,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        status: 'error',
        durationMs: Date.now() - startedAt,
        errorMessage: `${response.status}: ${errorText.slice(0, 500)}`,
      });
      throw new Error(`OpenAI embedding error: ${response.status} - ${errorText}`);
    }

    const data: EmbeddingResponse = await response.json();
    logUsage({
      context: ctx,
      endpoint: 'embeddings',
      model: EMBEDDING_MODEL,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: 0,
      totalTokens: data.usage?.total_tokens ?? 0,
      status: 'success',
      durationMs: Date.now() - startedAt,
    });
    return data.data[0].embedding;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('OpenAI embedding error')) throw err;
    logUsage({
      context: ctx,
      endpoint: 'embeddings',
      model: EMBEDDING_MODEL,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'error',
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Generate embeddings for multiple texts in a batch.
 */
export async function generateEmbeddings(
  texts: string[],
  context?: UsageContext,
): Promise<number[][]> {
  validateApiKey();
  if (texts.length === 0) return [];
  const ctx = context ?? { functionName: 'unknown' };
  const startedAt = Date.now();

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logUsage({
        context: ctx,
        endpoint: 'embeddings',
        model: EMBEDDING_MODEL,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        status: 'error',
        durationMs: Date.now() - startedAt,
        errorMessage: `${response.status}: ${errorText.slice(0, 500)}`,
      });
      throw new Error(`OpenAI batch embedding error: ${response.status} - ${errorText}`);
    }

    const data: EmbeddingResponse = await response.json();
    logUsage({
      context: ctx,
      endpoint: 'embeddings',
      model: EMBEDDING_MODEL,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: 0,
      totalTokens: data.usage?.total_tokens ?? 0,
      status: 'success',
      durationMs: Date.now() - startedAt,
    });

    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('OpenAI batch embedding error')) throw err;
    logUsage({
      context: ctx,
      endpoint: 'embeddings',
      model: EMBEDDING_MODEL,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'error',
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Chat completion with usage logging.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
  context?: UsageContext,
): Promise<ChatCompletionResponse> {
  validateApiKey();
  const ctx = context ?? { functionName: 'unknown' };
  const startedAt = Date.now();

  const {
    temperature = 0.7,
    max_tokens = 2048,
    model = CHAT_MODEL,
    tools,
    tool_choice,
  } = options;

  const requestBody: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = tool_choice || 'auto';
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logUsage({
        context: ctx,
        endpoint: 'chat/completions',
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        status: 'error',
        durationMs: Date.now() - startedAt,
        errorMessage: `${response.status}: ${errorText.slice(0, 500)}`,
      });
      throw new Error(`OpenAI chat completion error: ${response.status} - ${errorText}`);
    }

    const data: ChatCompletionResponse = await response.json();
    logUsage({
      context: ctx,
      endpoint: 'chat/completions',
      model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
      status: 'success',
      durationMs: Date.now() - startedAt,
    });
    return data;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('OpenAI chat completion error')) throw err;
    logUsage({
      context: ctx,
      endpoint: 'chat/completions',
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'error',
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Manually log a Whisper / non-shared call (for callers that hit OpenAI directly).
 */
export async function logExternalUsage(params: LogUsageParams): Promise<void> {
  return logUsage(params);
}

/**
 * Helper to chunk an array into batches
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Generate embeddings for a large number of texts with batching.
 */
export async function generateEmbeddingsBatched(
  texts: string[],
  batchSize: number = 50,
  onProgress?: (completed: number, total: number) => void,
  context?: UsageContext,
): Promise<number[][]> {
  const batches = chunkArray(texts, batchSize);
  const allEmbeddings: number[][] = [];
  let completed = 0;

  for (const batch of batches) {
    const embeddings = await generateEmbeddings(batch, context);
    allEmbeddings.push(...embeddings);
    completed += batch.length;
    if (onProgress) onProgress(completed, texts.length);
  }

  return allEmbeddings;
}
