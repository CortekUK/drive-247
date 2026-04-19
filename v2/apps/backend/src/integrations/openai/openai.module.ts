import { Global, Module } from '@nestjs/common';
import { OpenAIClient } from './openai.client';
import { VisionClient } from './vision.client';

/**
 * Generic OpenAI integration. Consumers:
 *   - BonzahEligibilityService → OpenAIClient (chat/completions for
 *     vehicle-eligibility fuzzy matching; fails open)
 *   - IdVerificationProcessingService → VisionClient (document OCR via
 *     Vision; fails closed to `review_required`)
 *
 * Exposed as a global module so future features can inject either client
 * without wiring changes.
 */
@Global()
@Module({
  providers: [OpenAIClient, VisionClient],
  exports: [OpenAIClient, VisionClient],
})
export class OpenAIIntegrationModule {}
