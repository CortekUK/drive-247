import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from './storage.service';
import type { S3Client } from '../../integrations/aws/s3.client';

function makeS3Mock() {
  return {
    putObject: vi.fn(async () => undefined),
    getSignedReadUrl: vi.fn(async () => 'https://signed.example/url'),
    deleteObject: vi.fn(async () => undefined),
  } as unknown as S3Client & {
    putObject: ReturnType<typeof vi.fn>;
    getSignedReadUrl: ReturnType<typeof vi.fn>;
    deleteObject: ReturnType<typeof vi.fn>;
  };
}

describe('StorageService', () => {
  let s3: ReturnType<typeof makeS3Mock>;
  let svc: StorageService;

  beforeEach(() => {
    s3 = makeS3Mock();
    svc = new StorageService(s3);
  });

  it('prefixes every key with tenants/{tenantId}/{folder}/', async () => {
    const { key } = await svc.upload('tenant-abc', Buffer.from('x'), {
      folder: 'id-verification',
      contentType: 'image/jpeg',
      filename: 'doc-front',
      extension: 'jpg',
    });
    expect(key).toBe('tenants/tenant-abc/id-verification/doc-front.jpg');
    expect(s3.putObject).toHaveBeenCalledWith(key, expect.any(Buffer), 'image/jpeg');
  });

  it('uses a uuid filename when none supplied', async () => {
    const { key } = await svc.upload('t', Buffer.from('x'), {
      folder: 'x',
      contentType: 'image/jpeg',
    });
    expect(key).toMatch(
      /^tenants\/t\/x\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('sanitizes folder to prevent path traversal', async () => {
    const { key } = await svc.upload('t', Buffer.from('x'), {
      folder: '../../evil',
      contentType: 'image/jpeg',
      filename: 'f',
      extension: 'jpg',
    });
    // `..` is stripped, remaining slashes collapsed
    expect(key).toBe('tenants/t/evil/f.jpg');
    expect(key.includes('..')).toBe(false);
  });

  it('lowercases and sanitizes filename and extension', async () => {
    const { key } = await svc.upload('t', Buffer.from('x'), {
      folder: 'f',
      contentType: 'image/jpeg',
      filename: 'MY File?.name',
      extension: 'JPEG!',
    });
    // spaces, `?`, `.` all collapse to `-` (only a-z0-9_- kept)
    expect(key).toBe('tenants/t/f/my-file--name.jpeg');
  });

  it('passes through TTL for signed URLs', async () => {
    await svc.getSignedUrl('tenants/t/x/y.jpg', 300);
    expect(s3.getSignedReadUrl).toHaveBeenCalledWith('tenants/t/x/y.jpg', 300);
  });

  it('delegates delete to s3 client', async () => {
    await svc.delete('tenants/t/x/y.jpg');
    expect(s3.deleteObject).toHaveBeenCalledWith('tenants/t/x/y.jpg');
  });
});
