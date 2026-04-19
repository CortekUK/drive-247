import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Client } from '../../integrations/aws/s3.client';
import type { StoredObjectRef, UploadOptions } from './types';

/**
 * Domain wrapper over S3. Enforces tenant isolation at the key level:
 * every stored object lives under `tenants/{tenantId}/...`. Feature
 * services call this instead of the raw S3Client.
 *
 * The backing storage is S3 today; if we ever swap providers, only this
 * file changes — consumers stay stable.
 */
@Injectable()
export class StorageService {
  constructor(private readonly s3: S3Client) {}

  /**
   * Upload a file. Returns the S3 key — callers persist this in the DB.
   * Never persist or return a URL here; URLs are short-lived and generated
   * on-demand via `getSignedUrl`.
   */
  async upload(
    tenantId: string,
    buffer: Buffer,
    options: UploadOptions,
  ): Promise<StoredObjectRef> {
    const key = this.buildKey(tenantId, options);
    await this.s3.putObject(key, buffer, options.contentType);
    return { key };
  }

  /**
   * Generate a short-lived signed URL for reading. Callers specify TTL
   * via the shared `ID_VERIFICATION_SIGNED_URL_TTL_SECS` constant (or
   * similar) — never hardcoded here.
   */
  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return this.s3.getSignedReadUrl(key, expiresInSeconds);
  }

  /**
   * Best-effort delete. Errors are logged but don't propagate so that
   * user-facing retry flows aren't blocked by orphan-cleanup failures.
   */
  async delete(key: string): Promise<void> {
    await this.s3.deleteObject(key);
  }

  /**
   * Build a tenant-prefixed, non-guessable S3 key.
   *
   * Shape: `tenants/{tenantId}/{folder}/{filename}.{ext}`
   * Example: `tenants/abc-123/id-verification/doc-front-f2b1.jpg`
   */
  private buildKey(tenantId: string, options: UploadOptions): string {
    const folder = sanitizeFolder(options.folder);
    const filename = options.filename
      ? sanitizeFilename(options.filename)
      : randomUUID();
    const ext = options.extension
      ? `.${sanitizeExtension(options.extension)}`
      : '';
    return `tenants/${tenantId}/${folder}/${filename}${ext}`;
  }
}

function sanitizeFolder(folder: string): string {
  // Allow only alnum, dash, underscore, slash. Strip leading/trailing
  // slashes and collapse any repeated slashes — defends against inputs
  // like "../../evil" which would otherwise leave "//evil".
  return folder
    .replace(/[^a-zA-Z0-9/_-]/g, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function sanitizeExtension(ext: string): string {
  return ext.toLowerCase().replace(/[^a-z0-9]/g, '');
}
