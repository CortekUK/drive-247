export const CONTENT_VERSION = "2026-08-v1";

export type ConfirmationVideoSlug =
  | "marketplace-control"
  | "system-walkthrough"
  | "faqs"
  | "who-its-for";

export type ConfirmationVideo = {
  slug: ConfirmationVideoSlug;
  order: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  takeaway: string;
  src: string;
  poster: string;
  /**
   * WebVTT caption file, or null when none has been supplied yet. Null renders
   * no <track> at all; it must never point at a file that does not exist.
   */
  captions: string | null;
  /** Approved verbatim transcript. Null until final media copy is supplied. */
  transcript: readonly string[] | null;
};

export const CONFIRMATION_VIDEOS = [
  {
    slug: "marketplace-control",
    order: 1,
    title: "Marketplace Dependency vs Independent Rentals",
    description:
      "See why owning the customer relationship, brand, pricing and process matters more than relying on one marketplace.",
    takeaway:
      "Build a rental operation that still exists outside any single marketplace.",
    src: "/strategy-call/videos/01-marketplace-dependency.mp4",
    poster: "/strategy-call/posters/01-marketplace-dependency.webp",
    captions: "/strategy-call/captions/01-marketplace-dependency.en.vtt",
    transcript: null,
  },
  {
    slug: "system-walkthrough",
    order: 2,
    title: "Drive247 System Walkthrough",
    description:
      "Follow the direct-booking journey from the customer experience through the tools used to run the operation.",
    takeaway: "Picture how your rental business could run through Drive247.",
    src: "/strategy-call/videos/02-drive247-system-walkthrough.mp4",
    poster: "/strategy-call/posters/02-drive247-system-walkthrough.webp",
    captions: "/strategy-call/captions/02-drive247-system-walkthrough.en.vtt",
    transcript: null,
  },
  {
    slug: "faqs",
    order: 3,
    title: "Frequently Asked Questions",
    description:
      "Get clear answers to the common setup, marketplace, branding, payments and support questions before the call.",
    takeaway:
      "Use the strategy call for questions specific to your operation, not the basics.",
    src: "/strategy-call/videos/03-frequently-asked-questions.mp4",
    poster: "/strategy-call/posters/03-frequently-asked-questions.webp",
    captions: "/strategy-call/captions/03-frequently-asked-questions.en.vtt",
    transcript: null,
  },
  {
    slug: "who-its-for",
    order: 4,
    title: "Who This Is Actually For",
    description:
      "Decide whether the system, launch process and responsibility of building direct demand match your goals.",
    takeaway:
      "Know whether this fits—and what fleet details, blockers and launch goal to bring to the call.",
    src: "/strategy-call/videos/04-who-this-is-for.mp4",
    poster: "/strategy-call/posters/04-who-this-is-for.webp",
    captions: "/strategy-call/captions/04-who-this-is-for.en.vtt",
    transcript: null,
  },
] as const satisfies readonly [
  ConfirmationVideo,
  ConfirmationVideo,
  ConfirmationVideo,
  ConfirmationVideo,
];
