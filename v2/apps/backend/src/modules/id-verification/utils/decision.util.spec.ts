import { describe, it, expect } from 'vitest';
import { IdVerificationStatus } from '@drive247/shared-types';
import { decide, resolveThresholds } from './decision.util';

const STD = { autoApprovePct: 90, reviewPct: 70, minOcrConfidence: 0.7 };

describe('decide', () => {
  it('block match overrides everything — always REJECTED', () => {
    const result = decide({
      faceMatchScore: 99,
      ocrConfidence: 1,
      blockMatch: true,
      thresholds: STD,
    });
    expect(result.status).toBe(IdVerificationStatus.REJECTED);
    expect(result.reason).toMatch(/block/i);
  });

  it('missing OCR → REVIEW_REQUIRED', () => {
    const result = decide({
      faceMatchScore: 95,
      ocrConfidence: null,
      blockMatch: false,
      thresholds: STD,
    });
    expect(result.status).toBe(IdVerificationStatus.REVIEW_REQUIRED);
    expect(result.reason).toMatch(/OCR could not/i);
  });

  it('low OCR confidence → REVIEW_REQUIRED even with perfect face match', () => {
    const result = decide({
      faceMatchScore: 100,
      ocrConfidence: 0.5,
      blockMatch: false,
      thresholds: STD,
    });
    expect(result.status).toBe(IdVerificationStatus.REVIEW_REQUIRED);
    expect(result.reason).toMatch(/OCR confidence/i);
  });

  it('missing face match → REVIEW_REQUIRED', () => {
    const result = decide({
      faceMatchScore: null,
      ocrConfidence: 0.95,
      blockMatch: false,
      thresholds: STD,
    });
    expect(result.status).toBe(IdVerificationStatus.REVIEW_REQUIRED);
    expect(result.reason).toMatch(/face match/i);
  });

  it('score >= autoApprovePct → APPROVED', () => {
    const result = decide({
      faceMatchScore: 90,
      ocrConfidence: 0.9,
      blockMatch: false,
      thresholds: STD,
    });
    expect(result.status).toBe(IdVerificationStatus.APPROVED);
  });

  it('score in review band → REVIEW_REQUIRED', () => {
    expect(
      decide({
        faceMatchScore: 75,
        ocrConfidence: 0.9,
        blockMatch: false,
        thresholds: STD,
      }).status,
    ).toBe(IdVerificationStatus.REVIEW_REQUIRED);
    expect(
      decide({
        faceMatchScore: 70,
        ocrConfidence: 0.9,
        blockMatch: false,
        thresholds: STD,
      }).status,
    ).toBe(IdVerificationStatus.REVIEW_REQUIRED);
  });

  it('score below review floor → REJECTED', () => {
    const result = decide({
      faceMatchScore: 50,
      ocrConfidence: 0.9,
      blockMatch: false,
      thresholds: STD,
    });
    expect(result.status).toBe(IdVerificationStatus.REJECTED);
    expect(result.reason).toMatch(/below review floor/i);
  });

  it('respects tenant-overridden thresholds', () => {
    // Tenant is stricter: 95 to approve, 80 to review
    const strict = {
      autoApprovePct: 95,
      reviewPct: 80,
      minOcrConfidence: 0.85,
    };
    expect(
      decide({
        faceMatchScore: 92, // below strict 95
        ocrConfidence: 0.9,
        blockMatch: false,
        thresholds: strict,
      }).status,
    ).toBe(IdVerificationStatus.REVIEW_REQUIRED);
    expect(
      decide({
        faceMatchScore: 92,
        ocrConfidence: 0.9,
        blockMatch: false,
        thresholds: STD, // default 90 → would have approved
      }).status,
    ).toBe(IdVerificationStatus.APPROVED);
  });
});

describe('resolveThresholds', () => {
  it('uses defaults when all overrides are null', () => {
    expect(
      resolveThresholds({
        autoApprovePct: null,
        reviewPct: null,
        minOcrConfidence: null,
      }),
    ).toEqual({ autoApprovePct: 90, reviewPct: 70, minOcrConfidence: 0.7 });
  });

  it('uses tenant overrides when present', () => {
    expect(
      resolveThresholds({
        autoApprovePct: 95,
        reviewPct: 75,
        minOcrConfidence: 0.8,
      }),
    ).toEqual({ autoApprovePct: 95, reviewPct: 75, minOcrConfidence: 0.8 });
  });

  it('mix-and-match: one override, others default', () => {
    expect(
      resolveThresholds({
        autoApprovePct: 85,
        reviewPct: null,
        minOcrConfidence: null,
      }),
    ).toEqual({ autoApprovePct: 85, reviewPct: 70, minOcrConfidence: 0.7 });
  });
});
