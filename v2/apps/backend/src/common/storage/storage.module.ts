import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Generic object storage abstraction. Backed by AWS S3 today (see
 * `S3Client` in integrations/aws). Feature modules inject `StorageService`
 * instead of talking to S3 directly so tenant-key prefixing and signed-URL
 * expiry are enforced centrally.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
