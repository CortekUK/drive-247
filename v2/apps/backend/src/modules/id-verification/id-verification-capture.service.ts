import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { idVerifications } from '@drive247/database';
import {
  AwsError,
  AwsNotConfiguredError,
} from '../../integrations/aws/errors';
import {
  DOCUMENT_TYPES_WITH_BACK,
  ID_VERIFICATION_ACCEPTED_MIME_TYPES,
  ID_VERIFICATION_EVENT_TYPES,
  ID_VERIFICATION_MAX_FILE_SIZE_BYTES,
  IdVerificationStatus,
  type IdVerificationAcceptedMimeType,
  type IdVerificationCaptureStep,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { StorageService } from '../../common/storage/storage.service';
import { IdVerificationEventsService } from './id-verification-events.service';
import type { UploadFileField } from './dto/upload-file.dto';

type VerificationRow = typeof idVerifications.$inferSelect;

/**
 * Handles customer-side mobile capture: file uploads + step syncing.
 *
 * All methods accept the verification row (delivered by QrTokenAuthGuard)
 * rather than an id — that row already proves ownership / validity.
 *
 * File validation happens here (not in the controller) because we want
 * size + mime checks to be consistent regardless of transport. File upload
 * goes through StorageService which enforces tenant-prefixed keys.
 *
 * Rules enforced:
 *   #5  — token is single-use at the final step (submit flips status to
 *         processing; capture endpoints reject mutation after that)
 *   #7  — file size + mime validated
 *   #8  — S3 keys tenant-prefixed (delegated to StorageService)
 *   #18 — every state change appends an event
 */
@Injectable()
export class IdVerificationCaptureService {
  private readonly logger = new Logger(IdVerificationCaptureService.name);

  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly storage: StorageService,
    private readonly events: IdVerificationEventsService,
  ) {}

  async uploadFile(
    verification: VerificationRow,
    field: UploadFileField,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<{ field: UploadFileField; nextStep: IdVerificationCaptureStep | null }> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('No file provided');
    }

    // Size + mime validation (rule #7)
    if (file.size > ID_VERIFICATION_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File too large. Max ${ID_VERIFICATION_MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
      );
    }
    if (
      !(ID_VERIFICATION_ACCEPTED_MIME_TYPES as readonly string[]).includes(
        file.mimetype,
      )
    ) {
      throw new BadRequestException(
        `Unsupported file type. Accepted: ${ID_VERIFICATION_ACCEPTED_MIME_TYPES.join(
          ', ',
        )}`,
      );
    }

    // Back side is only valid for doc types that require it
    if (
      field === 'document_back' &&
      !DOCUMENT_TYPES_WITH_BACK.includes(verification.requiredDocumentType)
    ) {
      throw new BadRequestException(
        `${verification.requiredDocumentType} does not have a back side`,
      );
    }

    // Reject if the field has already been submitted for processing
    // (handled by guard canMutate check, but double-guard here)
    if (verification.status !== IdVerificationStatus.INITIATED &&
        verification.status !== IdVerificationStatus.IN_PROGRESS) {
      throw new ConflictException(
        'Capture is closed for this session',
      );
    }

    // Upload to tenant-prefixed S3 key (rule #8). Translate untyped AWS errors
    // into NestJS HTTP exceptions with actionable messages so the mobile page
    // doesn't see opaque 500s.
    const extension = mimeToExtension(file.mimetype as IdVerificationAcceptedMimeType);
    let key: string;
    try {
      const upload = await this.storage.upload(
        verification.tenantId,
        file.buffer,
        {
          folder: `id-verification/${verification.id}`,
          contentType: file.mimetype,
          filename: field,
          extension,
        },
      );
      key = upload.key;
    } catch (err) {
      if (err instanceof AwsNotConfiguredError) {
        this.logger.error(
          `Upload failed — AWS not configured: ${err.message}`,
        );
        throw new ServiceUnavailableException(
          'ID verification storage is not configured. Contact the administrator.',
        );
      }
      if (err instanceof AwsError) {
        this.logger.error(`S3 upload failed: ${err.message}`);
        throw new ServiceUnavailableException(
          'Could not upload the image. Please try again.',
        );
      }
      throw err;
    }

    // If a previous key existed for this field (rare — caller would normally
    // retry the whole session, not re-upload), delete it to prevent orphans.
    const existingKey = keyForField(verification, field);
    if (existingKey && existingKey !== key) {
      await this.storage.delete(existingKey);
    }

    // Persist key + compute next step
    const keyColumn = columnForField(field);
    const nextStep = computeNextStep(field, verification.requiredDocumentType);

    await this.db
      .update(idVerifications)
      .set({
        [keyColumn]: key,
        currentStep: nextStep,
        // First upload transitions initiated → in_progress
        status:
          verification.status === IdVerificationStatus.INITIATED
            ? IdVerificationStatus.IN_PROGRESS
            : verification.status,
        updatedAt: new Date(),
      })
      .where(eq(idVerifications.id, verification.id));

    await this.events.append({
      tenantId: verification.tenantId,
      verificationId: verification.id,
      eventType: ID_VERIFICATION_EVENT_TYPES.CAPTURE_FILE_UPLOADED,
      actorType: 'customer',
      metadata: { field, size: file.size, mimetype: file.mimetype },
    });

    return { field, nextStep };
  }

  async syncStep(
    verification: VerificationRow,
    step: IdVerificationCaptureStep,
  ): Promise<void> {
    if (verification.status !== IdVerificationStatus.INITIATED &&
        verification.status !== IdVerificationStatus.IN_PROGRESS) {
      // Non-critical — don't throw, just ignore
      return;
    }
    await this.db
      .update(idVerifications)
      .set({
        currentStep: step,
        status:
          verification.status === IdVerificationStatus.INITIATED
            ? IdVerificationStatus.IN_PROGRESS
            : verification.status,
        updatedAt: new Date(),
      })
      .where(eq(idVerifications.id, verification.id));

    await this.events.append({
      tenantId: verification.tenantId,
      verificationId: verification.id,
      eventType: ID_VERIFICATION_EVENT_TYPES.CAPTURE_STEP_SYNCED,
      actorType: 'customer',
      metadata: { step },
    });
  }
}

// ---------------------------------------------------------------------------

function columnForField(
  field: UploadFileField,
): 'documentFrontS3Key' | 'documentBackS3Key' | 'selfieS3Key' {
  switch (field) {
    case 'document_front':
      return 'documentFrontS3Key';
    case 'document_back':
      return 'documentBackS3Key';
    case 'selfie':
      return 'selfieS3Key';
  }
}

function keyForField(
  row: VerificationRow,
  field: UploadFileField,
): string | null {
  switch (field) {
    case 'document_front':
      return row.documentFrontS3Key;
    case 'document_back':
      return row.documentBackS3Key;
    case 'selfie':
      return row.selfieS3Key;
  }
}

function computeNextStep(
  justUploaded: UploadFileField,
  requiredDocumentType: string,
): IdVerificationCaptureStep | null {
  const hasBack = DOCUMENT_TYPES_WITH_BACK.includes(requiredDocumentType);
  if (justUploaded === 'document_front') {
    return hasBack ? 'document_back' : 'selfie';
  }
  if (justUploaded === 'document_back') {
    return 'selfie';
  }
  // After selfie the next step is 'processing' — but that transition only
  // happens on `submit`, not here. Return null to signal "ready to submit".
  return null;
}

function mimeToExtension(mime: IdVerificationAcceptedMimeType): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}
