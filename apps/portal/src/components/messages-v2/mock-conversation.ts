/**
 * Realistic conversation fixtures for reviewing the Messages UI.
 *
 * ── what this is, and what it deliberately is not ───────────────────────────
 *
 * DATA ONLY. Every state below renders through the same components a real
 * message does — the same `ChatMessage` shape, the same `channel`, the same
 * `metadata` keys the backend already writes (`booking_reference`,
 * `voice_call`, `attachments`) and the same `external_status` the SMS path
 * sets. So when the backend starts producing an inbound email or a failed SMS,
 * it already draws correctly; nothing here is a special rendering path that
 * would have to be rebuilt later.
 *
 * It writes nothing. No rows, no storage objects, no realtime traffic. It is
 * selected per-browser from /dev (see `lib/dev-overrides.ts`) and the real
 * conversation is one dropdown away at all times.
 *
 * ── why the content is specific ─────────────────────────────────────────────
 *
 * Lorem ipsum makes a layout look fine and hides every real problem: names that
 * wrap, a two-line subject, a message with a number in it that has to stay
 * scannable. These are the sentences a rental operator actually sends —
 * extensions, return times, deposits, fuel — so what is being judged is the
 * screen people will use.
 */

import type { ChatMessage } from "@/hooks/use-chat-messages";
import type { MessagesScenarioId } from "@/lib/dev-overrides";

/** Minutes/hours/days ago, so a fixture always reads as "just now"-ish. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const HOUR = 60;
const DAY = 24 * HOUR;

let seq = 0;
function msg(partial: Partial<ChatMessage> & { content: string }): ChatMessage {
  seq += 1;
  return {
    id: 900_000 + seq,
    channel_id: "mock",
    sender_type: "tenant",
    sender_id: "mock-user",
    is_read: true,
    read_at: null,
    metadata: {},
    created_at: ago(0),
    channel: "in_app",
    external_id: null,
    external_status: null,
    from_number: null,
    ...partial,
  };
}

const COROLLA = {
  id: "mock-rental-1",
  rentalNumber: "RNT-32A13B",
  status: "Active",
  startDate: new Date(Date.now() - 6 * DAY * 60_000).toISOString(),
  endDate: new Date(Date.now() + 8 * DAY * 60_000).toISOString(),
  vehicle: { make: "Toyota", model: "Corolla", reg: "NWD-1042" },
};

/* ── A. Active mixed conversation ────────────────────────────────────────── */
const MIXED = (): ChatMessage[] => [
  msg({
    content: "Hi Ada — your Corolla is ready for collection from 9am tomorrow. The bay number is 14.",
    created_at: ago(3 * DAY),
  }),
  msg({
    content: "Perfect, thank you. Is there parking near the office if I arrive early?",
    sender_type: "customer",
    created_at: ago(3 * DAY - 40),
  }),
  msg({
    content: "There is — the visitor bays on Mercer Street are free before 10am.",
    created_at: ago(3 * DAY - 55),
  }),
  msg({
    content: "Shared a booking",
    created_at: ago(2 * DAY),
    metadata: { type: "booking_reference", booking: COROLLA },
  }),
  /* A call, mid-conversation, as a timeline event rather than a bubble. */
  msg({
    content: "",
    channel: "voice",
    created_at: ago(2 * DAY - 90),
    metadata: { type: "voice_call", direction: "outgoing", outcome: "completed", duration_seconds: 272 },
  }),
  msg({
    content: "Just to confirm what we discussed: the extension runs to the 18th and the daily rate is unchanged.",
    channel: "sms",
    created_at: ago(2 * DAY - 95),
    external_status: "delivered",
  }),
  msg({
    content: "Got it, thanks for calling back so quickly.",
    sender_type: "customer",
    channel: "sms",
    created_at: ago(2 * DAY - 120),
  }),
  msg({
    content:
      "Hi Ada, your Toyota Corolla rental has been extended through September 18. The updated agreement is attached — no action needed unless something has changed at your end. Let me know if you need anything else.",
    channel: "email",
    created_at: ago(DAY),
    metadata: {
      subject: "Rental extension confirmation",
      attachments: [
        { name: "rental-agreement-RNT-32A13B.pdf", path: "mock/agreement.pdf", size: 284_113, mime: "application/pdf" },
      ],
    },
    external_status: "sent",
  }),
  msg({
    content: "Hi, can I return the vehicle around 6 PM instead of 4 PM? My meeting overran and I would rather not rush the drive back.",
    sender_type: "customer",
    channel: "email",
    created_at: ago(5 * HOUR),
    metadata: { subject: "Question about return time" },
  }),
  msg({
    content: "6pm is fine — I have moved the return slot. Nothing further to pay.",
    created_at: ago(4 * HOUR),
  }),
  msg({
    content: "Here is the fuel receipt from the top-up on Tuesday.",
    sender_type: "customer",
    created_at: ago(90),
    metadata: {
      attachments: [
        { name: "fuel-receipt-tuesday.jpg", path: "mock/receipt.jpg", size: 1_204_882, mime: "image/jpeg" },
      ],
    },
  }),
  msg({
    content: "Received, thank you. That is credited against the final invoice.",
    created_at: ago(72),
    is_read: false,
  }),
];

/* ── B. Email-heavy ──────────────────────────────────────────────────────── */
const EMAIL = (): ChatMessage[] => [
  msg({
    content:
      "Hi Marcus, thanks for the enquiry. The Corolla is available for the whole of that week and the weekly rate would be £245 including insurance. I have held it provisionally until Friday.",
    channel: "email",
    created_at: ago(4 * DAY),
    metadata: { subject: "Availability for 12–19 September" },
    external_status: "sent",
  }),
  msg({
    content:
      "That works. Could you send the agreement over so I can read it before I commit? Also — is a second driver included at that price?",
    sender_type: "customer",
    channel: "email",
    created_at: ago(3 * DAY),
    metadata: { subject: "Re: Availability for 12–19 September" },
  }),
  msg({
    content:
      "Agreement attached. A second driver is £8 a day; I have left it off for now so the figure you see is the base. Say the word and I will add it.",
    channel: "email",
    created_at: ago(3 * DAY - 30),
    metadata: {
      subject: "Re: Availability for 12–19 September",
      attachments: [
        { name: "agreement-draft.pdf", path: "mock/draft.pdf", size: 198_442, mime: "application/pdf" },
        { name: "insurance-summary.pdf", path: "mock/ins.pdf", size: 96_120, mime: "application/pdf" },
      ],
    },
    external_status: "sent",
  }),
  msg({
    content: "Read it through, all looks fine. Please add the second driver — my wife will share the driving.",
    sender_type: "customer",
    channel: "email",
    created_at: ago(2 * DAY),
    metadata: { subject: "Re: Availability for 12–19 September" },
    is_read: false,
  }),
];

/* ── C. Call history ─────────────────────────────────────────────────────── */
const CALLS = (): ChatMessage[] => [
  msg({
    content: "",
    channel: "voice",
    created_at: ago(3 * DAY),
    metadata: { type: "voice_call", direction: "incoming", outcome: "completed", duration_seconds: 412 },
  }),
  msg({
    content: "Following up on your call — I have emailed the damage report through.",
    created_at: ago(3 * DAY - 20),
  }),
  msg({
    content: "",
    channel: "voice",
    created_at: ago(2 * DAY),
    metadata: { type: "voice_call", direction: "outgoing", outcome: "missed" },
  }),
  msg({
    content: "",
    channel: "voice",
    created_at: ago(DAY),
    metadata: { type: "voice_call", direction: "incoming", outcome: "missed" },
  }),
  msg({
    content: "Sorry I missed you twice — I am free after 2pm today if that suits.",
    sender_type: "customer",
    channel: "sms",
    created_at: ago(DAY - 15),
  }),
  msg({
    content: "",
    channel: "voice",
    created_at: ago(3 * HOUR),
    metadata: { type: "voice_call", direction: "outgoing", outcome: "completed", duration_seconds: 96 },
  }),
];

/* ── D. Failed send ──────────────────────────────────────────────────────── */
const FAILED = (): ChatMessage[] => [
  msg({
    content: "Morning Priya — quick reminder that the Tiguan is due back today at 4pm.",
    created_at: ago(5 * HOUR),
  }),
  msg({
    content: "Your deposit of £250 has been released and should be back with you in 3–5 working days.",
    channel: "sms",
    created_at: ago(2 * HOUR),
    /* The SMS path already writes external_status; 'failed' is the value the
       renderer keys on, so a real Twilio failure will draw exactly like this. */
    external_status: "failed",
  }),
  msg({
    content: "Thanks — nothing has arrived yet but I will keep an eye out.",
    sender_type: "customer",
    created_at: ago(80),
    is_read: false,
  }),
];

const SCENARIOS: Record<Exclude<MessagesScenarioId, "off">, () => ChatMessage[]> = {
  mixed: MIXED,
  email: EMAIL,
  calls: CALLS,
  failed: FAILED,
  empty: () => [],
};

/**
 * The messages for a scenario, oldest first — the order `useChatMessages`
 * returns, so the view sorts and groups them identically.
 */
export function mockMessages(scenario: MessagesScenarioId): ChatMessage[] {
  if (scenario === "off") return [];
  seq = 0;
  const build = SCENARIOS[scenario];
  return build ? build() : [];
}
