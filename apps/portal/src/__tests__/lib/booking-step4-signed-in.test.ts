import { describe, expect, it } from "vitest";
import { readRepoSource } from "../helpers/edge-source";

/**
 * Step 4 ("Your Details") shows a signed-in customer's name, email and phone
 * read-only. The step still requires a phone number, so a customer whose
 * account had none clicked "Continue to Review" and nothing happened: the
 * error belonged to a phone field that was not on screen.
 * See apps/booking/src/components/MultiStepBookingWidget.tsx.
 */
const widget = readRepoSource("apps/booking/src/components/MultiStepBookingWidget.tsx");

describe("signed-in customer with no phone number on their account", () => {
  it("still requires a phone number to continue", () => {
    expect(widget).toContain("newErrors.customerPhone = 'Please enter your phone number';");
  });

  it("gets a phone field on the read-only details card", () => {
    expect(widget).toMatch(
      /isCustomerDataPopulated && !formData\.customerPhone\)\s*\{\s*setAccountPhoneMissing\(true\);/,
    );
    const card = widget.slice(widget.indexOf("Authenticated User — Read-Only Details Card"), widget.indexOf("Guest User — Editable Form Fields"));
    expect(card).toContain("{accountPhoneMissing && (");
    expect(card).toContain("<PhoneInput");
    expect(card).toContain("savePhoneToProfile(value);");
    expect(card).toContain("{errors.customerPhone");
  });

  it("the field stays open once shown, so it cannot vanish mid-typing when the number autosaves", () => {
    expect(widget).not.toMatch(/setAccountPhoneMissing\(false\)/);
  });

  it("is told why the button did not move on, for any field the card hides", () => {
    expect(widget).toMatch(/const hiddenError = isAuthenticated && isCustomerDataPopulated/);
    expect(widget).toMatch(/\['customerName', 'customerEmail', 'customerPhone'\]/);
    expect(widget).toMatch(/if \(hiddenError\) \{\s*[\s\S]{0,200}toast\.error\(/);
  });
});
