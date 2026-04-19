import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must mock env + the AWS SDK module BEFORE importing the client under test
vi.mock('../../config/env.config', () => ({
  getEnv: () => ({
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'AKIAMOCK',
    AWS_SECRET_ACCESS_KEY: 'mock-secret',
    AWS_S3_BUCKET: 'test-bucket',
  }),
}));

const sendMock = vi.fn();
vi.mock('@aws-sdk/client-rekognition', () => ({
  RekognitionClient: class {
    send = sendMock;
  },
  CompareFacesCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { RekognitionClient } from './rekognition.client';
import { RekognitionNoFaceDetectedError, AwsError } from './errors';

describe('RekognitionClient', () => {
  let client: RekognitionClient;

  beforeEach(() => {
    sendMock.mockReset();
    client = new RekognitionClient();
  });

  it('returns the best similarity score when faces match', async () => {
    sendMock.mockResolvedValueOnce({
      FaceMatches: [{ Similarity: 92.5 }, { Similarity: 85.1 }],
      UnmatchedFaces: [],
    });

    const result = await client.compareFaces('src.jpg', 'tgt.jpg');
    expect(result.similarity).toBe(92.5);
    expect(result.faceCount).toBe(2);
  });

  it('treats FaceMatches + UnmatchedFaces count as total faces', async () => {
    sendMock.mockResolvedValueOnce({
      FaceMatches: [{ Similarity: 50 }],
      UnmatchedFaces: [{ Confidence: 99 }],
    });

    const result = await client.compareFaces('src.jpg', 'tgt.jpg');
    expect(result.similarity).toBe(50);
    expect(result.faceCount).toBe(2);
  });

  it('returns similarity 0 when there are no matches but target has a face', async () => {
    sendMock.mockResolvedValueOnce({
      FaceMatches: [],
      UnmatchedFaces: [{ Confidence: 99 }],
    });

    const result = await client.compareFaces('src.jpg', 'tgt.jpg');
    expect(result.similarity).toBe(0);
    expect(result.faceCount).toBe(1);
  });

  it('throws RekognitionNoFaceDetectedError when no face in target', async () => {
    sendMock.mockResolvedValueOnce({
      FaceMatches: [],
      UnmatchedFaces: [],
    });

    await expect(client.compareFaces('src.jpg', 'tgt.jpg')).rejects.toThrow(
      RekognitionNoFaceDetectedError,
    );
  });

  it('maps "no face" SDK errors to RekognitionNoFaceDetectedError', async () => {
    sendMock.mockRejectedValueOnce(
      new Error('InvalidParameterException: There are no faces in the source image.'),
    );

    await expect(client.compareFaces('src.jpg', 'tgt.jpg')).rejects.toThrow(
      RekognitionNoFaceDetectedError,
    );
  });

  it('wraps generic SDK errors in AwsError', async () => {
    sendMock.mockRejectedValueOnce(new Error('Throttling: rate limit exceeded'));

    await expect(client.compareFaces('src.jpg', 'tgt.jpg')).rejects.toThrow(
      AwsError,
    );
  });
});
