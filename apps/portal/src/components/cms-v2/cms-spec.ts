/**
 * The website's content, described as data.
 *
 * ── why this file exists ──────────────────────────────────────────────────
 *
 * v1 spends 14 routes and 37 editor components (~380KB) on what is underneath
 * always the same three things: a page, its sections, and a section's fields.
 * Each of those components re-invents a card, an icon, a header and a Save
 * button, which is why the result reads as noisy — and why the fourteen screens
 * have drifted into fourteen dialects. Declared once here and rendered once in
 * `cms-page-editor.tsx`, a new section is a few lines of data and cannot invent
 * a new dialect.
 *
 * ── how it was derived ────────────────────────────────────────────────────
 *
 * Every entry below was checked against BOTH ends:
 *   - what the portal editor actually writes (`components/website-content/*`,
 *     which in several places differs from the interface in `types/cms.ts` —
 *     the zod schema and the object handed to `onSave` are not the same set)
 *   - what `apps/booking` actually renders (`hooks/usePageContent.ts`,
 *     `hooks/useSiteSettings.tsx`, `lib/legal-page-content.ts`, and the pages
 *     and components that consume them)
 *
 * Sections and fields that only ONE end knows about are deliberately NOT here.
 * See DEAD_SECTIONS at the bottom for the list and the reason for each — they
 * are still fully editable in v1 for the other 56 tenants; this is the canary's
 * spec, not a migration.
 *
 * ── the thing to understand before changing any of this ───────────────────
 *
 * There is NO draft storage. `cms_page_sections` IS the live content: booking
 * reads those rows directly and filters only on the owning page's `status`. So
 * `cms_pages.status` does not mean "these edits are pending" — it means "this
 * page exists on the website at all".
 *
 * v1 treats it as a draft flag anyway: every section save sets the page back to
 * `status = 'draft'`, which takes the whole page OFF the live site until the
 * operator notices and clicks Publish. That is not hypothetical — see
 * `use-cms-page-v2.ts` for the counts. The v2 write path never demotes.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Shape
 * ═════════════════════════════════════════════════════════════════════════ */

export type FieldType =
  /** One line. */
  | "text"
  /** A few lines. */
  | "textarea"
  /** A long HTML body — privacy policy, terms. */
  | "richtext"
  /** A single uploaded image, stored as a URL. */
  | "image"
  /** An ordered set of images/videos (`carousel_media`). */
  | "gallery"
  /** A plain `string[]` — trust points, subject options, term lines. */
  | "lines"
  /** A repeating row of sub-fields. */
  | "list"
  /** One of a fixed icon vocabulary. */
  | "icon"
  /** A number, stored as a number and not a string. */
  | "number"
  /** A yyyy-mm-dd string. */
  | "date"
  /** A boolean. */
  | "toggle"
  /** One of a fixed set of values. */
  | "choice";

export type SubFieldSpec = {
  key: string;
  label: string;
  type: "text" | "textarea" | "icon" | "number" | "toggle" | "choice";
  /** `icon` only — which vocabulary this field draws from. */
  icons?: readonly string[];
  /** `choice` only. */
  options?: readonly { value: string; label: string }[];
  fallback?: string;
};

export type FieldSpec = {
  /**
   * Key inside the section's `content` JSONB.
   *
   * May be DOTTED for the sections whose stored shape is nested —
   * `contact_info.phone.number`, `rental_rates.daily.title`. The editor reads
   * and writes through those paths so the stored JSONB keeps exactly the shape
   * booking already parses; nothing is flattened on disk.
   */
  key: string;
  label: string;
  type: FieldType;
  /**
   * What the live site falls back to when this is empty.
   *
   * Rendered as a PLACEHOLDER, never written. v1 pre-fills untouched fields
   * with Drive247's own copy as real values, so every page looks full whether
   * or not anyone has touched it — and an operator who never opened Hero ships
   * a UK phone number as their own.
   */
  fallback?: string;
  hint?: string;
  icons?: readonly string[];
  options?: readonly { value: string; label: string }[];
  /** `list` only. */
  item?: SubFieldSpec[];
  /** `list` / `lines` only — what one row is called. */
  noun?: string;
};

export type SectionSpec = {
  /** The real `cms_page_sections.section_key`. */
  key: string;
  title: string;
  blurb?: string;
  fields: FieldSpec[];
};

export type PageSpec = {
  /** The real `cms_pages.slug`. */
  slug: string;
  name: string;
  blurb: string;
  sections: SectionSpec[];
};

/* ══════════════════════════════════════════════════════════════════════════
 * Icon vocabularies
 *
 * These are taken from the BOOKING side's icon maps — what actually renders —
 * not from the v1 editor's dropdown. The two have drifted, and every drift is
 * an icon the operator can pick that silently renders as a generic shield:
 *
 *   trust_badges   the editor offers `check-circle`; booking's map has `check`
 *                  and no `check-circle`, so that option never resolves
 *   why_choose_us  the DEFAULTS ship `dollar-sign` and `users`, neither of
 *                  which is in the editor's list OR booking's map
 *   inclusions     the DEFAULTS ship lowercase names (`shield`, `fuel`, `map`…)
 *                  against a PascalCase map, so a "Set to Default" turns every
 *                  inclusion icon into a shield
 *
 * Constraining the picker to what renders is the fix. Note the two casings are
 * real and must not be normalised — booking keys its maps differently per
 * section, and changing the stored value would break v1 for everyone else.
 * ═════════════════════════════════════════════════════════════════════════ */

/** PascalCase — `EnhancedServiceHighlights`. */
export const ICONS_SERVICE = [
  "ThumbsUp", "Users", "MapPin", "Baby", "Settings", "Headphones", "Shield",
  "Car", "Clock", "Phone", "Star", "Award", "CheckCircle", "Fuel", "Wifi", "Crown",
] as const;

/** lowercase — `app/about/page.tsx` iconMap, shared by stats and why_choose_us. */
export const ICONS_ABOUT = [
  "clock", "car", "crown", "star", "shield", "phone", "check", "lock",
] as const;

/** PascalCase — the fleet inclusions map. */
export const ICONS_INCLUSIONS = [
  "Shield", "Phone", "MapPin", "Fuel", "User", "Sparkles", "Plane", "Clock",
  "Car", "Crown", "Wifi", "Baby", "FileCheck", "Wrench", "Droplets",
  "GlassWater", "CarFront", "Receipt",
] as const;

/** lowercase — `app/contact/page.tsx` badge map. */
export const ICONS_BADGES = [
  "shield", "lock", "clock", "award", "star", "heart", "zap", "check",
] as const;

/**
 * The four sources `app/about/page.tsx` actually switches on.
 *
 * `DEFAULT_ABOUT_STATS` ships `"vehicles"` and `"customers"` with
 * `use_dynamic: true`; both fall through the switch to the static value, so
 * v1's "Set to Default" on About produces two live-looking stats that are not.
 */
export const STAT_SOURCES = [
  { value: "years_experience", label: "Years in business" },
  { value: "total_rentals", label: "Total rentals" },
  { value: "active_vehicles", label: "Vehicles on fleet" },
  { value: "avg_rating", label: "Average rating" },
] as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Reusable sections
 * ═════════════════════════════════════════════════════════════════════════ */

const seo = (fallbackTitle: string): SectionSpec => ({
  key: "seo",
  title: "Search listing",
  blurb: "How this page appears in Google results.",
  fields: [
    { key: "title", label: "Title", type: "text", fallback: fallbackTitle, hint: "Up to 70 characters." },
    { key: "description", label: "Description", type: "textarea", hint: "Up to 160 characters." },
    { key: "keywords", label: "Keywords", type: "text", hint: "Comma separated." },
  ],
});

/* ══════════════════════════════════════════════════════════════════════════
 * The pages
 * ═════════════════════════════════════════════════════════════════════════ */

export const PAGES: PageSpec[] = [
  /* ── home ──────────────────────────────────────────────────────────────
     Read by `components/home/legacy-home.tsx`. NOTE: a tenant with
     `booking_v2_enabled = true` renders `components/booking-v2/landing`
     instead, which reads no CMS at all — every section here is inert for
     those tenants. northwind is on the legacy home, so this page is live. */
  {
    slug: "home",
    name: "Home",
    blurb: "The first thing a visitor sees.",
    sections: [
      {
        key: "home_hero",
        title: "Hero",
        blurb: "The banner across the top.",
        fields: [
          { key: "headline", label: "Headline", type: "text", fallback: "Reliable car rentals you can count on" },
          { key: "subheading", label: "Subheading", type: "textarea", fallback: "Quality vehicles. Transparent pricing." },
          { key: "trust_line", label: "Trust line", type: "text", hint: "Sits under the buttons. Separate items with •" },
          { key: "phone_number", label: "Phone number", type: "text" },
          { key: "phone_cta_text", label: "Phone button", type: "text", fallback: "Call us" },
          { key: "book_cta_text", label: "Book button", type: "text", fallback: "Book now" },
          {
            key: "carousel_media",
            label: "Background",
            type: "gallery",
            hint: "Rotates if you add more than one. Images and videos.",
          },
        ],
      },
      {
        key: "service_highlights",
        title: "What you offer",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Why rent with us" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          {
            key: "services",
            label: "Items",
            type: "list",
            noun: "item",
            item: [
              { key: "icon", label: "Icon", type: "icon", icons: ICONS_SERVICE },
              { key: "title", label: "Title", type: "text" },
              { key: "description", label: "Description", type: "textarea" },
            ],
          },
        ],
      },
      {
        key: "booking_header",
        title: "Booking panel",
        blurb: "The heading above the date picker.",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Book your car" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          { key: "trust_points", label: "Reassurances", type: "lines", noun: "line", hint: "Shown joined with ·" },
        ],
      },
      {
        key: "testimonials_header",
        title: "Reviews strip",
        fields: [{ key: "title", label: "Heading", type: "text", fallback: "What our customers say" }],
      },
      {
        key: "home_cta",
        title: "Closing call to action",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Ready to drive?" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "primary_cta_text", label: "Main button", type: "text", fallback: "Book now" },
          { key: "secondary_cta_text", label: "Second button", type: "text" },
          { key: "trust_points", label: "Reassurances", type: "lines", noun: "line" },
        ],
      },
      {
        key: "contact_card",
        title: "Contact card",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Questions?" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "phone_number", label: "Phone", type: "text" },
          { key: "email", label: "Email", type: "text" },
          { key: "call_button_text", label: "Call button", type: "text", fallback: "Call us" },
          { key: "email_button_text", label: "Email button", type: "text", fallback: "Email us" },
        ],
      },
      seo("Car rental"),
    ],
  },

  /* ── about ─────────────────────────────────────────────────────────────
     Section keys here do NOT match `CMS_DEFAULTS.about`'s own key names —
     the v1 editor maps `defaults.story → "about_story"` and
     `defaults.cta → "final_cta"`, and `faq_cta` has no default at all. */
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
        key: "about_story",
        title: "Your story",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Our story" },
          { key: "founded_year", label: "Founded", type: "text" },
          { key: "content", label: "Story", type: "richtext" },
        ],
      },
      {
        key: "why_choose_us",
        title: "Why choose us",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Why choose us" },
          {
            key: "items",
            label: "Reasons",
            type: "list",
            noun: "reason",
            item: [
              { key: "icon", label: "Icon", type: "icon", icons: ICONS_ABOUT },
              { key: "title", label: "Title", type: "text" },
              { key: "description", label: "Description", type: "textarea" },
            ],
          },
        ],
      },
      {
        key: "stats",
        title: "Numbers",
        blurb: "A figure can be typed in, or read live from your account.",
        fields: [
          {
            key: "items",
            label: "Figures",
            type: "list",
            noun: "figure",
            item: [
              { key: "icon", label: "Icon", type: "icon", icons: ICONS_ABOUT },
              { key: "label", label: "Label", type: "text" },
              { key: "value", label: "Value", type: "text" },
              { key: "suffix", label: "Suffix", type: "text" },
              { key: "use_dynamic", label: "Read live", type: "toggle" },
              { key: "dynamic_source", label: "Source", type: "choice", options: STAT_SOURCES },
            ],
          },
        ],
      },
      {
        key: "faq_cta",
        title: "FAQ prompt",
        fields: [
          { key: "title", label: "Heading", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "button_text", label: "Button", type: "text" },
        ],
      },
      {
        key: "final_cta",
        title: "Closing call to action",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Ready to drive?" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "tagline", label: "Tagline", type: "text" },
        ],
      },
      seo("About us"),
    ],
  },

  /* ── fleet ─────────────────────────────────────────────────────────── */
  {
    slug: "fleet",
    name: "Fleet",
    blurb: "The cars, and what a rental includes.",
    sections: [
      {
        key: "rental_rates",
        title: "Rate cards",
        blurb: "Shown above the vehicle grid. The prices themselves come from each vehicle.",
        fields: [
          { key: "section_title", label: "Heading", type: "text", fallback: "Simple rates" },
          // Stored nested — `{daily: {title, description}, …}`. Dotted keys keep
          // the JSONB in exactly the shape booking already parses.
          { key: "daily.title", label: "Daily — title", type: "text" },
          { key: "daily.description", label: "Daily — text", type: "textarea" },
          { key: "weekly.title", label: "Weekly — title", type: "text" },
          { key: "weekly.description", label: "Weekly — text", type: "textarea" },
          { key: "monthly.title", label: "Monthly — title", type: "text" },
          { key: "monthly.description", label: "Monthly — text", type: "textarea" },
        ],
      },
      {
        key: "inclusions",
        title: "What's included",
        fields: [
          { key: "section_title", label: "Heading", type: "text", fallback: "Every rental includes" },
          { key: "section_subtitle", label: "Subheading", type: "textarea" },
          { key: "standard_title", label: "Standard list — title", type: "text" },
          {
            key: "standard_items",
            label: "Standard",
            type: "list",
            noun: "inclusion",
            item: [
              { key: "icon", label: "Icon", type: "icon", icons: ICONS_INCLUSIONS },
              { key: "title", label: "Title", type: "text" },
            ],
          },
          { key: "premium_title", label: "Premium list — title", type: "text" },
          {
            key: "premium_items",
            label: "Premium",
            type: "list",
            noun: "inclusion",
            item: [
              { key: "icon", label: "Icon", type: "icon", icons: ICONS_INCLUSIONS },
              { key: "title", label: "Title", type: "text" },
            ],
          },
        ],
      },
      {
        key: "extras",
        title: "Paid extras",
        fields: [
          {
            key: "items",
            label: "Extras",
            type: "list",
            noun: "extra",
            item: [
              { key: "name", label: "Name", type: "text" },
              { key: "price", label: "Price", type: "number" },
              { key: "description", label: "Description", type: "textarea" },
            ],
          },
          { key: "footer_text", label: "Note under the list", type: "textarea" },
        ],
      },
      seo("Our fleet"),
    ],
  },

  /* ── reviews ───────────────────────────────────────────────────────── */
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
        key: "feedback_cta",
        title: "Ask for a review",
        fields: [
          { key: "title", label: "Heading", type: "text" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "button_text", label: "Button", type: "text" },
          { key: "empty_state_message", label: "Before you have reviews", type: "textarea" },
        ],
      },
      seo("Reviews"),
    ],
  },

  /* ── promotions ────────────────────────────────────────────────────── */
  {
    slug: "promotions",
    name: "Promotions",
    blurb: "Offers and how to claim them. The offers themselves live under Promotions.",
    sections: [
      {
        key: "how_it_works",
        title: "How it works",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "How it works" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          {
            key: "steps",
            label: "Steps",
            type: "list",
            noun: "step",
            item: [
              { key: "number", label: "No.", type: "text" },
              { key: "title", label: "Title", type: "text" },
              { key: "description", label: "Description", type: "textarea" },
            ],
          },
        ],
      },
      {
        key: "empty_state",
        title: "When nothing is running",
        fields: [
          { key: "title_default", label: "Heading", type: "text", fallback: "No offers right now" },
          { key: "title_active", label: "Heading when offers exist", type: "text" },
          { key: "description", label: "Message", type: "textarea" },
          { key: "button_text", label: "Button", type: "text" },
        ],
      },
      {
        key: "terms",
        title: "Terms",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Terms & conditions" },
          { key: "terms", label: "Terms", type: "lines", noun: "term" },
        ],
      },
      seo("Offers"),
    ],
  },

  /* ── contact ───────────────────────────────────────────────────────── */
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
        key: "contact_info",
        title: "Contact details",
        blurb: "Anything left empty falls back to your business details in Site settings, then to your tenant record.",
        fields: [
          { key: "phone.number", label: "Phone", type: "text" },
          { key: "phone.availability", label: "Phone hours", type: "text" },
          { key: "email.address", label: "Email", type: "text" },
          { key: "email.response_time", label: "Reply time", type: "text", fallback: "Response within 2 hours" },
          { key: "office.address", label: "Address", type: "textarea" },
          { key: "whatsapp.number", label: "WhatsApp", type: "text", hint: "Falls back to your phone number." },
          { key: "whatsapp.description", label: "WhatsApp note", type: "text", fallback: "Quick response for urgent enquiries" },
        ],
      },
      {
        key: "contact_form",
        title: "Enquiry form",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Send us a message" },
          { key: "subtitle", label: "Subheading", type: "textarea" },
          { key: "submit_button_text", label: "Button", type: "text", fallback: "Send message" },
          { key: "success_message", label: "Thank-you message", type: "textarea" },
          { key: "gdpr_text", label: "Consent line", type: "textarea" },
          { key: "subject_options", label: "Subjects", type: "lines", noun: "subject" },
        ],
      },
      {
        key: "trust_badges",
        title: "Trust badges",
        blurb: "The whole card is hidden on the site when there are none.",
        fields: [
          {
            key: "badges",
            label: "Badges",
            type: "list",
            noun: "badge",
            item: [
              { key: "icon", label: "Icon", type: "icon", icons: ICONS_BADGES },
              { key: "label", label: "Label", type: "text" },
              { key: "tooltip", label: "Tooltip", type: "text" },
            ],
          },
        ],
      },
      seo("Contact us"),
    ],
  },

  /* ── privacy ───────────────────────────────────────────────────────────
     Server-rendered by `lib/legal-page-content.ts`, which reads ONLY
     `privacy_content` — the `seo` section the v1 editor also writes here is
     never read, so it is not offered. The stored HTML is post-processed by
     `ensureSmsDisclosure()`, which appends an A2P-10DLC block if the text does
     not already carry one. */
  {
    slug: "privacy",
    name: "Privacy policy",
    blurb: "Required before you can take bookings. An SMS disclosure is added automatically if yours does not mention one.",
    sections: [
      {
        key: "privacy_content",
        title: "Policy",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Privacy Policy" },
          { key: "last_updated", label: "Last updated", type: "date" },
          { key: "content", label: "Policy", type: "richtext" },
        ],
      },
    ],
  },

  /* ── terms ─────────────────────────────────────────────────────────────
     TWO consumers, and the second is easy to miss: besides the /terms page,
     `lib/agreement-terms.ts` injects this text into rental agreements and
     e-sign PDFs — and that path deliberately does NOT filter on published
     status. Editing this changes the contract customers sign. */
  {
    slug: "terms",
    name: "Terms",
    blurb: "Shown on your site AND injected into every rental agreement customers sign.",
    sections: [
      {
        key: "terms_content",
        title: "Terms",
        fields: [
          { key: "title", label: "Heading", type: "text", fallback: "Terms & Conditions" },
          { key: "last_updated", label: "Last updated", type: "date" },
          { key: "content", label: "Terms", type: "richtext" },
        ],
      },
    ],
  },
];

/**
 * Site-wide settings.
 *
 * Read by `useSiteSettings.tsx`, which is a SEPARATE query from
 * `usePageContent` and — unlike it — has no global fallback: it requires the
 * tenant's own row AND `status = 'published'`. So an unpublished site-settings
 * page means the footer and header silently fall back to the `tenants` record.
 */
export const SITE: PageSpec = {
  slug: "site-settings",
  name: "Site settings",
  blurb: "Applies to every page. Anything left empty falls back to your business record.",
  sections: [
    {
      key: "logo",
      title: "Logo",
      blurb: "Also written to your tenant record, because the header picks the dark variant first.",
      fields: [
        { key: "logo_url", label: "Logo", type: "image" },
        { key: "logo_alt", label: "Alt text", type: "text", hint: "Read aloud by screen readers." },
      ],
    },
    {
      key: "contact",
      title: "Business details",
      fields: [
        { key: "phone", label: "Phone", type: "text" },
        { key: "phone_display", label: "Phone as shown", type: "text", hint: "Formatted for display, e.g. (303) 555-0182." },
        { key: "email", label: "Email", type: "text" },
        { key: "address_line1", label: "Address line 1", type: "text" },
        { key: "address_line2", label: "Address line 2", type: "text" },
        { key: "city", label: "City", type: "text" },
        { key: "state", label: "State", type: "text" },
        { key: "zip", label: "ZIP", type: "text" },
        { key: "country", label: "Country", type: "text", fallback: "USA" },
        { key: "google_maps_url", label: "Google Maps link", type: "text" },
      ],
    },
    {
      key: "footer",
      title: "Footer",
      fields: [
        { key: "tagline", label: "Tagline", type: "textarea" },
        { key: "copyright_text", label: "Copyright", type: "text" },
      ],
    },
    {
      // Dead on the v1 booking site (loaded into settings.*_url, rendered
      // nowhere) but LIVE on the v2 site, which reads `site-settings / social`
      // in both hero variants. Offered because the canary is on v2.
      key: "social",
      title: "Social links",
      blurb: "Shown in the page headers on your website.",
      fields: [
        { key: "facebook", label: "Facebook", type: "text" },
        { key: "instagram", label: "Instagram", type: "text" },
        { key: "twitter", label: "X / Twitter", type: "text" },
        { key: "linkedin", label: "LinkedIn", type: "text" },
        { key: "youtube", label: "YouTube", type: "text" },
        { key: "tiktok", label: "TikTok", type: "text" },
      ],
    },
  ],
};

export const ALL_PAGES: PageSpec[] = [...PAGES, SITE];

export const pageSpec = (slug: string): PageSpec | undefined =>
  ALL_PAGES.find((p) => p.slug === slug);

/* ══════════════════════════════════════════════════════════════════════════
 * Deliberately absent
 *
 * Every one of these is editable in v1 and writes to the database, and NONE of
 * them reaches a visitor. They are left out of the canary's editor rather than
 * deleted: v1 still offers them to the other 56 tenants, untouched.
 *
 * If any of these is meant to be live, the fix is on the BOOKING side — adding
 * the field back here would only restore the illusion.
 * ═════════════════════════════════════════════════════════════════════════ */

export const DEAD_SECTIONS: { where: string; why: string }[] = [
  { where: "home.promo_badge", why: "No component in apps/booking references it. Written, merged, never rendered." },
  { where: "home.home_hero.background_image", why: "Zero references in apps/booking outside the type declaration." },
  { where: "contact.pwa_install", why: "Its only consumer in app/contact/page.tsx is commented out." },
  { where: "site-settings.logo.favicon_url", why: "The real favicon comes from tenants.favicon_url; this value is never read." },
  { where: "privacy.seo / terms.seo", why: "The legal pages are server-rendered and read only *_content; their seo section is fetched and dropped." },
  { where: "fleet.fleet_hero", why: "Dead at both ends — no editor writes it (fleet-hero-editor.tsx is imported by nothing) and app/fleet/page.tsx renders no hero." },
  { where: "promotions.promotions_hero", why: "Same as fleet_hero — promotions-hero-editor.tsx is imported by nothing." },
];
