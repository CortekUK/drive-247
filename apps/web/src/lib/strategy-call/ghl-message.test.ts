import { describe, expect, it } from "vitest";
import {
  getAllowedGhlOrigins,
  getGhlSessionQueryParam,
  isTrustedGhlCompletionMessage,
} from "./ghl-message";

describe("GHL completion message validation", () => {
  const calendarWindow = {} as Window;
  const allowedOrigins = new Set(["https://api.leadconnectorhq.com"]);

  it("accepts only the exact completion event from the calendar frame", () => {
    expect(isTrustedGhlCompletionMessage({
      data: ["msgsndr-booking-complete"],
      origin: "https://api.leadconnectorhq.com",
      source: calendarWindow,
    }, calendarWindow, allowedOrigins)).toBe(true);
  });

  it.each([
    ["wrong origin", "https://evil.example", calendarWindow, ["msgsndr-booking-complete"]],
    ["lookalike origin", "https://api.leadconnectorhq.com.evil.example", calendarWindow, ["msgsndr-booking-complete"]],
    ["HTTP origin", "http://api.leadconnectorhq.com", calendarWindow, ["msgsndr-booking-complete"]],
    ["origin with a different port", "https://api.leadconnectorhq.com:444", calendarWindow, ["msgsndr-booking-complete"]],
    ["wrong frame", "https://api.leadconnectorhq.com", {} as Window, ["msgsndr-booking-complete"]],
    ["null source", "https://api.leadconnectorhq.com", null, ["msgsndr-booking-complete"]],
    ["wrong event", "https://api.leadconnectorhq.com", calendarWindow, ["something-else"]],
    ["wrong shape", "https://api.leadconnectorhq.com", calendarWindow, "msgsndr-booking-complete"],
  ])("rejects %s", (_label, origin, source, data) => {
    expect(isTrustedGhlCompletionMessage({ data, origin, source }, calendarWindow, allowedOrigins)).toBe(false);
  });
});

describe("GHL public configuration", () => {
  it("keeps only exact HTTPS origins and includes the booking origin", () => {
    expect([...getAllowedGhlOrigins(
      "https://widgets.example.com/path,http://unsafe.example,invalid",
      "https://api.leadconnectorhq.com/widget/booking/id",
    )]).toEqual([
      "https://api.leadconnectorhq.com",
      "https://widgets.example.com",
    ]);
  });

  it("fails closed when no HTTPS origin is configured", () => {
    const frame = {} as Window;
    const emptyOrigins = getAllowedGhlOrigins(
      "http://unsafe.example,not a url",
      "http://api.leadconnectorhq.com/widget/booking/id",
    );

    expect([...emptyOrigins]).toEqual([]);
    expect(isTrustedGhlCompletionMessage({
      data: ["msgsndr-booking-complete"],
      origin: "https://api.leadconnectorhq.com",
      source: frame,
    }, frame, emptyOrigins)).toBe(false);
  });

  it.each(["session_id", "contactTracking-1", "custom_field"])(
    "accepts safe session parameter %s",
    (value) => expect(getGhlSessionQueryParam(value)).toBe(value),
  );

  it.each([undefined, "", "bad param", "?session", "x".repeat(65)])(
    "rejects unsafe session parameter %s",
    (value) => expect(getGhlSessionQueryParam(value)).toBeNull(),
  );
});
