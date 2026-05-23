/**
 * compute-lead-score — Spec Section 6.2 (submit flow step 5) and Section 11.3.
 *
 * Deterministic heuristic scoring for V1. Phase 3 will plug in ML.
 * Inputs: { applicationData } — same shape as the booking form's ApplyFormValues.
 * Output: { score: 0-100, band: 'hot'|'warm'|'cold'|'risk', reason: { ... } }
 *
 * Signal weights:
 *   - years driving (more = better)
 *   - has violations (penalty)
 *   - rideshare account active + tier
 *   - deposit readiness + comfort amount vs depositComfortAmount
 *   - weekly budget realism
 *   - has all docs uploaded
 *   - rental length target (weekly/monthly = stickier)
 *   - existing customer (rentedFromUsBefore = strong positive)
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  applicationData?: Record<string, unknown>;
}

interface ScoreReason {
  baseline: number;
  years_driving?: number;
  violations?: number;
  rideshare?: number;
  rideshare_tier?: number;
  deposit?: number;
  budget?: number;
  documents?: number;
  rental_length?: number;
  returning?: number;
  penalties: string[];
}

function score(data: Record<string, unknown>): {
  score: number;
  band: "hot" | "warm" | "cold" | "risk";
  reason: ScoreReason;
} {
  let total = 40; // baseline
  const reason: ScoreReason = { baseline: 40, penalties: [] };

  // Years driving (0 → 20)
  const years = Number(data.yearsDriving) || 0;
  const yearsScore = Math.min(20, years * 2);
  total += yearsScore;
  reason.years_driving = yearsScore;

  // Violations penalty
  if (data.hasViolations === true) {
    total -= 10;
    reason.violations = -10;
    reason.penalties.push("has_violations");
  } else {
    reason.violations = 0;
  }

  // Rideshare active for gig purposes
  const purpose = String(data.purpose ?? "");
  const isGigPurpose = ["uber", "lyft", "doordash", "instacart", "delivery"].includes(purpose);
  if (isGigPurpose) {
    if (data.rideshareAccountActive === true) {
      total += 8;
      reason.rideshare = 8;
    } else {
      total -= 5;
      reason.rideshare = -5;
      reason.penalties.push("rideshare_required_but_inactive");
    }
    const tier = String(data.rideshareTier ?? "").toLowerCase();
    if (tier.includes("platinum") || tier.includes("diamond")) {
      total += 5;
      reason.rideshare_tier = 5;
    } else if (tier.includes("gold")) {
      total += 3;
      reason.rideshare_tier = 3;
    }
  }

  // Deposit readiness
  if (data.canPayDeposit === true) {
    total += 10;
    reason.deposit = 10;
  } else {
    total -= 5;
    reason.deposit = -5;
    reason.penalties.push("cannot_pay_deposit");
  }
  const depositAmount = Number(data.depositComfortAmount) || 0;
  if (depositAmount >= 500) {
    total += 5;
    reason.deposit = (reason.deposit ?? 0) + 5;
  }

  // Weekly budget realism (between 150 and 800/week = reasonable)
  const weeklyBudget = Number(data.weeklyBudget) || 0;
  if (weeklyBudget >= 200 && weeklyBudget <= 800) {
    total += 5;
    reason.budget = 5;
  } else if (weeklyBudget > 0 && weeklyBudget < 100) {
    total -= 5;
    reason.budget = -5;
    reason.penalties.push("unrealistic_low_budget");
  }

  // Documents uploaded (each = +3)
  let docPoints = 0;
  if (data.licencePhotoUrl) docPoints += 3;
  if (data.selfieUrl) docPoints += 3;
  if (isGigPurpose && data.rideshareProofUrl) docPoints += 4;
  total += docPoints;
  reason.documents = docPoints;

  // Rental length target — longer = stickier
  const target = String(data.rentalLengthTarget ?? "");
  if (target === "monthly") {
    total += 4;
    reason.rental_length = 4;
  } else if (target === "weekly") {
    total += 2;
    reason.rental_length = 2;
  }

  // Returning customer
  if (data.rentedFromUsBefore === true) {
    total += 8;
    reason.returning = 8;
  }

  // Clamp 0-100
  total = Math.max(0, Math.min(100, total));

  // Bands per spec §3 Glossary
  let band: "hot" | "warm" | "cold" | "risk";
  if (reason.penalties.includes("has_violations") && total < 50) {
    band = "risk";
  } else if (total >= 75) {
    band = "hot";
  } else if (total >= 55) {
    band = "warm";
  } else if (total >= 35) {
    band = "cold";
  } else {
    band = "risk";
  }

  return { score: total, band, reason };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.applicationData) return errorResponse("applicationData is required");

    const result = score(body.applicationData);
    return jsonResponse(result);
  } catch (err) {
    console.error("compute-lead-score error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
