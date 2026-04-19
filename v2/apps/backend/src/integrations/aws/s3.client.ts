import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client as AwsS3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolveAwsClientOptions, requireS3Bucket } from './aws-config.util';
import { S3UploadError } from './errors';

/**
 * Low-level S3 wrapper. Services should NOT inject this directly — use
 * `StorageService` from `common/storage` which enforces tenant-prefixed
 * keys and domain semantics.
 *
 * All operations assume a single platform-configured bucket (AWS_S3_BUCKET).
 * Multi-bucket / multi-region is a future concern.
 */
@Injectable()
export class S3Client {
  private readonly logger = new Logger(S3Client.name);
  private _client: AwsS3Client | null = null;

  private get client(): AwsS3Client {
    if (this._client) return this._client;
    this._client = new AwsS3Client(resolveAwsClientOptions());
    return this._client;
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const bucket = requireS3Bucket();
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      this.logger.warn(`S3 putObject failed for key=${key}: ${(err as Error).message}`);
      throw new S3UploadError(key, err);
    }
  }

  /**
   * Signed URL for reading an object. Callers should pass a short TTL
   * (e.g. 5 min) — these URLs are handed to browsers for <img src>.
   */
  async getSignedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const bucket = requireS3Bucket();
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async deleteObject(key: string): Promise<void> {
    const bucket = requireS3Bucket();
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (err) {
      // Delete is best-effort — log but don't throw. Orphan files are
      // lower-impact than blocking a user-facing retry flow.
      this.logger.warn(
        `S3 deleteObject failed for key=${key}: ${(err as Error).message}`,
      );
    }
  }
}
