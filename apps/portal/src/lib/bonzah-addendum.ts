/**
 * Bonzah "Insurance Addendum" — the clauses Bonzah requires inside the signed
 * rental agreement of every rental company that integrates their products.
 *
 * SOURCE OF TRUTH: "Bonzah_Rental_Agreement_Addendum_v2.docx", received from
 * Brandon Rockow (brandon@bonzah.com) 5-6 Aug 2026.
 *
 * COMPLIANCE TEXT - DO NOT REWORD. Insurer-supplied wording, hardcoded here
 * rather than stored as tenant-editable CMS content so operators cannot alter
 * it. If Bonzah ships a v3, update this one file and it propagates to every
 * Bonzah-enabled tenant.
 *
 * This is a DISCLOSURE that Bonzah is offered as an option (a "referral
 * partner" disclosure) - not a confirmation of purchase. It therefore belongs
 * on every agreement for a tenant with `integration_bonzah = true`, whether or
 * not that particular renter bought coverage or hit "Skip Insurance". Do not
 * add a per-rental "did they buy insurance" condition.
 *
 * PUNCTUATION IS DELIBERATELY ASCII-ONLY. The source .docx uses typographic
 * apostrophes, curly quotes and em dashes. Two of the three agreement engines
 * flatten HTML to text before handing it to BoldSign, and the booking engine's
 * htmlToText() replaces every character outside Latin-1 with a space - which
 * turns "doesn't" into "doesn t" and eats em dashes. Straight quotes and
 * hyphens survive all three renderers, so the renter reads the same words
 * everywhere. The words themselves are unchanged.
 *
 * Duplicated byte-for-byte to:
 *   supabase/functions/_shared/bonzah-addendum.ts
 *   apps/portal/src/lib/bonzah-addendum.ts
 *   apps/booking/src/lib/bonzah-addendum.ts
 */

/** Placeholder name, without braces. Shared by the injector and every engine's variable map. */
export const BONZAH_ADDENDUM_PLACEHOLDER = "bonzah_insurance_addendum";

const ADDENDUM_TITLE = "Pablow, Inc. dba bonzah.com - Insurance Addendum";

/**
 * The ten clauses, verbatim. `heading` excludes the clause number - numbering is
 * generated below so the HTML and plain-text renderings cannot drift apart.
 */
const ADDENDUM_CLAUSES: ReadonlyArray<{ heading: string; body: string }> = [
  {
    heading: "Insurance Requirement.",
    body:
      "You (the renter) may be required to maintain a minimum level of automobile insurance coverage for the rental vehicle during the entire rental period. You may be able to satisfy this requirement through your own insurance, a credit card benefit, or an insurance product offered through one of our referral partners, including bonzah.com.",
  },
  {
    heading: "Bonzah Is a Referral Partner.",
    body:
      "Bonzah.com is one of our referral partners for optional rental insurance products. The products are offered and administered by Pablow, Inc. dba bonzah.com, the licensed broker, and its affiliate Bonzah, Inc.; Pablow, Inc. may act as the broker of record. We are not the insurer, are not obligating you to purchase any product from bonzah.com, and do not sell, solicit, negotiate, or advise on the insurance. Any coverage you purchase is a contract between you and the insurer/broker, subject to the bonzah.com Terms of Service and the applicable Description of Coverage.",
  },
  {
    heading: "Personal Use Only.",
    body:
      "Insurance products purchased through bonzah.com apply to personal use of the rental vehicle only and do not cover business, commercial, gig, ridesharing, or other non-personal use. As a broker, Bonzah may make available separate products for gig or other commercial use; contact bonzah.com to learn what may be available for non-personal use.",
  },
  {
    heading: "Excluded Vehicles.",
    body:
      "Certain vehicles are not eligible for coverage through bonzah.com. You are responsible for confirming that your rental vehicle is eligible before relying on any bonzah.com coverage. The current excluded vehicles list is available at bonzah.com.",
  },
  {
    heading: "Coverage Term; 24-Hour Cycles; Continuous Coverage; Extensions.",
    body:
      "Insurance purchased through bonzah.com must be purchased prior to vehicle pickup and must be continuous for the entire duration of the rental. Coverage runs in 24-hour cycles. All extensions must be purchased prior to the lapse of an existing policy. Insurance begins at the rental pickup time as specified in the rental agreement. If the rental agreement doesn't specify a start time, insurance starts at the scheduled pickup time for the reservation as designated in the rental car reservation system. In the absence of a rental agreement start time or scheduled reservation start time, when insurance is purchased on the same day as the rental agreement start date, insurance begins at the purchase time. In the absence of a rental agreement start time or scheduled reservation start time, when insurance is purchased on any day preceding the rental agreement start date, insurance begins at 12:00 AM the day of the rental agreement. Coverage cannot be reinstated, and a gap in coverage cannot be filled, after a lapse has occurred. You (the Renter) are responsible for confirming coverage, including any extensions or modifications. This can be done at https://us.bonzah.com/#/orders, and you should receive a confirmation email.",
  },
  {
    heading: "Your Responsibility to Read the Coverage.",
    body:
      "You are responsible for reading and understanding the bonzah.com coverages, limits, exclusions, and Description of Coverage before you take the vehicle. If you are not comfortable with the coverage, do not take the vehicle and contact bonzah.com during business hours.",
  },
  {
    heading: 'Not "Full Coverage."',
    body:
      'Any one policy purchased through bonzah.com is not "full coverage", is subject to the limits stated in the policy and Certificate of Insurance, and may not be sufficient to cover the entirety of any claim. You are responsible for determining whether the coverage is appropriate for your needs and for carrying any additional coverage that makes sense for you. Personal Accident / Personal Effects Insurance (PAI) is not rental car coverage; it is a travel insurance product.',
  },
  {
    heading: "Opt-Out of UM / UIM / PIP / Med-Pay.",
    body:
      "By purchasing or extending an insurance product through bonzah.com, you - and any additional, authorized drivers, and passengers - opt out of Uninsured Motorist (UM), Underinsured Motorist (UIM), Personal Injury Protection (PIP), and Medical Payments (Med-Pay) coverage, to the extent permitted by law in the applicable state. Where a state does not permit rejection of a coverage, that coverage applies at the minimum required by law.",
  },
  {
    heading: "Authorized Drivers.",
    body:
      "Only authorized drivers listed on this rental agreement are permitted to operate the vehicle. Any bonzah.com coverage applies only with respect to authorized drivers named on the rental agreement and the insurance application. You are responsible for any operation of the vehicle by a driver who is not listed and authorized.",
  },
  {
    heading: "Timestamps.",
    body:
      "The rental start time, return time, and any extensions or modifications are recorded by timestamp. Coverage purchased through bonzah.com aligns to the rental period as reflected in those timestamps, and you are responsible for ensuring coverage matches your actual rental and any changes to it.",
  },
];

/**
 * HTML rendering, for the two engines that substitute into an HTML template.
 *
 * Deliberately a FLAT sequence of <h2> and <p> - no wrapper <div>. The portal's
 * HTML-to-PDF block parser only recognises table/h1-h3/ul/ol/hr/p as block
 * elements; a wrapping <div> is not a block there and its content would be
 * flattened into stray raw text.
 */
export const BONZAH_INSURANCE_ADDENDUM_HTML = [
  `<h2>${ADDENDUM_TITLE}</h2>`,
  ...ADDENDUM_CLAUSES.map(
    (clause, i) => `<p><strong>${i + 1}. ${clause.heading}</strong> ${clause.body}</p>`,
  ),
].join("\n");

/**
 * Plain-text rendering, for the fallback generators that build an agreement as
 * text when a tenant has no custom template row.
 */
export const BONZAH_INSURANCE_ADDENDUM_TEXT = [
  ADDENDUM_TITLE.toUpperCase(),
  ...ADDENDUM_CLAUSES.map((clause, i) => `${i + 1}. ${clause.heading} ${clause.body}`),
].join("\n\n");
