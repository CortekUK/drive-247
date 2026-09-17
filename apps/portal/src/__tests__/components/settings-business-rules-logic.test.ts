/**
 * v2 Settings, Business rules: the pure state logic in
 * `components/settings-v2/business-rules-logic.ts`.
 *
 * Every expected value below was worked out by hand from the rule it pins
 * (e.g. 36 hours is 1.5 days, 161 GSM characters is ceil(161/153) = 2 texts),
 * not copied from a run of the code.
 */

import { describe, it, expect } from "vitest";
import {
  BUSINESS_FORM_KEYS,
  BUSINESS_SECTION_KEYS,
  businessEditsCoveredBySections,
  businessPageDirty,
  clampReminderHours,
  describeBuffer,
  describeDriverAge,
  describeDurationRange,
  describeHours,
  describeLeadHours,
  describeOffset,
  describeReminderLead,
  documentTypeOptions,
  hasErrors,
  keepUnsavedBusinessEdits,
  leadTimeHours,
  lockboxMethodStatus,
  normalizeLoadedLead,
  numberBoxWidth,
  reminderHoursRangeNote,
  renderLockboxSmsExample,
  savedFieldsFor,
  sendOffsetOptions,
  switchLeadUnit,
  validateCodeLength,
  validateDriverAge,
  validateDuration,
} from "@/components/settings-v2/business-rules-logic";

const AGE_MSG = "Enter an age between 16 and 99, or leave it blank to use the booking site's default of 21.";

describe("validateDriverAge", () => {
  it("accepts blank (the booking site's default applies)", () => {
    expect(validateDriverAge("")).toBeNull();
    expect(validateDriverAge(null)).toBeNull();
    expect(validateDriverAge(undefined)).toBeNull();
  });

  it("accepts the edges and a normal age", () => {
    expect(validateDriverAge(16)).toBeNull();
    expect(validateDriverAge(21)).toBeNull();
    expect(validateDriverAge(99)).toBeNull();
  });

  it("refuses 0, under 16, over 99 and fractions", () => {
    expect(validateDriverAge(0)).toBe(AGE_MSG);
    expect(validateDriverAge(15)).toBe(AGE_MSG);
    expect(validateDriverAge(100)).toBe(AGE_MSG);
    expect(validateDriverAge(21.5)).toBe(AGE_MSG);
  });
});

describe("documentTypeOptions", () => {
  it("keeps the three known types", () => {
    expect(documentTypeOptions("passport")).toHaveLength(3);
    expect(documentTypeOptions(null)).toHaveLength(3);
  });

  it("adds an unknown stored type so the select is never blank", () => {
    const options = documentTypeOptions("residence_permit");
    expect(options).toHaveLength(4);
    expect(options[3]).toEqual({ value: "residence_permit", label: "Residence permit (current)" });
  });
});

describe("advance notice units", () => {
  it("stores hours: 2 days is 48, 1.5 days is 36", () => {
    expect(leadTimeHours(2, "days")).toBe(48);
    expect(leadTimeHours(1.5, "days")).toBe(36);
    expect(leadTimeHours(36, "hours")).toBe(36);
    expect(leadTimeHours(Number.NaN, "hours")).toBe(0);
  });

  it("shows a non-whole number of days in hours", () => {
    expect(normalizeLoadedLead(1.5, "days")).toEqual({ value: 36, unit: "hours" });
    expect(normalizeLoadedLead(2, "days")).toEqual({ value: 2, unit: "days" });
    expect(normalizeLoadedLead(36, "hours")).toEqual({ value: 36, unit: "hours" });
  });

  it("refuses a lossy switch to days instead of rounding 36 hours to 48", () => {
    expect(switchLeadUnit(36, "days")).toEqual({
      value: 36,
      unit: "hours",
      blocked: "36 hours isn't a whole number of days, so it stays in hours.",
    });
    expect(switchLeadUnit(1, "days").blocked).toBe("1 hour isn't a whole number of days, so it stays in hours.");
    expect(switchLeadUnit(48, "days")).toEqual({ value: 2, unit: "days", blocked: null });
    expect(switchLeadUnit(48, "hours")).toEqual({ value: 48, unit: "hours", blocked: null });
  });

  it("explains hours in days from 24 up", () => {
    expect(describeLeadHours(36, "hours")).toBe("= 1.5 days");
    expect(describeLeadHours(24, "hours")).toBe("= 1 day");
    expect(describeLeadHours(23, "hours")).toBeNull();
    expect(describeLeadHours(48, "days")).toBeNull();
  });
});

describe("validateDuration", () => {
  const valid = { leadHours: 24, minDays: 0, minHours: 4, maxDays: 90, bufferMinutes: 30 };

  it("passes a normal configuration", () => {
    expect(validateDuration(valid)).toEqual({});
    expect(hasErrors(validateDuration(valid))).toBe(false);
  });

  it("advance notice: at least 1 hour, at most 8,760", () => {
    expect(validateDuration({ ...valid, leadHours: 0 }).lead).toBe("Must be at least 1 hour.");
    expect(validateDuration({ ...valid, leadHours: 8760 }).lead).toBeUndefined();
    expect(validateDuration({ ...valid, leadHours: 8761 }).lead).toBe("Keep this to 365 days (8,760 hours) or less.");
  });

  it("shortest rental: hours 0-23 and a total of at least 1 hour", () => {
    expect(validateDuration({ ...valid, minHours: 0 }).min).toBe("Must be at least 1 hour.");
    expect(validateDuration({ ...valid, minHours: 24 }).min).toBe("Hours must be 0–23. Put whole days in the days box.");
  });

  it("longest rental: blank is not 90 any more, and it must cover the shortest", () => {
    expect(validateDuration({ ...valid, maxDays: 0 }).max).toBe("Enter the longest rental, in days.");
    expect(validateDuration({ ...valid, maxDays: 3651 }).max).toBe("Keep this to 3,650 days (10 years) or less.");
    // 10 days = 240 hours > 7 days = 168 hours
    expect(validateDuration({ ...valid, minDays: 10, minHours: 0, maxDays: 7 }).max).toBe(
      "The shortest rental is longer than the longest.",
    );
    // 7 days = 168 hours is not longer than 168 hours
    expect(validateDuration({ ...valid, minDays: 7, minHours: 0, maxDays: 7 })).toEqual({});
  });

  it("reports only the shortest-rental error when that one is already wrong", () => {
    expect(validateDuration({ ...valid, minHours: 30, maxDays: 1 })).toEqual({
      min: "Hours must be 0–23. Put whole days in the days box.",
    });
  });

  it("buffer: at most 4,320 minutes", () => {
    expect(validateDuration({ ...valid, bufferMinutes: 4320 }).buffer).toBeUndefined();
    expect(validateDuration({ ...valid, bufferMinutes: 4321 }).buffer).toBe("Keep this to 4,320 minutes (3 days) or less.");
  });

  it("hasErrors ignores empty keys", () => {
    expect(hasErrors({ lead: undefined })).toBe(false);
    expect(hasErrors({ lead: "x" })).toBe(true);
  });
});

describe("duration copy", () => {
  it("describes hours and days", () => {
    expect(describeHours(1)).toBe("1 hour");
    expect(describeHours(4)).toBe("4 hours");
    expect(describeHours(24)).toBe("1 day");
    expect(describeHours(30)).toBe("1 day 6 hours");
    expect(describeHours(49)).toBe("2 days 1 hour");
  });

  it("summarises the bookable range", () => {
    expect(describeDurationRange(4, 90)).toBe("Customers can book from 4 hours up to 90 days.");
    expect(describeDurationRange(24, 1)).toBe("Customers can book from 1 day up to 1 day.");
  });

  it("formats the buffer", () => {
    expect(describeBuffer(90)).toBe("1h 30m");
    expect(describeBuffer(45)).toBe("45m");
    expect(describeBuffer(120)).toBe("2h");
    expect(describeBuffer(0)).toBe("");
  });
});

describe("lockbox", () => {
  const CODE_MSG = "Enter 1–20 digits, or leave it blank for any length.";

  it("code length: blank is any length; 1-20 only", () => {
    expect(validateCodeLength(null)).toBeNull();
    expect(validateCodeLength("")).toBeNull();
    expect(validateCodeLength(1)).toBeNull();
    expect(validateCodeLength(6)).toBeNull();
    expect(validateCodeLength(20)).toBeNull();
    expect(validateCodeLength(0)).toBe(CODE_MSG);
    expect(validateCodeLength(21)).toBe(CODE_MSG);
    expect(validateCodeLength(-5)).toBe(CODE_MSG);
    expect(validateCodeLength(4.5)).toBe(CODE_MSG);
  });

  it("method status: email is always fine", () => {
    expect(lockboxMethodStatus(["email"], { smsReady: false })).toEqual({ method: "email", extraSaved: [], warning: null });
    expect(lockboxMethodStatus(null, { smsReady: false }).method).toBe("email");
  });

  it("method status: text without Twilio is a real risk", () => {
    expect(lockboxMethodStatus(["sms"], { smsReady: true }).warning).toBeNull();
    const status = lockboxMethodStatus(["sms"], { smsReady: false });
    expect(status.warning?.title).toBe("Text messages aren't set up");
    expect(status.warning?.needsTwilio).toBe(true);
  });

  it("method status: WhatsApp is retired and falls back to email", () => {
    const status = lockboxMethodStatus(["whatsapp"], { smsReady: true });
    expect(status.warning?.title).toBe("WhatsApp codes aren't sent any more");
    expect(status.warning?.needsTwilio).toBe(false);
    expect(lockboxMethodStatus(["pigeon"], { smsReady: true }).warning?.title).toBe('We can\'t send codes by "pigeon"');
  });

  it("method status: lists the other methods of a legacy array once", () => {
    // slice(1) = [sms, sms, email] -> unique [sms, email] -> without the shown method -> [sms]
    expect(lockboxMethodStatus(["email", "sms", "sms", "email"], { smsReady: true }).extraSaved).toEqual(["sms"]);
  });

  it("describes send offsets", () => {
    expect(describeOffset(0)).toBe("Straight away");
    expect(describeOffset(1)).toBe("1 minute after");
    expect(describeOffset(5)).toBe("5 minutes after");
    expect(describeOffset(60)).toBe("1 hour after");
    expect(describeOffset(90)).toBe("1 hour 30 minutes after");
    expect(describeOffset(120)).toBe("2 hours after");
  });

  it("keeps a stored offset that is not a preset visible", () => {
    expect(sendOffsetOptions(null)).toHaveLength(7);
    expect(sendOffsetOptions(30)).toHaveLength(7);
    expect(sendOffsetOptions(0)).toHaveLength(7);
    const withCurrent = sendOffsetOptions(45);
    expect(withCurrent).toHaveLength(8);
    expect(withCurrent[7]).toEqual({ value: "45", label: "45 minutes after (current)" });
  });
});

describe("return reminder hours", () => {
  it("keeps the last valid value for a blank box", () => {
    expect(clampReminderHours("", 24)).toEqual({ value: 24, note: "Enter 1–168 hours. Kept 24 hours." });
    expect(clampReminderHours("", 1)).toEqual({ value: 1, note: "Enter 1–168 hours. Kept 1 hour." });
  });

  it("clamps to 1-168 and says so", () => {
    expect(clampReminderHours("0", 24)).toEqual({
      value: 1,
      note: "Reminders go out at least 1 hour before return, so this is now 1.",
    });
    expect(clampReminderHours("200", 24)).toEqual({
      value: 168,
      note: "Reminders go out at most 168 hours (7 days) before return, so this is now 168.",
    });
  });

  it("leaves a valid value alone", () => {
    expect(clampReminderHours("1", 24)).toEqual({ value: 1, note: null });
    expect(clampReminderHours("48", 24)).toEqual({ value: 48, note: null });
    expect(clampReminderHours("168", 24)).toEqual({ value: 168, note: null });
  });

  it("flags a stored value outside 1–168 on load, formatted, and nothing inside the range", () => {
    expect(reminderHoursRangeNote(9999)).toBe(
      "The saved value, 9,999 hours, is outside the allowed 1–168 hours (7 days). Enter a value in that range and save.",
    );
    expect(reminderHoursRangeNote(0)).toBe(
      "The saved value, 0 hours, is outside the allowed 1–168 hours (7 days). Enter a value in that range and save.",
    );
    expect(reminderHoursRangeNote(169)).toContain("169 hours");
    expect(reminderHoursRangeNote(1)).toBeNull();
    expect(reminderHoursRangeNote(168)).toBeNull();
    expect(reminderHoursRangeNote(null)).toBeNull();
    expect(reminderHoursRangeNote(Number.NaN)).toBeNull();
  });

  it("describes the lead", () => {
    expect(describeReminderLead(5)).toBe("5 hours");
    expect(describeReminderLead(24)).toBe("1 day");
    expect(describeReminderLead(30)).toBe("1 day 6 hours");
    expect(describeReminderLead(168)).toBe("7 days");
  });
});

describe("businessPageDirty + savedFieldsFor", () => {
  it("is never dirty without saved settings", () => {
    expect(businessPageDirty("requirements", { minimum_rental_age: 30 }, null)).toBe(false);
  });

  it("requirements", () => {
    const saved = { minimum_rental_age: 21, verification_document_type: "passport" };
    const form = savedFieldsFor("requirements", saved);
    expect(form).toEqual({ minimum_rental_age: 21, verification_document_type: "passport" });
    expect(businessPageDirty("requirements", form, saved)).toBe(false);
    expect(businessPageDirty("requirements", { ...form, minimum_rental_age: 25 }, saved)).toBe(true);
    // null age loads as "" and a null document type as the licence
    expect(businessPageDirty("requirements", { minimum_rental_age: "", verification_document_type: "driving_license" }, {})).toBe(false);
  });

  it("duration: a 36-hour notice stored in days is not an edit when shown in hours", () => {
    const saved = {
      booking_lead_time_hours: 36,
      booking_lead_time_unit: "days",
      min_rental_days: 1,
      min_rental_hours: 0,
      max_rental_days: 30,
      buffer_time_minutes: 60,
    };
    const form = savedFieldsFor("duration", saved);
    expect(form.booking_lead_time_value).toBe(1.5);
    expect(businessPageDirty("duration", form, saved)).toBe(false);
    const shownInHours = { ...form, booking_lead_time_unit: "hours", booking_lead_time_value: 36 };
    expect(businessPageDirty("duration", shownInHours, saved)).toBe(false);
    expect(businessPageDirty("duration", { ...shownInHours, booking_lead_time_value: 48 }, saved)).toBe(true);
  });

  it("duration: the same hours in a different unit IS an edit when both are whole days", () => {
    const saved = { booking_lead_time_hours: 48, booking_lead_time_unit: "days" };
    const form = { ...savedFieldsFor("duration", saved), booking_lead_time_unit: "hours", booking_lead_time_value: 48 };
    expect(businessPageDirty("duration", form, saved)).toBe(true);
  });

  it("duration: null columns load as the defaults and are clean", () => {
    const form = savedFieldsFor("duration", {});
    expect(form).toEqual({
      booking_lead_time_unit: "hours",
      booking_lead_time_value: 24,
      min_rental_days: 0,
      min_rental_hours: 1,
      max_rental_days: 90,
      buffer_time_minutes: 0,
    });
    expect(businessPageDirty("duration", form, {})).toBe(false);
  });

  it("lockbox: compares the shown method, not the whole legacy array", () => {
    const saved = {
      lockbox_enabled: true,
      lockbox_code_length: 6,
      lockbox_notification_methods: ["email", "sms"],
      lockbox_send_offset_minutes: 45,
    };
    const form = savedFieldsFor("lockbox", saved);
    expect(businessPageDirty("lockbox", form, saved)).toBe(false);
    expect(businessPageDirty("lockbox", { ...form, lockbox_notification_methods: ["email"] }, saved)).toBe(false);
    expect(businessPageDirty("lockbox", { ...form, lockbox_notification_methods: ["sms"] }, saved)).toBe(true);
    expect(businessPageDirty("lockbox", { ...form, lockbox_send_offset_minutes: null }, saved)).toBe(true);
  });

  it("return reminder", () => {
    const form = savedFieldsFor("return-reminder", {});
    expect(form).toEqual({ return_reminder_enabled: false, return_reminder_hours: 24 });
    expect(businessPageDirty("return-reminder", form, {})).toBe(false);
    expect(businessPageDirty("return-reminder", { ...form, return_reminder_enabled: true }, {})).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Finish pass: blank-age copy, lockbox SMS estimate, sibling-save merge       */
/* -------------------------------------------------------------------------- */

describe("describeDriverAge", () => {
  // The booking form falls back to 21 when no age is saved
  // (apps/booking MultiStepBookingWidget validateStep4: `|| 21`), so blank must
  // never be described as "no minimum".
  it("says a blank age means the booking site's default of 21", () => {
    const blank = "No age is set, so your booking site uses its default: drivers must be at least 21. Enter an age to set your own.";
    expect(describeDriverAge("")).toBe(blank);
    expect(describeDriverAge(null)).toBe(blank);
    expect(describeDriverAge(undefined)).toBe(blank);
  });

  it("says where a set age is enforced", () => {
    expect(describeDriverAge(25)).toBe("The booking form checks each driver's date of birth against this. Younger drivers can't book.");
  });
});

describe("renderLockboxSmsExample", () => {
  const DEFAULT_SMS = "Your vehicle {{vehicle_reg}} has been delivered. Lockbox code: {{lockbox_code}}. Ref: {{booking_ref}}";

  it("fills the default text message with example values and the tenant's code length", () => {
    const out = renderLockboxSmsExample(DEFAULT_SMS, { codeLength: 6 });
    expect(out).toBe("Your vehicle ABC-1234 has been delivered. Lockbox code: 123456. Ref: BK-104233");
    // Counted by hand, piece by piece:
    //   "Your vehicle " 13 + "ABC-1234" 8 + " has been delivered. Lockbox code: " 35
    //   + "123456" 6 + ". Ref: " 7 + "BK-104233" 9
    expect(out.length).toBe(13 + 8 + 35 + 6 + 7 + 9);
    // The raw template is 13 + 15 + 35 + 16 + 7 + 15 = 101 characters, so the old counter read 23 too high.
    expect(DEFAULT_SMS.length).toBe(13 + 15 + 35 + 16 + 7 + 15);
  });

  it("uses a 4-digit code when no valid length is set (what Generate makes)", () => {
    expect(renderLockboxSmsExample("{{lockbox_code}}")).toBe("1234");
    expect(renderLockboxSmsExample("{{lockbox_code}}", { codeLength: null })).toBe("1234");
    expect(renderLockboxSmsExample("{{lockbox_code}}", { codeLength: 0 })).toBe("1234");
    expect(renderLockboxSmsExample("{{lockbox_code}}", { codeLength: 25 })).toBe("1234");
    expect(renderLockboxSmsExample("{{lockbox_code}}", { codeLength: 20 })).toBe("12345678901234567890");
  });

  it("fills the default instructions, blanks odometer and notes, and leaves unknown tokens as typed", () => {
    expect(renderLockboxSmsExample("[{{default_instructions}}]", { defaultInstructions: "Box on the left" })).toBe("[Box on the left]");
    expect(renderLockboxSmsExample("a{{odometer}}b{{notes}}c")).toBe("abc");
    expect(renderLockboxSmsExample("Hi {{nickname}}")).toBe("Hi {{nickname}}");
    expect(renderLockboxSmsExample("{{customer_name}}, {{vehicle_name}} at {{delivery_address}} ({{lockbox_instructions}})")).toBe(
      "Jordan Smith, Toyota Camry at 221B Baker Street, London (Rear left wheel arch)",
    );
  });

  it("gets a message over one text right: 154 letters + space + 6-digit code = 161", () => {
    const out = renderLockboxSmsExample(`${"a".repeat(154)} {{lockbox_code}}`, { codeLength: 6 });
    expect(out.length).toBe(161);
  });
});

describe("keepUnsavedBusinessEdits", () => {
  it("takes the fresh row whole on the first fill", () => {
    const next = { lockbox_enabled: true, tax_percentage: 5 };
    expect(keepUnsavedBusinessEdits({ lockbox_enabled: false, tax_percentage: 0 }, null, next)).toBe(next);
  });

  it("keeps an unsaved business edit when another section's save refreshes the row", () => {
    // Operator switched lockbox on (unsaved); saving the instructions refreshed the row.
    const lastSynced = { lockbox_enabled: false, lockbox_notification_methods: ["email"], tax_percentage: 5 };
    const current = { lockbox_enabled: true, lockbox_notification_methods: ["email"], tax_percentage: 5 };
    const next = { lockbox_enabled: false, lockbox_notification_methods: ["sms"], tax_percentage: 7 };
    expect(keepUnsavedBusinessEdits(current, lastSynced, next)).toEqual({
      lockbox_enabled: true, // edited, kept
      lockbox_notification_methods: ["sms"], // untouched (a new array equal to the old one), fresh value
      tax_percentage: 7, // untouched, fresh value
    });
  });

  it("never holds on to a field outside the business pages (v1 behaviour for pricing and fees)", () => {
    const out = keepUnsavedBusinessEdits({ tax_percentage: 9, min_rental_days: 0 }, { tax_percentage: 5, min_rental_days: 0 }, { tax_percentage: 7, min_rental_days: 2 });
    expect(out).toEqual({ tax_percentage: 7, min_rental_days: 2 });
  });

  it("after the edited section saves, the kept value is the saved value", () => {
    const out = keepUnsavedBusinessEdits({ max_rental_days: 30 }, { max_rental_days: 90 }, { max_rental_days: 30 });
    expect(out).toEqual({ max_rental_days: 30 });
  });

  it("covers exactly the fields the business pages save and discard", () => {
    const pages = ["requirements", "duration", "lockbox", "return-reminder"] as const;
    const owned = pages.flatMap((page) => Object.keys(savedFieldsFor(page, {}))).sort();
    expect([...BUSINESS_FORM_KEYS].sort()).toEqual(owned);
  });
});

describe("businessEditsCoveredBySections (v2 Save & Leave)", () => {
  // What the page last filled in from the tenant row, in the form's shape.
  const synced = {
    ...savedFieldsFor("requirements", { minimum_rental_age: 21, verification_document_type: "passport" }),
    ...savedFieldsFor("duration", { booking_lead_time_hours: 24, min_rental_days: 0, min_rental_hours: 4, max_rental_days: 90, buffer_time_minutes: 0 }),
    ...savedFieldsFor("lockbox", { lockbox_enabled: false }),
    ...savedFieldsFor("return-reminder", { return_reminder_enabled: true, return_reminder_hours: 24 }),
    tax_percentage: 5,
    installment_config: { grace_period_days: 3 },
  };
  const saved = {
    minimum_rental_age: 21,
    verification_document_type: "passport",
    booking_lead_time_hours: 24,
    min_rental_days: 0,
    min_rental_hours: 4,
    max_rental_days: 90,
    buffer_time_minutes: 0,
    lockbox_enabled: false,
    return_reminder_enabled: true,
    return_reminder_hours: 24,
    tax_percentage: 5,
  };

  it("uses the keys the pages register under", () => {
    expect(BUSINESS_SECTION_KEYS).toEqual({
      requirements: "business-requirements",
      duration: "business-duration",
      lockbox: "business-lockbox",
      "return-reminder": "business-return-reminder",
    });
  });

  it("covers an age edit once Driver requirements has registered its save", () => {
    const form = { ...synced, minimum_rental_age: 30 };
    expect(businessEditsCoveredBySections(form, synced, saved, ["business-requirements"])).toBe(true);
    expect(businessEditsCoveredBySections(form, synced, saved, [])).toBe(false);
    expect(businessEditsCoveredBySections(form, synced, saved, ["business-duration"])).toBe(false);
  });

  it("needs every dirty business page registered", () => {
    const form = { ...synced, minimum_rental_age: 30, lockbox_enabled: true };
    expect(businessEditsCoveredBySections(form, synced, saved, ["business-requirements"])).toBe(false);
    expect(businessEditsCoveredBySections(form, synced, saved, ["business-requirements", "business-lockbox"])).toBe(true);
  });

  it("never covers a field no business page saves (a fee, an installment rule)", () => {
    const registered = Object.values(BUSINESS_SECTION_KEYS);
    expect(businessEditsCoveredBySections({ ...synced, minimum_rental_age: 30, tax_percentage: 9 }, synced, saved, registered)).toBe(false);
    expect(
      businessEditsCoveredBySections({ ...synced, installment_config: { grace_period_days: 5 } }, synced, saved, registered),
    ).toBe(false);
  });

  it("is false until the page has filled the form in", () => {
    expect(businessEditsCoveredBySections(synced, null, saved, ["business-requirements"])).toBe(false);
    expect(businessEditsCoveredBySections(synced, synced, null, ["business-requirements"])).toBe(false);
  });
});

describe("numberBoxWidth", () => {
  it("keeps the normal width for anything typeable and widens for a longer stored value", () => {
    expect(numberBoxWidth("", "w-20")).toBe("w-20");
    expect(numberBoxWidth(null, "w-16")).toBe("w-16");
    expect(numberBoxWidth(3650, "w-16")).toBe("w-16");
    expect(numberBoxWidth(-5, "w-16")).toBe("w-16");
    expect(numberBoxWidth(99999, "w-20")).toBe("w-24");
    expect(numberBoxWidth(999999, "w-20")).toBe("w-24");
    expect(numberBoxWidth(9999999, "w-20")).toBe("w-32");
  });
});
