// Shared OpenAI client helper for RAG chatbot
// Provides functions for embeddings and chat completions

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// Embedding model - 1536 dimensions
const EMBEDDING_MODEL = 'text-embedding-ada-002';
// Chat model - fast and cost-effective
const CHAT_MODEL = 'gpt-4o-mini';

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
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  max_tokens?: number;
  model?: string;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Validate that OpenAI API key is configured
 */
function validateApiKey(): void {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }
}

/**
 * Generate embedding for a single text
 * Returns a 1536-dimension vector using text-embedding-ada-002
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  validateApiKey();

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
    const error = await response.text();
    throw new Error(`OpenAI embedding error: ${response.status} - ${error}`);
  }

  const data: EmbeddingResponse = await response.json();
  return data.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a batch
 * More efficient than calling generateEmbedding multiple times
 * Recommended batch size: 50 texts at a time
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  validateApiKey();

  if (texts.length === 0) {
    return [];
  }

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
    const error = await response.text();
    throw new Error(`OpenAI batch embedding error: ${response.status} - ${error}`);
  }

  const data: EmbeddingResponse = await response.json();

  // Sort by index to ensure correct order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map(item => item.embedding);
}

/**
 * Generate chat completion using GPT-4o-mini (default) or GPT-4o
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResponse> {
  validateApiKey();

  const {
    temperature = 0.7,
    max_tokens = 2048,
    model = CHAT_MODEL,
  } = options;

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI chat completion error: ${response.status} - ${error}`);
  }

  return await response.json();
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
 * Generate embeddings for a large number of texts with batching
 * Processes in batches of 50 to avoid memory issues
 */
export async function generateEmbeddingsBatched(
  texts: string[],
  batchSize: number = 50,
  onProgress?: (completed: number, total: number) => void
): Promise<number[][]> {
  const batches = chunkArray(texts, batchSize);
  const allEmbeddings: number[][] = [];
  let completed = 0;

  for (const batch of batches) {
    const embeddings = await generateEmbeddings(batch);
    allEmbeddings.push(...embeddings);
    completed += batch.length;

    if (onProgress) {
      onProgress(completed, texts.length);
    }
  }

  return allEmbeddings;
}
