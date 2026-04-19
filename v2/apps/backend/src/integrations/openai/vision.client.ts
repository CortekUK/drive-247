import { Injectable, Logger } from '@nestjs/common';
import { getEnv } from '../../config/env.config';
import {
  OPENAI_API_URL,
  OPENAI_MAX_TOKENS_VISION_OCR,
  OPENAI_MODEL_VISION_OCR,
  OPENAI_TEMPERATURE_VISION_OCR,
} from './constants';

/**
 * Structured OCR result from OpenAI Vision. All fields nullable — the model
 * may not be able to read every field from every document. `confidence`
 * is a self-reported model score in [0, 1] (not a calibrated probability).
 *
 * Callers (ID-verification ProcessingService) enforce a minimum-confidence
 * threshold and mark the verification `review_required` when OCR confidence
 * is below the platform / tenant cutoff.
 */
export interface OcrResult {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null; // ISO date yyyy-mm-dd
  documentNumber: string | null;
  documentCountry: string | null; // ISO-2
  documentExpiryDate: string | null; // ISO date
  documentDetectedType: string | null; // 'driving_license' | 'passport' | 'id_card' | null
  confidence: number | null;
  raw: unknown;
}

/**
 * Thin OCR wrapper around OpenAI's chat/completions endpoint using
 * Vision-capable `gpt-4o`. The prompt is a strict JSON schema asking
 * for exactly the fields we need — downstream parses + validates.
 *
 * Fails CLOSED: returns `null` when OpenAI isn't configured or the call
 * fails. Caller treats `null` as "review_required" (unlike the eligibility
 * client which fails open).
 */
@Injectable()
export class VisionClient {
  private readonly logger = new Logger(VisionClient.name);

  isConfigured(): boolean {
    return Boolean(getEnv().OPENAI_API_KEY);
  }

  /**
   * Extract ID-document data from front (+ optional back) image URLs.
   * `imageUrls` must be publicly-readable URLs (signed S3 URLs in our case)
   * because OpenAI fetches them itself — we don't stream file bytes.
   */
  async extractDocumentData(input: {
    frontImageUrl: string;
    backImageUrl?: string | null;
    requiredDocumentType: string;
  }): Promise<OcrResult | null> {
    const apiKey = getEnv().OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY not configured — OCR unavailable, verification will be marked review_required',
      );
      return null;
    }

    const userContent: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = [
      {
        type: 'text',
        text: buildUserPrompt(input.requiredDocumentType, Boolean(input.backImageUrl)),
      },
      { type: 'image_url', image_url: { url: input.frontImageUrl } },
    ];
    if (input.backImageUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: input.backImageUrl },
      });
    }

    let bodyText: string;
    try {
      const res = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL_VISION_OCR,
          temperature: OPENAI_TEMPERATURE_VISION_OCR,
          max_tokens: OPENAI_MAX_TOKENS_VISION_OCR,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
        }),
      });
      if (!res.ok) {
        this.logger.warn(`OpenAI Vision returned HTTP ${res.status}`);
        return null;
      }
      bodyText = await res.text();
    } catch (err) {
      this.logger.warn(
        `OpenAI Vision call failed: ${(err as Error).message ?? 'unknown'}`,
      );
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      this.logger.warn('OpenAI Vision returned non-JSON body');
      return null;
    }

    const content = extractContent(parsed);
    if (!content) return null;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(content) as Record<string, unknown>;
    } catch {
      this.logger.warn('OpenAI Vision content was not valid JSON');
      return null;
    }

    return {
      firstName: str(data.first_name),
      lastName: str(data.last_name),
      dateOfBirth: isoDate(data.date_of_birth),
      documentNumber: str(data.document_number),
      documentCountry: str(data.document_country),
      documentExpiryDate: isoDate(data.document_expiry_date),
      documentDetectedType: str(data.document_type),
      confidence: clampConfidence(data.confidence),
      raw: data,
    };
  }
}

// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert ID-document OCR system. Extract structured data from government-issued ID photos (driving licences, passports, national ID cards).

Respond with a SINGLE JSON OBJECT exactly matching this schema:
{
  "first_name": string|null,
  "last_name": string|null,
  "date_of_birth": string|null,          // ISO date yyyy-mm-dd
  "document_number": string|null,
  "document_country": string|null,       // ISO 3166-1 alpha-2 country code
  "document_expiry_date": string|null,   // ISO date yyyy-mm-dd
  "document_type": "driving_license"|"passport"|"id_card"|null,
  "confidence": number                    // 0.0-1.0 overall read confidence
}

Rules:
- If a field is illegible, cropped, or missing, set it to null. Never guess.
- Convert all dates to yyyy-mm-dd, even if printed in mm/dd/yyyy or dd/mm/yyyy. If ambiguous, return null.
- "confidence" reflects your certainty about the extracted fields AS A WHOLE. If the image is blurry, damaged, or partially obscured, lower the score accordingly. 0.95+ = clean, well-lit capture. 0.6-0.8 = readable but imperfect. <0.6 = significant doubt about one or more fields.
- Output NOTHING except the JSON object. No markdown fences, no commentary.`;

function buildUserPrompt(
  requiredDocumentType: string,
  hasBack: boolean,
): string {
  const typeLabel =
    requiredDocumentType === 'driving_license'
      ? 'driving license'
      : requiredDocumentType === 'id_card'
        ? 'national ID card'
        : 'passport';
  return (
    `The customer is presenting a ${typeLabel}.` +
    (hasBack
      ? ' The first image is the front; the second image is the back.'
      : ' Only the front is available.') +
    ' Extract the fields per the schema.'
  );
}

function extractContent(body: unknown): string | null {
  const b = body as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return b.choices?.[0]?.message?.content?.trim() ?? null;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // Accept only yyyy-mm-dd
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function clampConfidence(v: unknown): number | null {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
