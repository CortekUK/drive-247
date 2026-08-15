import { describe, expect, it } from "vitest";
import { validateStrategyCallSubmission } from "./validation";

function validSubmission(overrides: Record<string, string> = {}): FormData {
  const values = {
    name: "  Haris   Khan  ",
    email: " HARIS@example.com ",
    phone: "+44 7376 700583",
    fleet_size: "5–10 vehicles",
    current_platform: "Turo",
    main_booking_source: "Referrals",
    budget: "$500–$1,500",
    readiness: "Ready if the system is a good fit",
    website: "",
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("strategy-call qualifier validation", () => {
  it("normalizes a valid allow-listed submission", () => {
    const result = validateStrategyCallSubmission(validSubmission());
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Haris Khan",
        email: "haris@example.com",
        phone: "+44 7376 700583",
        fleetSize: "5–10 vehicles",
        currentPlatform: "Turo",
        mainBookingSource: "Referrals",
        budget: "$500–$1,500",
        readiness: "Ready if the system is a good fit",
      },
    });
  });

  it.each([
    ["fleet_size", "500 vehicles"],
    ["current_platform", "Injected platform"],
    ["main_booking_source", "Injected source"],
    ["budget", "$0"],
    ["readiness", "Immediately"],
  ])("rejects a non-allow-listed %s", (field, value) => {
    expect(validateStrategyCallSubmission(validSubmission({ [field]: value })).ok)
      .toBe(false);
  });

  it("rejects invalid contact fields", () => {
    expect(
      validateStrategyCallSubmission(validSubmission({ email: "not-an-email" })).ok,
    ).toBe(false);
    expect(
      validateStrategyCallSubmission(validSubmission({ phone: "call me" })).ok,
    ).toBe(false);
  });

  it("enforces contact field length boundaries", () => {
    expect(validateStrategyCallSubmission(validSubmission({ name: "x" })).ok)
      .toBe(false);
    expect(
      validateStrategyCallSubmission(validSubmission({ name: "x".repeat(121) })).ok,
    ).toBe(false);
    expect(
      validateStrategyCallSubmission(
        validSubmission({ email: `${"x".repeat(245)}@example.com` }),
      ).ok,
    ).toBe(false);
    expect(
      validateStrategyCallSubmission(validSubmission({ phone: "1".repeat(31) })).ok,
    ).toBe(false);
  });

  it("rejects the hidden bot field", () => {
    expect(
      validateStrategyCallSubmission(
        validSubmission({ website: "https://spam.example" }),
      ).ok,
    ).toBe(false);
  });

  it("rejects oversized or binary form values", () => {
    expect(
      validateStrategyCallSubmission(validSubmission({ name: "x".repeat(513) })).ok,
    ).toBe(false);

    const binary = validSubmission();
    binary.set("attachment", new File(["content"], "payload.txt"));
    expect(validateStrategyCallSubmission(binary).ok).toBe(false);
  });

  it("keeps phone and booking source optional", () => {
    const result = validateStrategyCallSubmission(
      validSubmission({ phone: "", main_booking_source: "" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phone).toBeNull();
      expect(result.value.mainBookingSource).toBeNull();
    }
  });

  it("temporarily accepts the legacy challenge field as booking source", () => {
    const data = validSubmission({ main_booking_source: "" });
    data.set("challenge", "Website");
    const result = validateStrategyCallSubmission(data);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mainBookingSource).toBe("Website");
  });
});
