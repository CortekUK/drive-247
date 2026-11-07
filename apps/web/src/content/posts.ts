import { readMinutes, type Block, type Cover } from "./types";

/**
 * The Drive247 blog. Newest first.
 *
 * Every claim about the product is something it does today for a self-serve
 * operator (the v2 portal). Don't describe Turo Sync, Inshur or CheckMyDriver here,
 * and don't describe website analytics: that screen is still demo data.
 */

export type PostCategory = "Getting started" | "Growth" | "Money" | "Operations" | "Product";

export interface Post {
  slug: string;
  title: string;
  excerpt: string;
  category: PostCategory;
  /** ISO date, shown as "Nov 3, 2026". */
  date: string;
  cover: Cover;
  body: readonly Block[];
}

const cover = (name: string, alt: string): Cover => ({
  src: `/v2/hero/${name}.webp`,
  dark: `/v2/hero/${name}-dark.webp`,
  alt,
});

const POSTS: readonly Post[] = [
  {
    slug: "turo-or-your-own-booking-site",
    title: "Turo or your own booking site? What the commission really costs",
    excerpt:
      "Marketplaces bring you renters, then keep a cut of every trip. Here is how to work out what that costs you, and when your own site starts to pay.",
    category: "Growth",
    date: "2026-11-03",
    cover: cover("close-site", "A Drive247 booking site home page"),
    body: [
      {
        type: "p",
        text: "Most independent operators start on Turo, and for good reason: it brings renters to cars nobody has heard of yet. The catch arrives later, once the bookings are regular. Every trip pays the marketplace first.",
      },
      { type: "h2", text: "What the cut adds up to" },
      {
        type: "p",
        text: "Turo keeps between 10% and 30% of each trip, depending on the protection plan you choose. On a car that earns $1,200 a month, that is $120 to $360 gone before fuel, cleaning or the loan payment. Across a fleet of ten cars it adds up to the cost of a full-time hire.",
      },
      { type: "h2", text: "The renter belongs to the marketplace" },
      {
        type: "p",
        text: "The bigger cost is quieter. A renter who books you on Turo is Turo's customer. You can't keep their details for next time, and Turo's own rules stop you from taking a booking off the platform. Every repeat trip pays the cut again.",
      },
      { type: "h2", text: "What your own site changes" },
      {
        type: "list",
        items: [
          "Renters book and pay on your own web address, and their details stay with you.",
          "Drive247 takes no cut of your bookings. You pay your plan and the card processor's standard fees.",
          "ID checks, agreements and deposits happen before pickup, the same way every time.",
        ],
      },
      { type: "h2", text: "Keep both while you switch" },
      {
        type: "p",
        text: "You don't have to leave a marketplace to start. Many operators keep their newest cars listed for reach and send repeat renters to their own site. As the direct share grows, the marketplace becomes a place to find new customers rather than the place they live.",
      },
      {
        type: "callout",
        title: "A simple rule of thumb",
        text: "If a third of your renters have booked with you before, the commission on their trips is money you could keep. That is a good moment to hand them your own booking link.",
      },
    ],
  },
  {
    slug: "five-things-before-your-first-rental",
    title: "Five things to set up before your first rental",
    excerpt:
      "A short checklist for your first week on Drive247, in the order that saves you the most time later.",
    category: "Getting started",
    date: "2026-10-28",
    cover: {
      src: "/v2/hero/dashboard.png",
      dark: "/v2/hero/dashboard-dark.png",
      alt: "The Drive247 portal home screen",
    },
    body: [
      {
        type: "p",
        text: "Your booking site goes live the moment you sign up, with your business name already on it. Before the first renter arrives, a little setup makes everything after it run on its own.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Connect your payouts",
            text: "Connect Stripe from Integrations so renters' card payments go straight to your own account.",
          },
          {
            title: "Add your cars",
            text: "Add each vehicle with photos, a daily rate and the trip lengths you offer. Clear photos and an honest description do more for bookings than anything else on the page.",
          },
          {
            title: "Read your booking site",
            text: "Open your site, read every page and change anything that doesn't sound like you. Your logo and colours carry across the site and your renters' portal.",
          },
          {
            title: "Set up your agreement",
            text: "Pick an agreement template and add your own terms. Renters sign it on their phone before pickup, and the signed copy stays on the rental.",
          },
          {
            title: "Turn on ID checks",
            text: "Ask every renter to verify their licence with a selfie before the keys leave. It takes them a couple of minutes and can save you a bad first trip.",
          },
        ],
      },
      { type: "h2", text: "Then book your onboarding call" },
      {
        type: "p",
        text: "Every new operator gets a free 30-minute onboarding call. Bring your questions, your fleet and your first booking, and we'll go through it together.",
      },
    ],
  },
  {
    slug: "where-did-the-money-go",
    title: "Where did the money go? Reading your month in Insights",
    excerpt:
      "Money in is not money kept. Insights splits a month into what you took, what you gave back, what was never yours and what you kept.",
    category: "Money",
    date: "2026-10-21",
    cover: cover("close-insights", "The Insights screen: where your money went"),
    body: [
      {
        type: "p",
        text: "A busy month can still feel thin when the bank balance arrives. Usually it is because some of the money that came in was never yours to keep: deposits waiting to go back, sales tax owed, refunds already promised.",
      },
      { type: "h2", text: "One screen, six lines" },
      {
        type: "list",
        items: [
          "Money you took in: rentals, extras, delivery and insurance.",
          "Money you gave back: refunds to renters.",
          "Money that was never yours: sales tax and refundable deposits.",
          "Money you spent: servicing, repairs and running the cars.",
          "Money you kept: what is left, and what share of the money in it was.",
          "Still owed to you: balances renters haven't paid yet.",
        ],
      },
      { type: "h2", text: "Why deposits sit on their own line" },
      {
        type: "p",
        text: "A refundable deposit can sit in your account for days. Counting it as income makes one month look better than it was and the next look worse when it goes back. Insights keeps it apart, so it never inflates what you earned.",
      },
      { type: "h2", text: "Ask instead of digging" },
      {
        type: "p",
        text: "Every line opens to the rentals and payments behind it. If you'd rather ask, Trax can answer questions like \"who still owes me money this month?\" from the same records.",
      },
    ],
  },
  {
    slug: "signed-and-checked-before-pickup",
    title: "Signed and checked before the keys leave",
    excerpt:
      "How to start every rental the same way: a verified driver, a signed agreement and a deposit held on the card.",
    category: "Operations",
    date: "2026-10-14",
    cover: cover("close-agreements", "Agreements sent to renters, with their status"),
    body: [
      {
        type: "p",
        text: "Most bad rentals can be spotted before pickup. The trick is running the same three checks every time, without turning the handover into an interview.",
      },
      { type: "h2", text: "1. Check the driver" },
      {
        type: "p",
        text: "Send the renter a verification link by email, or show them a QR code at the counter. They photograph the front and back of their licence and take a selfie, and the check compares their face with the licence photo. You see the result on the rental: verified, in review or declined.",
      },
      { type: "h2", text: "2. Get the agreement signed" },
      {
        type: "p",
        text: "The agreement goes out from the rental with the renter, the car and the dates already filled in. They sign on their phone, and the signed copy is kept on the rental for as long as you need it.",
      },
      { type: "h2", text: "3. Hold the deposit" },
      {
        type: "p",
        text: "Instead of taking cash, hold the deposit on the renter's card. Release it when the car comes back as it left, or charge part of it if something needs fixing. Nobody has to chase anybody.",
      },
      {
        type: "callout",
        title: "Make it the default",
        text: "Run all three on every booking, not just the ones that feel risky. Renters treat it as normal when it is normal, and the checks catch the ones you would never have guessed.",
      },
    ],
  },
  {
    slug: "weekend-and-holiday-pricing",
    title: "Charging more on weekends and holidays, without a spreadsheet",
    excerpt:
      "Demand isn't flat, and your rates don't have to be. Set a weekend surcharge once, add your busy holidays, and let every quote follow.",
    category: "Money",
    date: "2026-10-07",
    cover: cover("close-fleet", "The fleet list in the Drive247 portal"),
    body: [
      {
        type: "p",
        text: "Friday to Sunday and the week of a big holiday are when cars run out first. Charging the same daily rate on those days leaves money on the table, and editing prices by hand every week is how mistakes get in.",
      },
      { type: "h2", text: "Set the weekend once" },
      {
        type: "p",
        text: "Choose which days count as the weekend and the percentage to add. Short bookings that include those days are priced up automatically, while weekly and monthly rentals keep their own rates.",
      },
      { type: "h2", text: "Add your holidays" },
      {
        type: "p",
        text: "Add each busy period with its dates and its own surcharge. Mark it as yearly and it comes back next year without being set up again. If a car shouldn't follow the holiday rate, leave it out.",
      },
      { type: "h2", text: "Make exceptions per car" },
      {
        type: "p",
        text: "Some cars earn their own rules. Give one a fixed weekend price or a different percentage, or take it out of a rule altogether.",
      },
      {
        type: "callout",
        title: "Every quote shows it",
        text: "Renters see the price for their exact dates before they book, so a weekend rate is never a surprise at pickup.",
      },
    ],
  },
  {
    slug: "meet-trax",
    title: "Meet Trax: ask your business a question",
    excerpt:
      "Trax reads your rentals, payments and fleet, and answers in plain words. Here is what to ask it first.",
    category: "Product",
    date: "2026-09-30",
    cover: cover("close-trax", "Trax answering a question about the business"),
    body: [
      {
        type: "p",
        text: "Trax is the assistant built into your Drive247 portal. It reads the same records you do: rentals, renters, payments, invoices and cars. Ask it a question and it answers from those records, with the numbers behind the answer.",
      },
      { type: "h2", text: "Good first questions" },
      {
        type: "list",
        items: [
          "Who still owes me money this month?",
          "Which cars are out today, and when are they due back?",
          "What did I take in last month compared with the month before?",
          "Which renters have booked more than once?",
        ],
      },
      { type: "h2", text: "It reads, it doesn't change" },
      {
        type: "p",
        text: "Trax can look things up and explain them, but it can't change a booking, move money or message a renter on its own. Every action stays yours.",
      },
      { type: "h2", text: "Start the day with a rundown" },
      {
        type: "p",
        text: "Ask for a rundown when you open the portal and Trax lists what needs you today: balances to collect, handovers due and anything waiting on a reply.",
      },
    ],
  },
];

export interface PostWithMeta extends Post {
  readMinutes: number;
}

export const ALL_POSTS: readonly PostWithMeta[] = POSTS.map((post) => ({
  ...post,
  readMinutes: readMinutes(post.body),
}));

export function getPost(slug: string): PostWithMeta | undefined {
  return ALL_POSTS.find((post) => post.slug === slug);
}
