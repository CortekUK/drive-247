import { strict as assert } from "node:assert";
import test from "node:test";
import {
  normalizeGhlBookingEvent,
  sanitizeProviderUrl,
  verifyWebhookAuthenticity,
} from "./core.ts";

async function signedMarketplaceFixture(rawBody: string) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    keyPair.privateKey,
    new TextEncoder().encode(rawBody)
  );
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const encodedKey = Buffer.from(publicKey).toString("base64");
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${encodedKey}\n-----END PUBLIC KEY-----`;

  return {
    publicKeyPem,
    signature: Buffer.from(signature).toString("base64"),
  };
}

test("normalizes the official nested AppointmentCreate payload", () => {
  const event = normalizeGhlBookingEvent(
    {
      type: "AppointmentCreate",
      locationId: "location-1",
      appointment: {
        id: "booking-1",
        calendarId: "calendar-1",
        contactId: "contact-1",
        appointmentStatus: "confirmed",
        startTime: "2026-08-20T14:00:00-04:00",
        endTime: "2026-08-20T14:20:00-04:00",
        dateAdded: "2026-08-15T12:00:00Z",
        dateUpdated: "2026-08-15T12:00:00Z",
      },
    },
    "delivery-1"
  );

  assert.equal(event?.eventType, "scheduled");
  assert.equal(event?.externalBookingId, "booking-1");
  assert.equal(event?.externalCalendarId, "calendar-1");
  assert.equal(event?.startsAt, "2026-08-20T18:00:00.000Z");
});

test("maps update lifecycle statuses and rejects an invalid interval", () => {
  const base = {
    type: "AppointmentUpdate",
    appointment: {
      id: "booking-1",
      appointmentStatus: "noshow",
      startTime: "2026-08-20T18:00:00Z",
      endTime: "2026-08-20T18:20:00Z",
      dateUpdated: "2026-08-20T18:30:00Z",
    },
  };
  assert.equal(normalizeGhlBookingEvent(base, "delivery-2")?.eventType, "no_show");
  assert.equal(
    normalizeGhlBookingEvent(
      {
        type: "AppointmentCreate",
        appointment: {
          ...base.appointment,
          appointmentStatus: "confirmed",
          endTime: base.appointment.startTime,
        },
      },
      "delivery-3"
    ),
    null
  );
});

test("maps cancellation and accepts only a valid non-secret session UUID", () => {
  const validSession = "7aa4ec08-202e-4b77-9f78-98f99161ab4a";
  const cancelled = normalizeGhlBookingEvent(
    {
      type: "AppointmentDelete",
      locationId: "location-1",
      strategyCallSessionId: validSession,
      appointment: {
        id: "booking-2",
        calendarId: "calendar-1",
        appointmentStatus: "cancelled",
        startTime: "2026-08-21T18:00:00Z",
        endTime: "2026-08-21T18:20:00Z",
        dateUpdated: "2026-08-16T10:00:00Z",
      },
    },
    "delivery-4"
  );
  assert.equal(cancelled?.eventType, "cancelled");
  assert.equal(cancelled?.sessionId, validSession);

  const terminalWithoutUsableInterval = normalizeGhlBookingEvent(
    {
      type: "AppointmentDelete",
      appointment: {
        id: "booking-existing",
        appointmentStatus: "cancelled",
        startTime: "2026-08-21T18:00:00Z",
        endTime: "2026-08-21T18:00:00Z",
        dateUpdated: "2026-08-16T10:00:00Z",
      },
    },
    "delivery-terminal"
  );
  assert.equal(terminalWithoutUsableInterval?.eventType, "cancelled");
  assert.equal(terminalWithoutUsableInterval?.startsAt, undefined);

  const malformedSession = normalizeGhlBookingEvent(
    {
      type: "AppointmentCreate",
      sessionId: "../../contact-id",
      appointment: {
        id: "booking-3",
        appointmentStatus: "confirmed",
        startTime: "2026-08-21T18:00:00Z",
        endTime: "2026-08-21T18:20:00Z",
        dateAdded: "2026-08-16T10:00:00Z",
      },
    },
    "delivery-5"
  );
  assert.equal(malformedSession?.sessionId, undefined);
  assert.equal(normalizeGhlBookingEvent({ unexpected: true }, "delivery-6"), null);
});

test("provider URLs require HTTPS and an explicitly approved host", () => {
  assert.equal(
    sanitizeProviderUrl("https://sub.leadconnectorhq.com/reschedule", [
      "leadconnectorhq.com",
    ]),
    "https://sub.leadconnectorhq.com/reschedule"
  );
  assert.equal(
    sanitizeProviderUrl("javascript:alert(1)", ["leadconnectorhq.com"]),
    undefined
  );
  assert.equal(
    sanitizeProviderUrl("https://evil.example/reschedule", ["leadconnectorhq.com"]),
    undefined
  );
  assert.equal(
    sanitizeProviderUrl("https://leadconnectorhq.com.evil.example/reschedule", [
      "leadconnectorhq.com",
    ]),
    undefined
  );
  assert.equal(
    sanitizeProviderUrl("http://leadconnectorhq.com/reschedule", [
      "leadconnectorhq.com",
    ]),
    undefined
  );
  assert.equal(
    sanitizeProviderUrl("https://user:pass@leadconnectorhq.com/reschedule", [
      "leadconnectorhq.com",
    ]),
    "https://leadconnectorhq.com/reschedule"
  );
});

test("verifies an Ed25519 Marketplace signature over the exact raw body", async () => {
  const rawBody = '{"type":"AppointmentCreate","value":"exact bytes"}';
  const fixture = await signedMarketplaceFixture(rawBody);
  const headers = new Headers({ "x-ghl-signature": fixture.signature });

  assert.equal(
    await verifyWebhookAuthenticity({
      rawBody,
      headers,
      mode: "marketplace",
      publicKeyPem: fixture.publicKeyPem,
    }),
    true
  );
  assert.equal(
    await verifyWebhookAuthenticity({
      rawBody: `${rawBody} `,
      headers,
      mode: "marketplace",
      publicKeyPem: fixture.publicKeyPem,
    }),
    false
  );
});

test("rejects absent, malformed, and N/A Marketplace signatures", async () => {
  for (const signature of [undefined, "not-base64!", "N/A"]) {
    const headers = new Headers();
    if (signature) headers.set("x-ghl-signature", signature);
    assert.equal(
      await verifyWebhookAuthenticity({
        rawBody: "{}",
        headers,
        mode: "marketplace",
      }),
      false
    );
  }
});

test("shared-secret verification is available only in explicit workflow mode", async () => {
  const headers = new Headers({
    "x-strategy-call-workflow-secret": "test-secret-value",
  });
  assert.equal(
    await verifyWebhookAuthenticity({
      rawBody: "{}",
      headers,
      mode: "workflow_shared_secret",
      workflowSecret: "test-secret-value",
    }),
    true
  );
  assert.equal(
    await verifyWebhookAuthenticity({ rawBody: "{}", headers, mode: "marketplace" }),
    false
  );
  assert.equal(
    await verifyWebhookAuthenticity({
      rawBody: "{}",
      headers,
      mode: "workflow_shared_secret",
      workflowSecret: "different-secret-value",
    }),
    false
  );
});
