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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    expect(
      validateAttribution({ ...EMPTY_ATTRIBUTION, heardAbout: "instagram", fleetSize: "6-20", phone: "(404) 555-0123" }),
    ).toEqual({});
  });

  it("rides along with the answer to the server", () => {
    expect(attributionFromDraft({ ...EMPTY_ATTRIBUTION, heardAbout: "youtube", fleetSize: "21+" })).toEqual({
      heardAbout: "youtube",
      fleetSize: "21+",
    });
  });

  it("asks again after Google sign-in when either answer is missing", () => {
    expect(hasCompleteAttribution({ heardAbout: "youtube", fleetSize: "1-5", phone: "+14045550123" })).toBe(true);
    expect(hasCompleteAttribution({ heardAbout: "youtube" })).toBe(false);
    expect(hasCompleteAttribution({ fleetSize: "1-5" })).toBe(false);
    expect(hasCompleteAttribution(null)).toBe(false);
  });
});

// Owner, 2026-11-20: after "No thanks" a second "Leave for now? / Keep going /
// Leave" box appeared, and PostHog recorded frustrated repeated taps. The offer
// is now the only box on the way out of the card step.
describe("only one box on the way out", () => {
  const read = (f: string) => readFileSync(resolve(__dirname, f), "utf8");
  const screen = read("onboarding-screen.tsx");
  const provider = read("onboarding-provider.tsx");

  it("has no Leave for now / Keep going panel", () => {
    expect(screen).not.toContain('title="Leave for now?"');
    expect(screen).not.toMatch(/>\s*Keep going\s*</);
    expect(provider).not.toContain("setCloseConfirmOpen");
  });

  it("closes straight away from the card step once the offer is used up", () => {
    const at = provider.indexOf("const requestClose = useCallback(");
    const body = provider.slice(at, provider.indexOf("}, [closeNow]);", at));
    expect(body).not.toMatch(/step === "payment"/);
    expect(body).toContain("closeNow();");
  });

  it("offers first on the X and Escape, on every device", () => {
    expect(screen).toMatch(/if \(offerAllowedRef\.current\) \{\s*showExitOffer\("close"\)/);
    expect(screen).toContain("if (!next) onCloseButton();");
  });
});

// 2026-11-24: a new signup opened "Change plan", tapped the X to close the
// list, got the one-time offer and took 20% off. Choosing a plan is not leaving.
describe("Change plan is not an exit", () => {
  const read = (f: string) => readFileSync(resolve(__dirname, f), "utf8");
  const screen = read("onboarding-screen.tsx");
  const step = read("steps/payment-step.tsx");

  it("the X and Escape close an open plan list before anything else", () => {
    const at = screen.indexOf("const onCloseButton = useCallback(");
    const body = screen.slice(at, screen.indexOf("}, [exitOffer, requestClose, showExitOffer, trackExitOffer]);", at));
    const pickerAt = body.indexOf("if (planPickerOpenRef.current)");
    expect(pickerAt).toBeGreaterThan(-1);
    expect(pickerAt).toBeLessThan(body.indexOf('showExitOffer("close")'));
    expect(pickerAt).toBeLessThan(body.indexOf("requestClose()"));
  });

  it("the offer cannot show while the plan list is open (exit intent included)", () => {
    expect(screen).toMatch(/covered: exitOffer !== null \|\| !isOpen \|\| planPickerOpen/);
  });

  it("a phone's back button closes an open plan list instead of offering", () => {
    const at = screen.indexOf("const onPop = () => {");
    const body = screen.slice(at, at + 900);
    expect(body.indexOf("if (planPickerOpenRef.current)")).toBeGreaterThan(-1);
    expect(body.indexOf("if (planPickerOpenRef.current)")).toBeLessThan(body.indexOf('showExitOffer("back")'));
  });

  it("the screen owns the plan list state and hands it to the payment step", () => {
    expect(screen).toContain("planPickerOpen={planPickerOpen}");
    expect(screen).toContain("onPlanPickerOpenChange={setPlanPickerOpen}");
    expect(step).toContain("onPlanPickerOpenChange?.(value)");
  });
});

// 2026-11-24 (owner): the phone number is required. A 21+ car lead left it
// blank and the team had no way to call.
describe("phone number: required", () => {
  const read = (f: string) => readFileSync(resolve(__dirname, f), "utf8");

  it("blank is refused with its own message", () => {
    expect(validateAttribution({ ...EMPTY_ATTRIBUTION, heardAbout: "instagram", fleetSize: "21+" }).phone).toBe(
      "Please enter your phone number.",
    );
    expect(validateAttribution({ ...EMPTY_ATTRIBUTION, heardAbout: "instagram", fleetSize: "21+", phone: "   " }).phone).toBe(
      "Please enter your phone number.",
    );
  });

  it("a number that is not a phone number is refused", () => {
    expect(validateAttribution({ ...EMPTY_ATTRIBUTION, heardAbout: "instagram", fleetSize: "21+", phone: "call me" }).phone).toBe(
      "Please enter a valid phone number.",
    );
  });

  it("a Google signup with no phone on record is asked for it before the card", () => {
    expect(hasCompleteAttribution({ heardAbout: "instagram", fleetSize: "21+" })).toBe(false);
    expect(hasCompleteAttribution({ heardAbout: "instagram", fleetSize: "21+", phone: "" })).toBe(false);
    expect(hasCompleteAttribution({ heardAbout: "instagram", fleetSize: "21+", phone: "call me" })).toBe(false);
  });

  it("the field no longer says optional", () => {
    const fields = read("heard-about-fields.tsx");
    expect(fields).not.toMatch(/Phone number <span[^>]*>\(optional\)/);
    expect(fields).toContain('aria-required="true"');
  });
});
