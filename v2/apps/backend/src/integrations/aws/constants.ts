/**
 * AWS integration constants — backend-only.
 *
 * Credential and region configuration comes from `env.config` — do not
 * hardcode region or bucket here.
 */

// Minimum quality gate for Rekognition face comparison. Rekognition itself
// applies a default threshold of 80% to treat faces as "matched" — we pass
// a lower threshold so we get the similarity number even on borderline cases
// and let our own decision logic apply the real cutoffs.
export const REKOGNITION_SIMILARITY_THRESHOLD = 0;

// Rekognition's similarity scale: 0–100
export const REKOGNITION_SIMILARITY_MAX = 100;
