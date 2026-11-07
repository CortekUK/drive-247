/*
 * What Trax says on the landing-page tour, stop by stop, top to bottom.
 *
 * On the hero Trax sits in the corner and says hello (HELLO). Below the hero the corner
 * belongs to "Start free trial", and Trax comes up inside the sections instead, pointing at
 * the part of the screen it's talking about (trax-pointer.tsx). Only stops with a `point`
 * do that; for now (Ghulam, 2026-11-07) that is the "Your own" rows, to get one section
 * right before the rest of the page follows. The other stops keep their lines for then.
 *
 * Every line restates what the section itself already says, so the tour never claims more
 * than the page: check a new line against its section's own copy.
 *
 * Trax speaks in the first person, and never with emojis. "We" is the Drive247 team.
 *
 * Targets are plain selectors on the sections' own markup (ids, h2 ids, existing classes), so
 * nothing in the sections has to know about the tour. A stop whose target isn't on the page,
 * like the customer stories outside development, is simply skipped.
 */

export type TourContext = { trialDays: number };

/*
 * Where Trax points, inside the stop's target (a row, say): an element in it, or a part of
 * a screenshot in it, as shares of that screen's width and height (x, y from its top left,
 * w, h the size), so it stays on the same part at any width. A ring marks it, and Trax's
 * note sits on `side` of it.
 */
export type TourPoint = {
  text: string;
  at: { selector: string } | { screen: string; x: number; y: number; w: number; h: number };
  side: "above" | "below" | "right" | "left";
};

export type TourStop = {
  id: string;
  /** The part of the page, shown small above Trax's words. */
  label: string;
  text: string | ((context: TourContext) => string);
  /** The element this stop explains. */
  target: string;
  /**
   * Where on the target the stop sits: just above its first words or content ("head", the
   * default), just above its top edge ("top"), or at its middle ("middle").
   */
  at?: "head" | "top" | "middle";
  /**
   * For a section that holds still while you scroll: its track, how far through the hold this
   * stop comes, and, if the section marks its own active part, the selector that says this
   * stop's part is the one showing. Used only while the track is holding.
   */
  held?: { track: string; share: number; activeWhen?: string };
  /** Buttons under the words. */
  actions?: "tour" | "trial";
  /** False where the section draws its own marker on the line. */
  node?: boolean;
  /** Trax comes up in the section and points here. */
  point?: TourPoint;
};

/* The greeting, before the first stop. */
export const HELLO = {
  id: "hello",
  label: "Hi there",
  text: "Hi, I'm Trax. Let me walk you through Drive247. Scroll down, and I'll explain each part as we get to it.",
  actions: "tour" as const,
};

export const TOUR: TourStop[] = [
  // "Your own": the four rows, each with its own dot on the features thread.
  {
    id: "domain",
    label: "Your own domain",
    text: "First, your own web address. Renters book at a domain you own, like yourrentals.com, so every link and every ad brings them back to you.",
    target: "#features .pg-row:nth-child(1)",
    at: "middle",
    node: false,
    point: {
      text: "Up here: that's your own web address. Renters see yourrentals.com, not us.",
      at: { selector: ".pg-url-label" },
      side: "above",
    },
  },
  {
    id: "site",
    label: "Your booking site",
    text: "This is your booking site: your brand and your cars, with online booking and payments built in. You edit it yourself, no developer needed.",
    target: "#features .pg-row:nth-child(2)",
    at: "middle",
    node: false,
    point: {
      text: "This is where your renters book: dates, car and checkout, all under your name.",
      at: { screen: ".pg-screen", x: 0.32, y: 0.12, w: 0.36, h: 0.27 },
      side: "above",
    },
  },
  {
    id: "portal",
    label: "Your portal",
    text: "And this is your portal, where you run the business. Rentals, money, fleet and to-dos sit in one place. It's where I live, too.",
    target: "#features .pg-row:nth-child(3)",
    at: "middle",
    node: false,
    point: {
      text: "Your whole business on one screen. And that's me, right there, with today's brief.",
      at: { screen: ".pg-screen", x: 0.185, y: 0.375, w: 0.255, h: 0.56 },
      side: "above",
    },
  },
  {
    id: "renters",
    label: "Your renters' portal",
    text: "Your renters get a portal of their own on your site, with their bookings, payments, agreements and documents. Fewer calls asking where things are.",
    target: "#features .pg-row:nth-child(4)",
    at: "middle",
    node: false,
    point: {
      text: "Your renters log in and see their own rentals here, so they don't have to call you.",
      at: { screen: ".pg-screen", x: 0.17, y: 0.07, w: 0.8, h: 0.34 },
      side: "above",
    },
  },

  // Around each rental: the section holds and marks the feature it is showing.
  {
    id: "verify",
    label: "ID verification",
    text: "Before the keys go out, every renter scans their licence, front and back, and takes a selfie that's matched to the photo. You see the verdict on their record.",
    target: ".rc-list > li:nth-child(1)",
    held: { track: ".rc-track", share: 0, activeWhen: ".rc-list > li:nth-child(1).is-active" },
    node: false,
  },
  {
    id: "insurance",
    label: "Insurance",
    text: "Every rental can be covered: Bonzah cover bought at checkout, or the renter's own policy uploaded. Every policy sits in one list.",
    target: ".rc-list > li:nth-child(2)",
    held: { track: ".rc-track", share: 0.42, activeWhen: ".rc-list > li:nth-child(2).is-active" },
    node: false,
  },
  {
    id: "agreements",
    label: "Agreements",
    text: "Agreements go out from your own templates, renters sign on their phone, and the signed copy stays on the rental. No more chasing signatures.",
    target: ".rc-list > li:nth-child(3)",
    held: { track: ".rc-track", share: 0.6, activeWhen: ".rc-list > li:nth-child(3).is-active" },
    node: false,
  },
  {
    id: "payments",
    label: "Payments",
    text: "Money goes straight into your own Stripe or Square account, and deposits are held on the renter's card. We take no commission.",
    target: ".rc-list > li:nth-child(4)",
    held: { track: ".rc-track", share: 0.78, activeWhen: ".rc-list > li:nth-child(4).is-active" },
    node: false,
  },

  {
    id: "calendar",
    label: "Booking calendar",
    text: "Here's your whole fleet on one timeline. Open any booking to see its payment, agreement and ID check, and take a car off for a service in a drag.",
    target: "#calendar",
  },
  {
    id: "multichat",
    label: "Multi-chat",
    text: "Every text, email, in-app chat and call with a renter lands in one thread, with their booking right beside it.",
    target: "#multichat",
  },
  {
    id: "multichat-try",
    label: "Try it",
    text: "Go on, try it. Pick a channel under the conversation and send the reply I've drafted.",
    target: "#multichat .pg-browser",
    at: "top",
  },
  {
    id: "numbers",
    label: "Insights",
    text: "This shows what each car brought in and what it kept you. A car losing money shows in red, so you can reprice it or let it go before it costs you another month.",
    target: "#know-your-numbers",
  },

  // Trax draws its own line in, so no dots here.
  {
    id: "trax",
    label: "Trax",
    text: "This part is about me. I'm built into Drive247, and I answer from your own rentals, payments and fleet.",
    target: "#trax",
    node: false,
  },
  {
    id: "trax-ask",
    label: "Ask me anything",
    text: "Watch me work: you ask, I check your records, and you get a straight answer. Pick a topic under the screen to ask me something else.",
    target: "#trax .tm-track",
    at: "top",
    held: { track: "#trax .tm-track", share: 0.2 },
    node: false,
  },

  {
    id: "templates",
    label: "Templates",
    text: "Your booking site starts from a ready-made design. Change the words, photos and colours yourself, then publish when it looks right.",
    target: "#templates",
  },
  {
    id: "name",
    label: "Your name",
    text: "Type your company's name here. Your site takes it as you type, and I check whether the web address is still free.",
    target: "section:has(#nb-title)",
  },
  {
    id: "booking-demo",
    label: "Booking demo",
    text: "Now be your own renter. Pick dates, choose a car and check out, then watch the booking land in your portal.",
    target: "#booking-demo",
  },
  {
    id: "mobile",
    label: "On every phone",
    text: "Your portal and your renters' portal install like apps, straight from the browser, with your name, your icon and notifications.",
    target: "#mobile",
  },
  {
    id: "widget",
    label: "Trax widget",
    text: "Look familiar? That's me, down here in the corner. Soon I'll sit on your desktop and your phone like this, once you install Drive247.",
    target: "#trax-widget",
  },
  {
    id: "integrations",
    label: "Integrations",
    text: "Drive247 works with the tools you already use: Stripe or Square for payments, Bonzah for cover, BoldSign, Twilio, Tesla, Xero and Zoho.",
    target: "#integrations",
  },
  {
    id: "marketing",
    label: "Coming soon",
    text: "This one's coming soon: your Meta and Google Ads beside your bookings, so you can see which ads bring renters and what each booking cost.",
    target: "#marketing",
  },
  {
    id: "leads",
    label: "Coming soon",
    text: "Also on the way: every enquiry in one pipeline. Open a lead and move it along until it becomes a booking.",
    target: "#leads",
  },
  {
    id: "end-to-end",
    label: "End to end",
    text: "Here's the whole journey in five steps, from the first ad a renter sees to the money in your account.",
    target: "#end-to-end",
  },
  {
    id: "turo",
    label: "Turo",
    text: "Now, Turo. It keeps up to 30% of every trip. Drive247 is a flat monthly price, and we keep 0%.",
    target: "#turo",
  },
  {
    id: "turo-compare",
    label: "The difference",
    text: "Keep scrolling and watch the fleet grow. What you'd pay Turo grows with every car, and our price barely moves.",
    target: "#turo .tu-reveal-track",
    at: "top",
    held: { track: "#turo .tu-reveal-track", share: 0.06 },
    node: false,
  },
  {
    id: "beyond-turo",
    label: "Beyond Turo",
    text: "You don't have to leave Turo to start. Keep it as one channel, and grow your own direct bookings beside it.",
    target: "#beyond-turo",
  },
  {
    id: "turo-sync",
    label: "Turo Sync",
    text: "Turo Sync is in early access. It brings your Turo trips into Drive247, so every booking sits on one calendar.",
    target: "#turo-sync",
  },
  {
    id: "proof",
    label: "Real numbers",
    text: "These numbers are real: what operators have already run through Drive247.",
    target: "section:has(#nm-title)",
  },
  {
    id: "operators",
    label: "Operators",
    text: "Every tile here is a rental company on Drive247, sized by the bookings it takes. It changes as new bookings come in.",
    target: "#operators",
    at: "top",
  },
  {
    id: "testimonials",
    label: "Built for operators",
    text: "Here's our founder on why we built Drive247, and what operators say about running on it.",
    target: "#testimonials",
  },
  {
    id: "stories",
    label: "Customer stories",
    text: "These are the businesses behind the bookings, and what changed when they moved.",
    target: "section:has(#st-title)",
  },

  // Launch draws its own line and numbered dots.
  {
    id: "launch",
    label: "Launch",
    text: "Getting started takes four steps. Pick a plan, name your business, connect Stripe or Square, and you're live.",
    target: "#launch .ls-head",
    node: false,
  },
  {
    id: "pricing",
    label: "Pricing",
    text: ({ trialDays }) =>
      trialDays > 0
        ? `Pick the plan that fits your fleet. Every plan has the whole platform, and each one starts with a ${trialDays}-day free trial.`
        : "Pick the plan that fits your fleet. Every plan has the whole platform.",
    target: "#pricing",
  },
  {
    id: "book-a-demo",
    label: "Book a demo",
    text: "Not sure yet? Book a free 20-minute call with our founding team. No sales script, and no obligation.",
    target: "#book-a-demo",
  },
  {
    id: "faq",
    label: "FAQs",
    text: "Still deciding? These are the questions operators ask before they switch.",
    target: "#faq",
  },
  {
    id: "blog",
    label: "That's the tour",
    text: "That's the tour. Start your free trial whenever you're ready, or read a guide first.",
    target: "section:has(#bl-title)",
    actions: "trial",
  },
];

export function stopText(stop: { text: TourStop["text"] }, context: TourContext): string {
  return typeof stop.text === "function" ? stop.text(context) : stop.text;
}
