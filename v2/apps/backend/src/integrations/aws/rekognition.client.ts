import { Injectable, Logger } from '@nestjs/common';
import {
  RekognitionClient as AwsRekognitionClient,
  CompareFacesCommand,
} from '@aws-sdk/client-rekognition';
import { resolveAwsClientOptions, requireS3Bucket } from './aws-config.util';
import { RekognitionNoFaceDetectedError, AwsError } from './errors';
import { REKOGNITION_SIMILARITY_THRESHOLD } from './constants';

export interface FaceCompareResult {
  similarity: number; // 0–100; 0 if no face detected or no match
  faceCount: number; // faces detected in the target image
  raw: unknown;
}

/**
 * Rekognition wrapper for face comparison.
 *
 * Compares a face from an ID document (S3 key) to a selfie (S3 key).
 * Returns a similarity score in [0, 100]. Callers apply their own
 * thresholds — we don't make the approve/reject decision here.
 */
@Injectable()
export class RekognitionClient {
  private readonly logger = new Logger(RekognitionClient.name);
  private _client: AwsRekognitionClient | null = null;

  private get client(): AwsRekognitionClient {
    if (this._client) return this._client;
    this._client = new AwsRekognitionClient(resolveAwsClientOptions());
    return this._client;
  }

  /**
   * Source = ID document image (expected to contain one face).
   * Target = selfie image.
   */
  async compareFaces(
    sourceS3Key: string,
    targetS3Key: string,
  ): Promise<FaceCompareResult> {
    const bucket = requireS3Bucket();

    let result;
    try {
      result = await this.client.send(
        new CompareFacesCommand({
          SourceImage: {
            S3Object: { Bucket: bucket, Name: sourceS3Key },
          },
          TargetImage: {
            S3Object: { Bucket: bucket, Name: targetS3Key },
          },
          // Pass 0 so we always get the similarity score — we apply our
          // own thresholds downstream rather than relying on Rekognition's
          // default 80% cutoff.
          SimilarityThreshold: REKOGNITION_SIMILARITY_THRESHOLD,
        }),
      );
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.logger.warn(`Rekognition.CompareFaces failed: ${message}`);
      // InvalidParameterException with "no face" text → treat specially
      if (/no face/i.test(message)) {
        throw new RekognitionNoFaceDetectedError(
          /source/i.test(message) ? 'source' : 'target',
        );
      }
      throw new AwsError(`Rekognition CompareFaces failed: ${message}`, err);
    }

    const matches = result.FaceMatches ?? [];
    const unmatched = result.UnmatchedFaces ?? [];
    const faceCount = matches.length + unmatched.length;

    if (faceCount === 0) {
      // No face found at all in target image
      throw new RekognitionNoFaceDetectedError('target');
    }

    // Best match wins (Rekognition already returns them sorted desc, but
    // we don't rely on that — take the max explicitly).
    const bestSimilarity = matches.reduce(
      (max, m) => Math.max(max, m.Similarity ?? 0),
      0,
    );

    return {
      similarity: bestSimilarity,
      faceCount,
      raw: result,
    };
  }
}
