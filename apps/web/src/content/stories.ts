import { readMinutes, type Block } from "./types";

/**
 * Customer stories.
 *
 * ⚠ EVERY STORY BELOW IS A SAMPLE: a made-up operator with made-up results, written to
 * build and review the layout. A sample shows on a development server and NEVER in a
 * production build (see `SHOW_SAMPLES`), so the section, the /customers pages and the
 * footer link all disappear on the live site until a real story is added. A real
 * story needs the operator's agreement, their real figures, and `sample: false`.
 */

export type StoryTint = "violet" | "teal" | "amber";

export interface Story {
  slug: string;
  /** True for placeholder content. Samples are never shown in production. */
  sample: boolean;
  operator: string;
  location: string;
  fleet: string;
  since: string;
  tint: StoryTint;
  headline: string;
  excerpt: string;
  /** The one figure on the card. */
  highlight: { value: string; label: string };
  /** Three figures across the top of the story. */
  results: readonly { value: string; label: string }[];
  quote: { text: string; by: string };
  /** ISO date, shown as "Nov 3, 2026". */
  date: string;
  body: readonly Block[];
}

const SAMPLE_STORIES: readonly Story[] = [
  {
    slug: "harbor-car-rentals",
    sample: true,
    operator: "Harbor Car Rentals",
    location: "San Diego, CA",
    fleet: "14 cars",
    since: "On Drive247 since March 2026",
    tint: "violet",
    headline: "Harbor Car Rentals moved its regulars off the marketplace",
    excerpt:
      "After two years on Turo, Harbor gave repeat renters its own booking link. Within a season, most of its bookings came direct.",
    highlight: { value: "62%", label: "of bookings now come direct" },
    results: [
      { value: "62%", label: "of bookings now come direct" },
      { value: "0%", label: "commission on those bookings" },
      { value: "3 hrs", label: "a week back from paperwork" },
    ],
    quote: {
      text: "Our regulars were paying a marketplace to rent from us. Now they book on our own site, and we know exactly who they are.",
      by: "Owner, Harbor Car Rentals",
    },
    date: "2026-10-30",
    body: [
      { type: "h2", text: "The challenge" },
      {
        type: "p",
        text: "Harbor had grown to fourteen cars on Turo. Bookings were steady, but the same renters kept coming back, and every return trip paid the marketplace's cut again. The owner could see the regulars on the calendar but had no way to reach them directly.",
      },
      { type: "h2", text: "What changed" },
      {
        type: "list",
        items: [
          "A booking site on Harbor's own web address, live on the day they signed up.",
          "Every repeat renter got a direct link with their next booking.",
          "ID checks and agreements moved online, so the counter stopped being a queue.",
          "Deposits are held on the renter's card instead of taken in cash.",
        ],
      },
      { type: "h2", text: "The result" },
      {
        type: "p",
        text: "Within a season, most of Harbor's bookings came through its own site. The newest cars stay on the marketplace to find new renters, and those renters are offered the direct link on their way out.",
      },
    ],
  },
  {
    slug: "sunset-drive-co",
    sample: true,
    operator: "Sunset Drive Co",
    location: "Austin, TX",
    fleet: "6 cars",
    since: "On Drive247 since June 2026",
    tint: "teal",
    headline: "Sunset Drive Co went from a spreadsheet to a live booking site in a weekend",
    excerpt:
      "Bookings used to arrive by text and live in a spreadsheet. Now renters book and pay on Sunset's own site, at any hour.",
    highlight: { value: "1 weekend", label: "from spreadsheet to live site" },
    results: [
      { value: "1 weekend", label: "from spreadsheet to live site" },
      { value: "0", label: "double bookings since" },
      { value: "24/7", label: "bookings, even overnight" },
    ],
    quote: {
      text: "I used to take bookings by text and keep them in a spreadsheet. Now the calendar does it, and nothing gets booked twice.",
      by: "Founder, Sunset Drive Co",
    },
    date: "2026-10-16",
    body: [
      { type: "h2", text: "The challenge" },
      {
        type: "p",
        text: "Sunset ran six cars from a phone and a spreadsheet. Renters texted, the owner checked the sheet, and a busy weekend meant answering messages at midnight. Twice in one month the same car was promised to two people.",
      },
      { type: "h2", text: "What changed" },
      {
        type: "list",
        items: [
          "The booking site went live at sign-up, and the cars were added over one weekend.",
          "Renters pick their dates and only see cars that are actually free.",
          "Payments go straight to Sunset's own account.",
          "Agreements are signed on the renter's phone before pickup.",
        ],
      },
      { type: "h2", text: "The result" },
      {
        type: "p",
        text: "Bookings now arrive while the owner sleeps, already paid and already checked. The spreadsheet is gone, and so are the double bookings.",
      },
    ],
  },
  {
    slug: "maple-auto-hire",
    sample: true,
    operator: "Maple Auto Hire",
    location: "Portland, OR",
    fleet: "22 cars",
    since: "On Drive247 since January 2026",
    tint: "amber",
    headline: "Maple Auto Hire checks every driver before the keys leave",
    excerpt:
      "With twenty-two cars and a small team, Maple needed handovers that took minutes, not a clipboard and a queue.",
    highlight: { value: "100%", label: "of renters verified before pickup" },
    results: [
      { value: "100%", label: "of renters verified before pickup" },
      { value: "5 min", label: "for a typical handover" },
      { value: "$0", label: "in deposits chased in cash" },
    ],
    quote: {
      text: "We used to meet every renter with a clipboard. Now they arrive verified and signed, and the handover takes five minutes.",
      by: "Operations lead, Maple Auto Hire",
    },
    date: "2026-09-25",
    body: [
      { type: "h2", text: "The challenge" },
      {
        type: "p",
        text: "Maple's handovers took twenty minutes: photocopying licences, printing agreements, taking a cash deposit and writing it all down. On a Friday afternoon the queue reached the door.",
      },
      { type: "h2", text: "What changed" },
      {
        type: "list",
        items: [
          "Every renter verifies their licence and a selfie online before pickup.",
          "The agreement goes out with the booking and is signed on the renter's phone.",
          "The deposit is held on the card and released when the car comes back.",
        ],
      },
      { type: "h2", text: "The result" },
      {
        type: "p",
        text: "Renters now arrive already checked, signed and paid. The team hands over keys and walks around the car, and the paperwork is already on the rental.",
      },
    ],
  },
];

/** Development shows samples so the layout can be reviewed; production never does. */
const SHOW_SAMPLES = process.env.NODE_ENV !== "production";

export interface StoryWithMeta extends Story {
  readMinutes: number;
}

export const STORIES: readonly StoryWithMeta[] = SAMPLE_STORIES.filter(
  (story) => SHOW_SAMPLES || !story.sample,
).map((story) => ({ ...story, readMinutes: readMinutes(story.body) }));

export function getStory(slug: string): StoryWithMeta | undefined {
  return STORIES.find((story) => story.slug === slug);
}
