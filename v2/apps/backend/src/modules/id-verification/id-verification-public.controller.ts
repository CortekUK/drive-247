import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { idVerifications, tenants } from '@drive247/database';
import {
  DOCUMENT_TYPES_WITH_BACK,
  ID_VERIFICATION_EVENT_TYPES,
  ID_VERIFICATION_MAX_FILE_SIZE_BYTES,
  IdVerificationStatus,
  RequiredDocumentType,
  type PublicSessionResponse,
  type SubmitCaptureResponse,
  type UploadFileResponse,
} from '@drive247/shared-types';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Inject } from '@nestjs/common';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { QrTokenAuthGuard } from './qr-token-auth.guard';
import {
  QrCanMutate,
  QrVerification,
} from './qr-verification.decorator';
import { IdVerificationCaptureService } from './id-verification-capture.service';
import { IdVerificationEventsService } from './id-verification-events.service';
import { IdVerificationProcessingService } from './id-verification-processing.service';
import { syncStepSchema, type SyncStepDto } from './dto/sync-step.dto';
import {
  uploadFileBodySchema,
  type UploadFileBodyDto,
} from './dto/upload-file.dto';

type VerificationRow = typeof idVerifications.$inferSelect;

/**
 * Public (customer-facing) controller — served from the same backend, but
 * bypasses JWT / tenant guards via `@Public()`. Authentication is enforced
 * by `QrTokenAuthGuard` which validates the token in the path and attaches
 * the verification row to the request.
 *
 * Tenant context is derived from the verification row itself (no
 * TenantContextService) so this controller works without a logged-in user.
 */
@Controller('public/id-verification/sessions')
@Public()
@UseGuards(QrTokenAuthGuard)
export class IdVerificationPublicController {
  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly captureService: IdVerificationCaptureService,
    private readonly events: IdVerificationEventsService,
    private readonly processing: IdVerificationProcessingService,
  ) {}

  // ------------------------------------------------------------------
  // GET /public/id-verification/sessions/:token
  // ------------------------------------------------------------------

  @Get(':token')
  async getSession(
    @QrVerification() verification: VerificationRow,
  ): Promise<{ success: true; data: PublicSessionResponse }> {
    const [tenant] = await this.db
      .select({
        name: tenants.companyName,
      })
      .from(tenants)
      .where(eq(tenants.id, verification.tenantId))
      .limit(1);

    // First valid GET emits token_validated event (only once — if the row
    // already moved past initiated, we don't re-emit)
    if (verification.status === IdVerificationStatus.INITIATED) {
      await this.events.append({
        tenantId: verification.tenantId,
        verificationId: verification.id,
        eventType: ID_VERIFICATION_EVENT_TYPES.SESSION_TOKEN_VALIDATED,
        actorType: 'customer',
        metadata: {},
      });
    }

    return {
      success: true,
      data: {
        verificationId: verification.id,
        tenantName: tenant?.name ?? '',
        tenantLogoUrl: null, // wiring to tenant logo URL deferred to portal
        requiredDocumentType:
          verification.requiredDocumentType as RequiredDocumentType,
        currentStep:
          (verification.currentStep as PublicSessionResponse['currentStep']) ??
          null,
        status: verification.status as IdVerificationStatus,
        documentRequiresBack: DOCUMENT_TYPES_WITH_BACK.includes(
          verification.requiredDocumentType,
        ),
        sessionExpiresAt: verification.sessionExpiresAt.toISOString(),
      },
    };
  }

  // ------------------------------------------------------------------
  // POST /public/id-verification/sessions/:token/files
  // multipart/form-data, field: field=..., file=image
  // ------------------------------------------------------------------

  @Post(':token/files')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ID_VERIFICATION_MAX_FILE_SIZE_BYTES },
    }),
  )
  @HttpCode(HttpStatus.OK)
  async uploadFile(
    @QrVerification() verification: VerificationRow,
    @QrCanMutate() canMutate: boolean,
    @Body(new ZodValidationPipe(uploadFileBodySchema)) body: UploadFileBodyDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ success: true; data: UploadFileResponse }> {
    if (!canMutate) {
      throw new ConflictException(
        'This session has already been submitted for processing',
      );
    }

    const result = await this.captureService.uploadFile(verification, body.field, file);
    return { success: true, data: result };
  }

  // ------------------------------------------------------------------
  // POST /public/id-verification/sessions/:token/step
  // ------------------------------------------------------------------

  @Post(':token/step')
  @HttpCode(HttpStatus.OK)
  async syncStep(
    @QrVerification() verification: VerificationRow,
    @QrCanMutate() canMutate: boolean,
    @Body(new ZodValidationPipe(syncStepSchema)) body: SyncStepDto,
  ): Promise<{ success: true }> {
    if (!canMutate) return { success: true };
    await this.captureService.syncStep(verification, body.step);
    return { success: true };
  }

  // ------------------------------------------------------------------
  // POST /public/id-verification/sessions/:token/submit
  // ------------------------------------------------------------------

  @Post(':token/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @QrVerification() verification: VerificationRow,
    @QrCanMutate() canMutate: boolean,
  ): Promise<{ success: true; data: SubmitCaptureResponse }> {
    if (!canMutate) {
      throw new ConflictException('Already submitted');
    }

    // Validate all required files are uploaded
    if (!verification.documentFrontS3Key) {
      throw new ConflictException('Document front has not been uploaded');
    }
    if (
      DOCUMENT_TYPES_WITH_BACK.includes(verification.requiredDocumentType) &&
      !verification.documentBackS3Key
    ) {
      throw new ConflictException('Document back has not been uploaded');
    }
    if (!verification.selfieS3Key) {
      throw new ConflictException('Selfie has not been uploaded');
    }

    // Transition to processing + emit event. Actual OCR/face-match runs
    // separately — wired up in Step 9.
    await this.db
      .update(idVerifications)
      .set({
        status: IdVerificationStatus.PROCESSING,
        currentStep: 'processing',
        updatedAt: new Date(),
      })
      .where(eq(idVerifications.id, verification.id));

    await this.events.append({
      tenantId: verification.tenantId,
      verificationId: verification.id,
      eventType: ID_VERIFICATION_EVENT_TYPES.CAPTURE_SUBMITTED,
      actorType: 'customer',
      metadata: {},
    });

    // Fire-and-forget: ProcessingService catches its own errors and
    // persists them to the row. We return 202 immediately so the mobile
    // page can start polling for the result.
    void this.processing.process(verification.id);

    return {
      success: true,
      data: { status: IdVerificationStatus.PROCESSING },
    };
  }
}
