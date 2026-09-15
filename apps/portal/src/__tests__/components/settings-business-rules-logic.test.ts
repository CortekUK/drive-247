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
  businessPageDirty,
  clampReminderHours,
  describeBuffer,
  describeDurationRange,
  describeHours,
  describeLeadHours,
  describeOffset,
  describeReminderLead,
  documentTypeOptions,
  hasErrors,
  leadTimeHours,
  lockboxMethodStatus,
  normalizeLoadedLead,
  savedFieldsFor,
  sendOffsetOptions,
  switchLeadUnit,
  validateCodeLength,
  validateDriverAge,
  validateDuration,
} from "@/components/settings-v2/business-rules-logic";

const AGE_MSG = "Enter an age between 16 and 99, or leave it blank for no minimum.";

describe("validateDriverAge", () => {
  it("treats blank as no minimum", () => {
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
