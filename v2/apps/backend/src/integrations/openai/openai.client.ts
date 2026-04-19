import { Injectable, Logger } from '@nestjs/common';
import { getEnv } from '../../config/env.config';
import { OPENAI_API_URL } from './constants';

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Thin, typed wrapper around OpenAI's Chat Completions API.
 *
 * Returns `null` when:
 *   - `OPENAI_API_KEY` is not configured (fail-open callers stay functional)
 *   - The API call fails (5xx, timeout, rate limit)
 *
 * Callers decide how to handle `null` — for eligibility checks we fail open
 * (treat vehicle as eligible) because the integration is a backstop, not the
 * primary gate.
 */
@Injectable()
export class OpenAIClient {
  private readonly logger = new Logger(OpenAIClient.name);

  /**
   * Is an API key configured? Useful for callers to skip the network call
   * when they already know it won't work.
   */
  isConfigured(): boolean {
    return Boolean(getEnv().OPENAI_API_KEY);
  }

  async chat(request: OpenAIChatRequest): Promise<string | null> {
    const apiKey = getEnv().OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.debug('OPENAI_API_KEY not configured — skipping call');
      return null;
    }

    try {
      const res = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0,
          max_tokens: request.maxTokens,
        }),
      });

      if (!res.ok) {
        this.logger.warn(`OpenAI returned HTTP ${res.status}`);
        return null;
      }

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content?.trim();
      return content ?? null;
    } catch (err) {
      this.logger.warn(
        `OpenAI call failed: ${(err as Error).message ?? 'unknown error'}`,
      );
      return null;
    }
  }
}
