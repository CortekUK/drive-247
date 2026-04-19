import { getEnv } from '../../config/env.config';
import { AwsNotConfiguredError } from './errors';

/**
 * Resolved AWS SDK client constructor options.
 *
 * Kept as a pure function so tests can mock `getEnv()` and verify the
 * credential assembly without instantiating SDK clients.
 */
export interface AwsClientOptions {
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export function resolveAwsClientOptions(): AwsClientOptions {
  const env = getEnv();
  if (!env.AWS_REGION) throw new AwsNotConfiguredError('AWS_REGION');
  if (!env.AWS_ACCESS_KEY_ID) throw new AwsNotConfiguredError('AWS_ACCESS_KEY_ID');
  if (!env.AWS_SECRET_ACCESS_KEY)
    throw new AwsNotConfiguredError('AWS_SECRET_ACCESS_KEY');

  return {
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  };
}

export function requireS3Bucket(): string {
  const env = getEnv();
  if (!env.AWS_S3_BUCKET) throw new AwsNotConfiguredError('AWS_S3_BUCKET');
  return env.AWS_S3_BUCKET;
}

export function isAwsConfigured(): boolean {
  const env = getEnv();
  return Boolean(
    env.AWS_REGION &&
      env.AWS_ACCESS_KEY_ID &&
      env.AWS_SECRET_ACCESS_KEY &&
      env.AWS_S3_BUCKET,
  );
}
