/**
 * Typed errors thrown by AWS integration clients. Services catch these and
 * map to NestJS HTTP exceptions at the service boundary — never expose raw
 * AWS SDK errors to the caller.
 */

export class AwsError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AwsError';
  }
}

export class AwsNotConfiguredError extends AwsError {
  constructor(missing: string) {
    super(
      `AWS is not configured: missing ${missing}. ` +
        'ID verification and any feature requiring S3 / Rekognition will be unavailable.',
    );
    this.name = 'AwsNotConfiguredError';
  }
}

export class S3UploadError extends AwsError {
  constructor(key: string, cause?: unknown) {
    super(`Failed to upload object to S3 (key=${key})`, cause);
    this.name = 'S3UploadError';
  }
}

export class S3NotFoundError extends AwsError {
  constructor(key: string) {
    super(`S3 object not found: ${key}`);
    this.name = 'S3NotFoundError';
  }
}

export class RekognitionNoFaceDetectedError extends AwsError {
  constructor(side: 'source' | 'target') {
    super(
      `No face detected in the ${side} image. Ask the customer to retake the photo with their face clearly visible.`,
    );
    this.name = 'RekognitionNoFaceDetectedError';
  }
}
