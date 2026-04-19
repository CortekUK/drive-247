import { Global, Module } from '@nestjs/common';
import { S3Client } from './s3.client';
import { RekognitionClient } from './rekognition.client';

/**
 * Global AWS integration. Provides typed wrappers around AWS SDK clients
 * (S3 + Rekognition). Services should NOT inject `S3Client` directly —
 * use `StorageService` from `common/storage` instead. Rekognition is OK
 * to inject directly since its use is narrow.
 *
 * Credentials + region come from `env.config`. If AWS env vars aren't set,
 * the clients throw `AwsNotConfiguredError` on first use — verification
 * features requiring AWS won't work until configured.
 */
@Global()
@Module({
  providers: [S3Client, RekognitionClient],
  exports: [S3Client, RekognitionClient],
})
export class AwsIntegrationModule {}
