/**
 * OpenAI integration constants — backend-only.
 */

export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Model choice for eligibility checks — cheap + fast, deterministic enough for
// fuzzy brand/model matching. Upgrade with care (pricing + latency tradeoff).
export const OPENAI_MODEL_ELIGIBILITY = 'gpt-4o-mini';

// Temperature 0 → deterministic output (same input → same result).
// Important because the eligibility check is a gate, not a creative task.
export const OPENAI_TEMPERATURE_DETERMINISTIC = 0;

// Safety ceiling so a malformed response can't blow up our context/budget.
export const OPENAI_MAX_TOKENS_ELIGIBILITY = 100;

// ID-verification document OCR — reads front/back of license/passport/ID.
// gpt-4o is used (not -mini) because document OCR benefits materially from
// the larger model's vision quality.
export const OPENAI_MODEL_VISION_OCR = 'gpt-4o';

// OCR must be deterministic (same photo → same extracted data). Temperature 0.
export const OPENAI_TEMPERATURE_VISION_OCR = 0;

// OCR prompts produce structured JSON ~200 tokens. Give a generous ceiling.
export const OPENAI_MAX_TOKENS_VISION_OCR = 600;
