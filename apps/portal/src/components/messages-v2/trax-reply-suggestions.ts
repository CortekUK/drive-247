/**
 * Trax's suggested replies for the Messages composer.
 *
 * ── what this is today ──────────────────────────────────────────────────────
 *
 * Derived on the client from the conversation itself: the last message, who
 * sent it, and what it is about. No request, no model, nothing written — so it
 * costs nothing per keystroke and cannot fail. It reads the last customer
 * message for the handful of things renters actually write about (running
 * late, extending, return times, fuel, deposits, warning lights, invoices,
 * availability, a missed call) and answers in the operator's voice.
 *
 * ── the seam ────────────────────────────────────────────────────────────────
 *
 * `suggestReplies` is the ONE function the composer calls. When a real model
 * is wired (a `trax-reply-suggest` edge function with the thread as context),
 * it replaces this function's body and nothing in the composer changes.
 */

export interface SuggestInput {
  /** Oldest first, as the view renders them. */
  messages: { sender_type: "tenant" | "customer"; content: string; channel?: string | null }[];
  customerFirstName: string;
  mode: "in_app" | "sms";
}

type Rule = { test: RegExp; replies: (first: string) => string[] };

const RULES: Rule[] = [
  {
    test: /check engine|warning light|engine light|dashboard light|tyre|tire|flat|won'?t start|breakdown|broke down/i,
    replies: (f) => [
      `Thanks for letting me know, ${f}. Please pull over somewhere safe and send me a photo of the dashboard.`,
      `If the light is flashing, please stop driving and I'll arrange roadside assistance right away.`,
      `I'm calling you now so we can sort this out together.`,
    ],
  },
  {
    test: /extend|extension|keep (it|the car)|longer|until (mon|tue|wed|thu|fri|sat|sun)/i,
    replies: (f) => [
      `Of course, ${f}. I'll send you a payment link for the extra days now.`,
      `The car is free, so you're all set. I've updated your return date.`,
      `Happy to extend. How many more days would you like?`,
    ],
  },
  {
    test: /late|running behind|traffic|delayed/i,
    replies: (f) => [
      `No problem, ${f}. Drive safe, I'll be here when you arrive.`,
      `Thanks for the heads up. I'll hold the car for you.`,
      `All good. Just text me when you're about 10 minutes away.`,
    ],
  },
  {
    test: /return|drop (it|the car)? ?off|6 ?pm|5 ?pm|pm instead|airport/i,
    replies: (f) => [
      `That works, ${f}. I've moved your return time, nothing extra to pay.`,
      `Sure. Just leave the keys in the lockbox when you drop it off.`,
      `Let me check the schedule and confirm in a few minutes.`,
    ],
  },
  {
    test: /receipt|fuel|gas|tank|top(ped)? up/i,
    replies: (f) => [
      `Got it, thanks ${f}! I'll note it on your rental.`,
      `Thanks for topping up, that's all sorted.`,
      `Received, I'll make sure there's no fuel charge.`,
    ],
  },
  {
    test: /deposit|hold|refund/i,
    replies: (f) => [
      `Your deposit is released as soon as the car is checked in, ${f}.`,
      `It usually shows back on your card within 3 to 5 business days.`,
      `Let me check on that for you and come back shortly.`,
    ],
  },
  {
    test: /second driver|another driver|add (a )?driver|my (wife|husband|partner)/i,
    replies: (f) => [
      `Yes, ${f}. Send me their driver's license and I'll add them before pickup.`,
      `We do allow a second driver. I'll send you the form now.`,
    ],
  },
  {
    test: /invoice|paid|payment|charge/i,
    replies: (f) => [
      `Thanks, ${f}! Payment received.`,
      `Perfect, you're all settled. Thanks for renting with us.`,
      `Let me know if you need a copy of the receipt.`,
    ],
  },
  {
    test: /available|availability|free (this|next)|book|weekend/i,
    replies: (f) => [
      `It is available, ${f}! Want me to hold it for you?`,
      `Yes, those dates are open. I'll send you a booking link.`,
      `Let me check and get right back to you.`,
    ],
  },
  {
    test: /missed call|tried calling|call me/i,
    replies: (f) => [
      `Sorry I missed you, ${f}. Calling you back now.`,
      `I'm free now if you'd like to give me a call.`,
    ],
  },
  {
    test: /thank|thanks|perfect|great|awesome|got it|found it/i,
    replies: (f) => [
      `You're welcome, ${f}! Let me know if you need anything else.`,
      `Anytime. Enjoy the drive!`,
    ],
  },
];

const FALLBACK = (f: string) => [
  `Hi ${f}, thanks for your message. I'll get back to you shortly.`,
  `Got it, ${f}. Let me look into that for you.`,
  `Thanks ${f}! Is there anything else I can help with?`,
];

const FOLLOW_UP = (f: string) => [
  `Hi ${f}, just checking in. Is everything okay with the car?`,
  `Let me know if you need anything else, ${f}.`,
];

const FIRST_MESSAGE = (f: string) => [
  `Hi ${f}, thanks for booking with us! Let me know if you have any questions.`,
  `Hi ${f}, just reaching out about your rental.`,
];

/** SMS gets the shorter half of a long reply — a text should fit one segment. */
function fitChannel(text: string, mode: SuggestInput["mode"]): string {
  if (mode !== "sms" || text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export function suggestReplies({ messages, customerFirstName, mode }: SuggestInput): string[] {
  const first = customerFirstName || "there";
  const real = messages.filter((m) => m.channel !== "voice" && m.content?.trim());
  const last = messages[messages.length - 1];

  let replies: string[];
  if (!last) {
    replies = FIRST_MESSAGE(first);
  } else if (last.sender_type === "tenant") {
    replies = FOLLOW_UP(first);
  } else {
    /* Read the customer's latest burst (everything since the operator last
       spoke), newest first, so "Tried calling — the check engine light came
       on" is answered as the warning light, not as the missed call. */
    const burst: string[] = [];
    for (let i = messages.length - 1; i >= 0 && messages[i].sender_type === "customer"; i--) {
      burst.push(messages[i].channel === "voice" ? "missed call" : messages[i].content);
    }
    const text = burst.join(" \n ") || real[real.length - 1]?.content || "";
    replies = RULES.find((r) => r.test.test(text))?.replies(first) ?? FALLBACK(first);
  }
  return replies.map((r) => fitChannel(r, mode));
}
