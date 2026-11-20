// @vitest-environment jsdom
/**
 * "Not ready just yet?" on the card step, and the fleet-size answer that picks
 * the plan on the first page.
 *
 * WHAT THESE PIN:
 *   - the offer shows on the card step only, once per person, never over an
 *     applied code, a payment in flight or another panel;
 *   - "once" survives a reload (this browser) and junk storage is harmless;
 *   - exit intent is the pointer leaving through the TOP of the window only;
 *   - 1-5 Starter, 6-20 Growth, 21+ Scale, and a plan the visitor picked on
 *     the pricing grid is never overridden;
 *   - the question is required on the form and carried to the server.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { SIGNUP_PLANS } from "@/lib/plans";
import { FLEET_SIZE_OPTIONS, FLEET_SIZE_PLAN, fleetSizePlanId, isFleetSize, planForFleetSize } from "@/lib/fleet-size";
import {
  attributionFromDraft,
  EMPTY_ATTRIBUTION,
  hasCompleteAttribution,
  validateAttribution,
} from "@/lib/signup-attribution";

import {
  EXIT_OFFER_CODE,
  EXIT_OFFER_STORAGE_KEY,
  isExitIntent,
  isPhoneLike,
  readExitOfferSeen,
  shouldShowExitOffer,
  writeExitOfferSeen,
  type ExitOfferGate,
} from "./exit-offer";

const open: ExitOfferGate = {
  step: "payment",
  paid: false,
  promoApplied: false,
  busy: false,
  seenLocally: false,
  seenOnAccount: false,
  covered: false,
};

describe("exit offer: when it may show", () => {
  it("shows on the card step for someone who has not seen it", () => {
    expect(shouldShowExitOffer(open)).toBe(true);
  });

  it.each(["account", "verify", "provisioning", "done", "plan"])("never on the %s step", (step) => {
    expect(shouldShowExitOffer({ ...open, step })).toBe(false);
  });

  it("is shown once per person: this browser or the account", () => {
    expect(shouldShowExitOffer({ ...open, seenLocally: true })).toBe(false);
    expect(shouldShowExitOffer({ ...open, seenOnAccount: true })).toBe(false);
  });

  it("is not offered to someone who already applied a code", () => {
    expect(shouldShowExitOffer({ ...open, promoApplied: true })).toBe(false);
  });

  it("never interrupts a payment, a paid signup or another panel", () => {
    expect(shouldShowExitOffer({ ...open, busy: true })).toBe(false);
    expect(shouldShowExitOffer({ ...open, paid: true })).toBe(false);
    expect(shouldShowExitOffer({ ...open, covered: true })).toBe(false);
  });

  it("applies the owner's code", () => {
    expect(EXIT_OFFER_CODE).toBe("WELCOME20");
  });
});

describe("exit offer: remembered in this browser", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts unseen, and stays seen after a reload", () => {
    expect(readExitOfferSeen()).toBe(false);
    writeExitOfferSeen(window.localStorage, new Date("2026-11-20T10:00:00Z"));
    expect(window.localStorage.getItem(EXIT_OFFER_STORAGE_KEY)).toBe("2026-11-20T10:00:00.000Z");
    expect(readExitOfferSeen()).toBe(true);
  });

  it("never throws when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readExitOfferSeen(blocked)).toBe(false);
    expect(() => writeExitOfferSeen(blocked)).not.toThrow();
    expect(readExitOfferSeen(null)).toBe(false);
  });
});

describe("exit offer: what counts as leaving", () => {
  it("is the pointer leaving through the top of the window", () => {
    expect(isExitIntent({ clientY: 0, relatedTarget: null })).toBe(true);
    expect(isExitIntent({ clientY: -4, relatedTarget: null })).toBe(true);
  });

  it("is not the pointer moving onto another element, or out of a side", () => {
    expect(isExitIntent({ clientY: 0, relatedTarget: document.body })).toBe(false);
    expect(isExitIntent({ clientY: 300, relatedTarget: null })).toBe(false);
  });

  it("tells phones from laptops by width or a touch pointer", () => {
    const media = (hits: string[]) => ({ matchMedia: (q: string) => ({ matches: hits.includes(q) }) });
    expect(isPhoneLike(media(["(max-width: 639px)"]))).toBe(true);
    expect(isPhoneLike(media(["(pointer: coarse)"]))).toBe(true);
    expect(isPhoneLike(media([]))).toBe(false);
    expect(isPhoneLike(undefined)).toBe(false);
  });
});

describe("fleet size: the plan it picks", () => {
  const pick = (fleet: "1-5" | "6-20" | "21+", currentPlanId: string | null = "starter", planChosenByVisitor = false) =>
    planForFleetSize(fleet, { currentPlanId, planChosenByVisitor, catalogue: SIGNUP_PLANS });

  it("offers exactly the three agreed answers", () => {
    expect(FLEET_SIZE_OPTIONS.map((o) => o.value)).toEqual(["1-5", "6-20", "21+"]);
    expect(FLEET_SIZE_PLAN).toEqual({ "1-5": "starter", "6-20": "growth", "21+": "scale" });
  });

  it("maps 1-5 to Starter, 6-20 to Growth and 21+ to Scale", () => {
    expect(pick("1-5", "growth")).toBe("starter");
    expect(pick("6-20")).toBe("growth");
    expect(pick("21+")).toBe("scale");
  });

  it("says nothing when the plan already matches", () => {
    expect(pick("1-5", "starter")).toBeNull();
  });

  it("leaves a plan the visitor chose on the pricing grid alone", () => {
    expect(pick("21+", "starter", true)).toBeNull();
    expect(pick("1-5", "scale", true)).toBeNull();
  });

  it("does not send anyone to a plan the live catalogue no longer sells", () => {
    const noScale = SIGNUP_PLANS.filter((p) => p.id !== "scale");
    expect(planForFleetSize("21+", { currentPlanId: "starter", planChosenByVisitor: false, catalogue: noScale })).toBeNull();
  });

  it("finds the live plans, which a super admin keys starter_2 / growth_2 / scale_2", () => {
    const live = SIGNUP_PLANS.map((p) => ({ ...p, id: `${p.id}_2` }));
    const opts = { currentPlanId: "starter_2", planChosenByVisitor: false, catalogue: live };
    expect(planForFleetSize("21+", opts)).toBe("scale_2");
    expect(planForFleetSize("6-20", opts)).toBe("growth_2");
    expect(planForFleetSize("1-5", opts)).toBeNull();
  });

  it("matches by name, then by price order when three plans carry other names", () => {
    const named = SIGNUP_PLANS.map((p, i) => ({ ...p, id: `plan_${i}` }));
    expect(fleetSizePlanId("6-20", named)).toBe("plan_1");
    const renamed = SIGNUP_PLANS.map((p, i) => ({ ...p, id: `tier_${i}`, name: `Tier ${i}` })).reverse();
    expect(fleetSizePlanId("1-5", renamed)).toBe("tier_0");
    expect(fleetSizePlanId("21+", renamed)).toBe("tier_2");
  });

  it("recognises only its own values", () => {
    expect(isFleetSize("6-20")).toBe(true);
    expect(isFleetSize("6–20")).toBe(false);
    expect(isFleetSize(12)).toBe(false);
  });
});

describe("fleet size: on the form", () => {
  it("is required", () => {
    expect(validateAttribution({ ...EMPTY_ATTRIBUTION, heardAbout: "instagram" }).fleetSize).toBeTruthy();
    expect(validateAttribution({ ...EMPTY_ATTRIBUTION, heardAbout: "instagram", fleetSize: "6-20" })).toEqual({});
  });

  it("rides along with the answer to the server", () => {
    expect(attributionFromDraft({ ...EMPTY_ATTRIBUTION, heardAbout: "youtube", fleetSize: "21+" })).toEqual({
      heardAbout: "youtube",
      fleetSize: "21+",
    });
  });

  it("asks again after Google sign-in when either answer is missing", () => {
    expect(hasCompleteAttribution({ heardAbout: "youtube", fleetSize: "1-5" })).toBe(true);
    expect(hasCompleteAttribution({ heardAbout: "youtube" })).toBe(false);
    expect(hasCompleteAttribution({ fleetSize: "1-5" })).toBe(false);
    expect(hasCompleteAttribution(null)).toBe(false);
  });
});
