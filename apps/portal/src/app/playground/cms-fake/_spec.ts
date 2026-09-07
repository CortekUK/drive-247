/**
 * The website's content, described as DATA rather than as fourteen screens.
 *
 * FAKE — this is a design sandbox. Nothing here reaches Supabase.
 *
 * ── the argument this file is making ──────────────────────────────────────
 *
 * Today the CMS is 14 hand-written routes and 37 hand-written editor
 * components (`components/website-content/*`, ~380KB) for what is, underneath,
 * always the same three things: a page, its sections, and a section's fields.
 * Every one of those components re-invents its own card, its own header, its
 * own icon, its own Save button and its own layout — which is exactly why the
 * result reads as noisy. Fourteen screens drift into fourteen dialects.
 *
 * So the shape is declared once, here, and rendered once, in `page.tsx`. A new
 * section is a few lines of data. It cannot invent a new dialect, because
 * there is only one renderer.
 *
 * The shape below deliberately mirrors the real tables — `cms_pages` →
 * `cms_page_sections(section_key, content jsonb)` — so this maps onto the live
 * data one-to-one when it stops being a sketch.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Shape
 * ═════════════════════════════════════════════════════════════════════════ */

export type FieldType =
  /** One line. */
  | "text"
  /** A few lines. */
  | "textarea"
  /** A long body — privacy policy, terms. */
  | "richtext"
  /** A single image. */
  | "image"
  /** An ordered set of images. */
  | "gallery"
  /** A repeating row — services, FAQs, stats, trust badges. */
  | "list";

export type ItemFieldSpec = {
  key: string;
  label: string;
  type: "text" | "textarea";
  fallback?: string;
};

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  /**
   * What the live site shows when this is left empty.
   *
   * Shown as a PLACEHOLDER and never written into the record. v1 pre-filled
   * every empty field with Drive247's own copy as a real value — which is why
   * an operator who never opened Hero shipped a UK phone number, and why every
   * page looked full whether or not anyone had touched it.
   */
  fallback?: string;
  hint?: string;
  /** `list` only: the columns of one row. */
  item?: ItemFieldSpec[];
  /** `list` only: what one row is called, for the Add button and the summary. */
  noun?: string;
};

export type SectionSpec = {
  key: string;
  title: string;
  blurb?: string;
  /** Sections the operator can switch off entirely, e.g. the promo badge. */
  optional?: boolean;
  fields: FieldSpec[];
};

export type PageSpec = {
  slug: string;
  name: string;
  blurb: string;
  sections: SectionSpec[];
};

/* ── values ─────────────────────────────────────────────────────────────── */

export type ListRow = { id: string } & Record<string, string>;
export type FieldValue = string | string[] | ListRow[];

export type SectionValue = {
  /** Only meaningful for `optional` sections; always true otherwise. */
  enabled: boolean;
  fields: Record<string, FieldValue>;
};

export type PageValue = Record<string, SectionValue>;
export type SiteValue = Record<string, PageValue>;

/* ══════════════════════════════════════════════════════════════════════════
 * The site
 * ═════════════════════════════════════════════════════════════════════════ */

const SEO: SectionSpec = {
  key: "seo",
  title: "Search listing",
  blurb: "How this page appears in Google results.",
  fields: [
    { key: "title", label: "Title", type: "text", fallback: "Northwind Rentals", hint: "Around 60 characters." },
    {
      key: "description",
      label: "Description",
      type: "textarea",
      fallback: "Rent a car from Northwind Rentals. Transparent pricing, no hidden fees.",
      hint: "Around 155 characters.",
    },
    { key: "keywords", label: "Keywords", type: "text", fallback: "car rental, van hire" },
  ],
};

export const PAGES: PageSpec[] = [
  {
    slug: "home",
    name: "Home",
    blurb: "The first thing a visitor sees.",
    sections: [
      {
        key: "hero",
        title: "Hero",
        blurb: "The banner across the top.",
        fields: [
          { key: "headline", label: "Headline", type: "text", fallback: "Reliable car rentals you can count on" },
          { key: "subheading", label: "Subheading", type: "textarea", fallback: "Quality vehicles. Transparent pricing." },
          { key: "trust_line", label: "Trust line", type: "text", fallback: "Premium fleet • Flexible rates • 24/7 support", hint: "Separate items with •" },
          { key: "background", label: "Background", type: "gallery", hint: "Rotates if you add more than one." },
        ],
      },
      {
        key: "promo",
        title: "Promo badge",
        blurb: "A small offer sticker over the hero.",
        optional: true,
        fields: [
          { key: "amount", label: "Amount", type: "text", fallback: "15% off" },
          { key: "label", label: "Label", type: "text", fallback: "First rental" },
          { key: "line1", label: "First line", type: "text" },
          { key: "line2", label: "Second line", type: "text" },
        ],
      },
      {
        key: "services",
        title: "What you offer",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Why rent with us" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          {
            key: "items",
            label: "Items",
            type: "list",
            noun: "item",
            item: [
              { key: "title", label: "Title", type: "text" },
              { key: "body", label: "Description", type: "textarea" },
            ],
          },
        ],
      },
      {
        key: "booking",
        title: "Booking panel",
        blurb: "The heading above the date picker.",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Book your car" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          {
            key: "points",
            label: "Reassurances",
            type: "list",
            noun: "line",
            item: [{ key: "text", label: "Text", type: "text" }],
          },
        ],
      },
      {
        key: "reviews",
        title: "Reviews strip",
        optional: true,
        fields: [{ key: "title", label: "Heading", type: "text", fallback: "What our customers say" }],
      },
      {
        key: "cta",
        title: "Closing call to action",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Ready to drive?" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "primary", label: "Main button", type: "text", fallback: "Book now" },
          { key: "secondary", label: "Second button", type: "text" },
        ],
      },
      {
        key: "contact_card",
        title: "Contact card",
        optional: true,
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Questions?" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "phone", label: "Phone", type: "text", hint: "Left empty, the site uses your business phone." },
          { key: "email", label: "Email", type: "text", hint: "Left empty, the site uses your business email." },
        ],
      },
      SEO,
    ],
  },
  {
    slug: "about",
    name: "About",
    blurb: "Who you are.",
    sections: [
      {
        key: "hero",
        title: "Hero",
        fields: [
          { key: "title", label: "Headline", type: "text", fallback: "About us" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
        ],
      },
      {
        key: "story",
        title: "Your story",
        fields: [
          { key: "founded", label: "Founded", type: "text", fallback: "2019" },
          { key: "body", label: "Story", type: "richtext" },
        ],
      },
      {
        key: "why",
        title: "Why choose us",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Why choose us" },
          {
            key: "items",
            label: "Reasons",
            type: "list",
            noun: "reason",
            item: [
              { key: "title", label: "Title", type: "text" },
              { key: "body", label: "Description", type: "textarea" },
            ],
          },
        ],
      },
      {
        key: "stats",
        title: "Numbers",
        optional: true,
        fields: [
          {
            key: "items",
            label: "Figures",
            type: "list",
            noun: "figure",
            item: [
              { key: "value", label: "Number", type: "text" },
              { key: "label", label: "Label", type: "text" },
            ],
          },
        ],
      },
      {
        key: "cta",
        title: "Closing call to action",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Ready to drive?" },
          { key: "description", label: "Description", type: "textarea" },
        ],
      },
      SEO,
    ],
  },
  {
    slug: "fleet",
    name: "Fleet",
    blurb: "The cars, and what a rental includes.",
    sections: [
      {
        key: "hero",
        title: "Hero",
        fields: [
          { key: "title", label: "Headline", type: "text", fallback: "Our fleet" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          { key: "background", label: "Background", type: "gallery" },
        ],
      },
      {
        key: "rates",
        title: "Rate cards",
        blurb: "Shown above the vehicle grid. The prices themselves come from each vehicle.",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Simple rates" },
          {
            key: "items",
            label: "Cards",
            type: "list",
            noun: "card",
            item: [
              { key: "title", label: "Title", type: "text" },
              { key: "body", label: "Description", type: "textarea" },
            ],
          },
        ],
      },
      {
        key: "included",
        title: "What's included",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Every rental includes" },
          {
            key: "items",
            label: "Inclusions",
            type: "list",
            noun: "inclusion",
            item: [
              { key: "title", label: "Title", type: "text" },
              { key: "body", label: "Description", type: "textarea" },
            ],
          },
        ],
      },
      {
        key: "extras",
        title: "Paid extras",
        optional: true,
        fields: [
          {
            key: "items",
            label: "Extras",
            type: "list",
            noun: "extra",
            item: [
              { key: "title", label: "Name", type: "text" },
              { key: "price", label: "Price", type: "text" },
            ],
          },
        ],
      },
      SEO,
    ],
  },
  {
    slug: "reviews",
    name: "Reviews",
    blurb: "What customers have said.",
    sections: [
      {
        key: "hero",
        title: "Hero",
        fields: [
          { key: "title", label: "Headline", type: "text", fallback: "Reviews" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
        ],
      },
      {
        key: "empty",
        title: "Before you have reviews",
        blurb: "Shown while there is nothing to display.",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "No reviews yet" },
          { key: "body", label: "Message", type: "textarea" },
        ],
      },
      SEO,
    ],
  },
  {
    slug: "promotions",
    name: "Promotions",
    blurb: "Offers and how to claim them.",
    sections: [
      {
        key: "hero",
        title: "Hero",
        fields: [
          { key: "title", label: "Headline", type: "text", fallback: "Offers" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          { key: "background", label: "Background", type: "gallery" },
        ],
      },
      {
        key: "how",
        title: "How it works",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "How it works" },
          {
            key: "items",
            label: "Steps",
            type: "list",
            noun: "step",
            item: [
              { key: "title", label: "Title", type: "text" },
              { key: "body", label: "Description", type: "textarea" },
            ],
          },
        ],
      },
      {
        key: "empty",
        title: "When nothing is running",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "No offers right now" },
          { key: "body", label: "Message", type: "textarea" },
        ],
      },
      {
        key: "terms",
        title: "Terms",
        optional: true,
        fields: [{ key: "body", label: "Terms", type: "richtext" }],
      },
      SEO,
    ],
  },
  {
    slug: "contact",
    name: "Contact",
    blurb: "How people reach you.",
    sections: [
      {
        key: "hero",
        title: "Hero",
        fields: [
          { key: "title", label: "Headline", type: "text", fallback: "Get in touch" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
        ],
      },
      {
        key: "details",
        title: "Contact details",
        blurb: "Anything left empty falls back to your business details in Settings.",
        fields: [
          { key: "phone", label: "Phone", type: "text", fallback: "(303) 555-0182" },
          { key: "phone_hours", label: "Phone hours", type: "text", fallback: "Mon–Sat, 8am–7pm" },
          { key: "email", label: "Email", type: "text", fallback: "hello@northwind.example" },
          { key: "email_reply", label: "Reply time", type: "text", fallback: "Within one business day" },
          { key: "address", label: "Address", type: "textarea" },
          { key: "whatsapp", label: "WhatsApp", type: "text" },
        ],
      },
      {
        key: "form",
        title: "Enquiry form",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Send us a message" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          { key: "button", label: "Button", type: "text", fallback: "Send message" },
          { key: "success", label: "Thank-you message", type: "textarea", fallback: "Thanks — we'll be in touch shortly." },
          { key: "consent", label: "Consent line", type: "textarea" },
        ],
      },
      {
        key: "badges",
        title: "Trust badges",
        optional: true,
        fields: [
          {
            key: "items",
            label: "Badges",
            type: "list",
            noun: "badge",
            item: [
              { key: "label", label: "Label", type: "text" },
              { key: "tooltip", label: "Tooltip", type: "text" },
            ],
          },
        ],
      },
      SEO,
    ],
  },
  {
    slug: "privacy",
    name: "Privacy policy",
    blurb: "Required before you can take bookings.",
    sections: [
      { key: "body", title: "Policy", fields: [{ key: "body", label: "Policy", type: "richtext" }] },
      SEO,
    ],
  },
  {
    slug: "terms",
    name: "Terms",
    blurb: "Required before you can take bookings.",
    sections: [
      { key: "body", title: "Terms", fields: [{ key: "body", label: "Terms", type: "richtext" }] },
      SEO,
    ],
  },
];

/**
 * Site-wide settings.
 *
 * Kept out of `PAGES` on purpose: it is configuration, not a page a visitor can
 * land on, it has no publish state of its own, and putting it in the page list
 * is what made v1's hub read as ten equal things when it is nine plus one.
 */
export const SITE: PageSpec = {
  slug: "site",
  name: "Site settings",
  blurb: "Applies to every page.",
  sections: [
    {
      key: "brand",
      title: "Logo",
      fields: [
        { key: "logo", label: "Logo", type: "image" },
        { key: "favicon", label: "Favicon", type: "image" },
      ],
    },
    {
      key: "footer",
      title: "Footer",
      fields: [
        { key: "tagline", label: "Tagline", type: "textarea" },
        { key: "copyright", label: "Copyright", type: "text", fallback: "© Northwind Rentals" },
      ],
    },
    {
      key: "social",
      title: "Social links",
      optional: true,
      fields: [
        { key: "facebook", label: "Facebook", type: "text" },
        { key: "instagram", label: "Instagram", type: "text" },
        { key: "x", label: "X", type: "text" },
      ],
    },
  ],
};

export const ALL_PAGES = [...PAGES, SITE];

/* ══════════════════════════════════════════════════════════════════════════
 * Seed content
 *
 * Deliberately UNEVEN: `home` is finished and published, `contact` is live but
 * has been edited since, `about` is half-done and never published, and the rest
 * are untouched. All four states are on screen at once, which is the only way
 * to judge whether the design still reads calmly when the site is real.
 * ═════════════════════════════════════════════════════════════════════════ */

const on = (fields: Record<string, FieldValue>): SectionValue => ({ enabled: true, fields });
const off = (fields: Record<string, FieldValue> = {}): SectionValue => ({ enabled: false, fields });
const blank = (): SectionValue => ({ enabled: true, fields: {} });

export const SEED: SiteValue = {
  home: {
    hero: on({
      headline: "Denver's easiest car rental",
      subheading: "Book in two minutes. Collect from downtown or the airport.",
      trust_line: "Free cancellation • No hidden fees • 24/7 roadside",
      background: ["hero-downtown.jpg", "hero-tesla.jpg"],
    }),
    promo: on({ amount: "15% off", label: "First rental", line1: "New customers only", line2: "" }),
    services: on({
      title: "Why rent with us",
      subtitle: "",
      items: [
        { id: "s1", title: "Collect in 5 minutes", body: "No queue, no paperwork at the desk." },
        { id: "s2", title: "Every car under 3 years", body: "Serviced between every rental." },
        { id: "s3", title: "Cancel free up to 24h", body: "Plans change. We get it." },
      ],
    }),
    booking: on({
      title: "Book your car",
      subtitle: "",
      points: [{ id: "p1", text: "No card fees" }, { id: "p2", text: "Instant confirmation" }],
    }),
    reviews: on({ title: "What our customers say" }),
    cta: on({
      title: "Ready to drive?",
      description: "Pick your dates and we'll have the keys waiting.",
      primary: "Book now",
      secondary: "",
    }),
    contact_card: off(),
    seo: on({
      title: "Car rental in Denver — Northwind Rentals",
      description: "Rent a car in Denver from $49/day. Downtown and airport collection, free cancellation.",
      keywords: "denver car rental, airport car hire",
    }),
  },

  contact: {
    hero: on({ title: "Get in touch", subtitle: "We answer every message." }),
    details: on({
      phone: "(303) 555-0182",
      phone_hours: "Mon–Sat, 8am–7pm",
      email: "hello@northwind.example",
      email_reply: "Within one business day",
      address: "1420 Larimer St\nDenver, CO 80202",
      whatsapp: "",
    }),
    form: on({ title: "Send us a message", subtitle: "", button: "Send message", success: "", consent: "" }),
    badges: off(),
    seo: blank(),
  },

  about: {
    hero: on({ title: "About Northwind", subtitle: "" }),
    story: on({
      founded: "2019",
      body: "We started with two cars and a spare parking space behind a coffee shop on Larimer.\n\nToday we run 40 vehicles across Denver, and we still answer the phone ourselves.",
    }),
    why: blank(),
    stats: off(),
    cta: blank(),
    seo: blank(),
  },

  fleet: { hero: blank(), rates: blank(), included: blank(), extras: off(), seo: blank() },
  reviews: { hero: blank(), empty: blank(), seo: blank() },
  promotions: { hero: blank(), how: blank(), empty: blank(), terms: off(), seo: blank() },
  privacy: { body: blank(), seo: blank() },
  terms: { body: blank(), seo: blank() },

  site: {
    brand: on({ logo: "northwind-mark.svg", favicon: "" }),
    footer: on({ tagline: "Denver's easiest car rental.", copyright: "" }),
    social: off(),
  },
};

/**
 * What is currently LIVE on each page — the last published snapshot.
 *
 * `null` means the page has never been published, so nothing about it is on the
 * site yet. `contact` is seeded with an OLDER snapshot than the draft above, so
 * the screen opens with a real "changed since you published" state rather than
 * one you have to create by hand before you can look at it.
 */
export const SEED_PUBLISHED: Record<string, string | null> = {
  home: JSON.stringify(SEED.home),
  contact: JSON.stringify({
    ...SEED.contact,
    hero: on({ title: "Contact us", subtitle: "" }),
    details: on({
      phone: "(303) 555-0182",
      phone_hours: "Mon–Fri, 9am–5pm",
      email: "hello@northwind.example",
      email_reply: "Within one business day",
      address: "1420 Larimer St\nDenver, CO 80202",
      whatsapp: "",
    }),
  }),
  about: null,
  fleet: null,
  reviews: null,
  promotions: null,
  privacy: null,
  terms: null,
  site: JSON.stringify(SEED.site),
};
