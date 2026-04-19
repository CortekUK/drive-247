import { Module } from '@nestjs/common';
import { RemindersModule } from '../reminders/reminders.module';
import { IdVerificationBlocksController } from './id-verification-blocks.controller';
import { IdVerificationBlocksService } from './id-verification-blocks.service';
import { IdVerificationCaptureService } from './id-verification-capture.service';
import { IdVerificationController } from './id-verification.controller';
import { IdVerificationEventsService } from './id-verification-events.service';
import { IdVerificationProcessingService } from './id-verification-processing.service';
import { IdVerificationPublicController } from './id-verification-public.controller';
import { IdVerificationReviewService } from './id-verification-review.service';
import { IdVerificationService } from './id-verification.service';
import { IdVerificationSessionService } from './id-verification-session.service';
import { IdVerificationSettingsController } from './id-verification-settings.controller';
import { IdVerificationSettingsService } from './id-verification-settings.service';
import { QrTokenAuthGuard } from './qr-token-auth.guard';

/**
 * ID Verification feature module.
 *
 * Depends on:
 *   - AwsIntegrationModule (global) — S3 + Rekognition clients
 *   - StorageModule (global) — tenant-prefixed object storage
 *   - OpenAIIntegrationModule (global) — document OCR via VisionClient
 *   - RemindersModule — emits ID_VERIFICATION_REVIEW_REQUIRED reminders
 */
@Module({
  imports: [RemindersModule],
  controllers: [
    // Register specific sub-paths BEFORE the generic :id controller so Nest's
    // routing (Express under the hood) matches /settings and /blocks before
    // they collide with /:id (ParseUUIDPipe would otherwise reject them).
    IdVerificationSettingsController,
    IdVerificationBlocksController,
    IdVerificationPublicController,
    IdVerificationController,
  ],
  providers: [
    IdVerificationService,
    IdVerificationBlocksService,
    IdVerificationCaptureService,
    IdVerificationEventsService,
    IdVerificationProcessingService,
    IdVerificationReviewService,
    IdVerificationSessionService,
    IdVerificationSettingsService,
    QrTokenAuthGuard,
  ],
  exports: [],
})
export class IdVerificationModule {}
