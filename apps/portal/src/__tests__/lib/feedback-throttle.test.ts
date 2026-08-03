import { describe, it, expect } from "vitest";
import {
  shouldPromptAfterRentalCompletion,
  shouldForcePrompt,
  FEEDBACK_PROMPT_COOLDOWN_DAYS,
} from "@/lib/feedback-throttle";

const NOW = new Date("2026-08-03T12:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("shouldPromptAfterRentalCompletion", () => {
  const base = { formEnabled: true, isResolved: true, lastPromptedAt: null, now: NOW };

  it("prompts a user who has never been prompted", () => {
    expect(shouldPromptAfterRentalCompletion(base)).toBe(true);
  });

  it("stays silent while settings are still loading", () => {
    // The important case: acting on defaults would prompt every operator on
    // their very first paint.
    expect(
      shouldPromptAfterRentalCompletion({ ...base, isResolved: false })
    ).toBe(false);
  });

  it("respects the platform kill switch", () => {
    expect(
      shouldPromptAfterRentalCompletion({ ...base, formEnabled: false })
    ).toBe(false);
  });

  it("stays silent inside the cooldown window", () => {
    expect(
      shouldPromptAfterRentalCompletion({ ...base, lastPromptedAt: daysAgo(1) })
    ).toBe(false);
    expect(
      shouldPromptAfterRentalCompletion({ ...base, lastPromptedAt: daysAgo(6.9) })
    ).toBe(false);
  });

  it("does not prompt exactly on the boundary, only strictly past it", () => {
    expect(
      shouldPromptAfterRentalCompletion({
        ...base,
        lastPromptedAt: daysAgo(FEEDBACK_PROMPT_COOLDOWN_DAYS),
      })
    ).toBe(false);
    expect(
      shouldPromptAfterRentalCompletion({
        ...base,
        lastPromptedAt: daysAgo(FEEDBACK_PROMPT_COOLDOWN_DAYS + 0.01),
      })
    ).toBe(true);
  });

  it("prompts again well after the cooldown", () => {
    expect(
      shouldPromptAfterRentalCompletion({ ...base, lastPromptedAt: daysAgo(30) })
    ).toBe(true);
  });

  it("treats a corrupt stamp as never-prompted rather than suppressing forever", () => {
    expect(
      shouldPromptAfterRentalCompletion({ ...base, lastPromptedAt: "not-a-date" })
    ).toBe(true);
  });

  it("tolerates a future stamp without prompting", () => {
    const future = new Date(NOW.getTime() + 86400000).toISOString();
    expect(
      shouldPromptAfterRentalCompletion({ ...base, lastPromptedAt: future })
    ).toBe(false);
  });
});

describe("shouldForcePrompt", () => {
  const base = {
    formEnabled: true,
    isResolved: true,
    forceLoginTriggeredAt: daysAgo(1),
    lastPromptedAt: null,
    suppressed: false,
  };

  it("prompts a never-prompted user once a campaign is running", () => {
    expect(shouldForcePrompt(base)).toBe(true);
  });

  it("does nothing when no campaign is running", () => {
    expect(
      shouldForcePrompt({ ...base, forceLoginTriggeredAt: null })
    ).toBe(false);
  });

  it("prompts a user last prompted BEFORE the campaign started", () => {
    expect(
      shouldForcePrompt({ ...base, lastPromptedAt: daysAgo(10) })
    ).toBe(true);
  });

  it("skips a user already prompted since the campaign started", () => {
    // This is what stops the modal reopening forever: the dialog stamps on
    // open, so a dismissal satisfies the campaign.
    expect(
      shouldForcePrompt({ ...base, lastPromptedAt: daysAgo(0.5) })
    ).toBe(false);
  });

  it("yields to a hard gate owning the screen", () => {
    expect(shouldForcePrompt({ ...base, suppressed: true })).toBe(false);
  });

  it("respects the kill switch even mid-campaign", () => {
    expect(shouldForcePrompt({ ...base, formEnabled: false })).toBe(false);
  });

  it("stays silent until both settings and the stamp have loaded", () => {
    expect(shouldForcePrompt({ ...base, isResolved: false })).toBe(false);
  });

  it("ignores an unparseable campaign timestamp instead of prompting everyone", () => {
    expect(
      shouldForcePrompt({
        ...base,
        forceLoginTriggeredAt: "garbage",
        lastPromptedAt: daysAgo(10),
      })
    ).toBe(false);
  });

  it("re-prompts when a campaign is restarted after a user was prompted", () => {
    const prompted = daysAgo(5);
    expect(
      shouldForcePrompt({
        ...base,
        lastPromptedAt: prompted,
        forceLoginTriggeredAt: daysAgo(6),
      })
    ).toBe(false);
    expect(
      shouldForcePrompt({
        ...base,
        lastPromptedAt: prompted,
        forceLoginTriggeredAt: daysAgo(4),
      })
    ).toBe(true);
  });
});
