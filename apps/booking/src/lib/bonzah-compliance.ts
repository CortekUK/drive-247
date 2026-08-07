/**
 * Bonzah insurer-supplied compliance text and links.
 *
 * SOURCE OF TRUTH: "Embedded Insurance Compliance Requirements.docx", received
 * from Brandon Rockow (brandon@bonzah.com) 5-6 Aug 2026. Bonzah requires this
 * disclosure to appear on every rental car company website that embeds their
 * products, and sends the same document to every rental company connected
 * through our integration.
 *
 * COMPLIANCE TEXT - DO NOT REWORD. This is insurer-supplied wording; operators
 * must not be able to edit it, which is why it is a code constant and not
 * tenant-editable CMS content. Same rule as BUNDLE_EXTRA_EXCLUSIONS in the
 * insurance selectors. If Bonzah ships a v3, update this one file and it
 * propagates to every Bonzah-enabled tenant automatically.
 *
 * Duplicated byte-for-byte to:
 *   apps/booking/src/lib/bonzah-compliance.ts
 *   apps/portal/src/lib/bonzah-compliance.ts
 * Keep them in sync - the booking checkout and the portal's staff-facing
 * insurance selectors must show the renter the same disclosure.
 */

/**
 * Renter-facing Bonzah links required by the compliance document.
 *
 * `termsOfService` deliberately points at business.bonzah.com, NOT the older
 * www.bonzah.com/terms that the .docx still hyperlinks. Brandon's 5-6 Aug 2026
 * emails supersede it: "Consumer Terms of Service: https://business.bonzah.com/terms
 * (should be available on the rental car company site)". Verified 2026-08-07 as
 * the consumer contract, last updated 4 Aug 2026.
 */
export const BONZAH_LINKS = {
  termsOfService: 'https://business.bonzah.com/terms',
  privacyPolicy: 'https://www.bonzah.com/privacy',
  excludedVehicles: 'https://bonzah.com/included-and-restricted-vehicle-types',
  faq: 'https://bonzah.com/faq',
  home: 'https://www.bonzah.com',
  /**
   * Operator-facing, NOT renter-facing. This is the contract the rental company
   * itself accepts when it connects to Bonzah, so it belongs on the portal's
   * Bonzah settings and onboarding screens — never in the renter disclosure.
   * It replaced bonzah.com/user-agreement, which now 404s.
   */
  businessPartnerTerms: 'https://business.bonzah.com/business-partner-terms',
} as const;

/**
 * Per-product coverage flyers. The compliance doc marks "[Add Link to Flyer]"
 * under each of the four products and gives these exact URLs.
 *
 * These replaced self-hosted mirrors in Supabase storage. The mirrored PDFs were
 * byte-identical to Bonzah's copies at the time, but a mirror silently goes
 * stale the moment the insurer revises a flyer - and a stale flyer is exactly
 * the kind of drift this compliance update exists to prevent. Link the
 * insurer's canonical URL so their revisions land automatically.
 */
export const BONZAH_FLYER_URLS = {
  cdw: 'https://business.bonzah.com/flyers/bonzah-cdw-flyer.pdf',
  rcli: 'https://business.bonzah.com/flyers/bonzah-rcli-flyer.pdf',
  sli: 'https://business.bonzah.com/flyers/bonzah-sli-flyer.pdf',
  pai: 'https://business.bonzah.com/flyers/bonzah-pai-pei-flyer.pdf',
} as const;

/**
 * The "Insurance Disclosure" section, verbatim.
 *
 * The final paragraph ("By proceeding with your purchase, you agree to
 * Bonzah.com's Terms of Service and Privacy Policy.") is NOT in this array - it
 * carries two hyperlinks, so the selectors render it as JSX from the three
 * fragments below. Splitting it here keeps the plain prose in one place while
 * still producing that exact sentence on screen.
 */
export const BONZAH_DISCLOSURE_PARAGRAPHS: readonly string[] = [
  'By purchasing coverage through this site, you acknowledge that Pablow Inc. dba Bonzah.com ("Bonzah") is the licensed broker of record and offers insurance coverage through various insurance carriers. The specific carrier issuing your policy will be identified at the time of purchase and in your policy documents.',
  'Coverage may include Collision Damage Waiver (CDW/LDW), Rental Car Liability Insurance (RCLI), and Supplemental Liability Insurance (SLI) as offered. Coverage excludes medical payments (MedPay), Personal Injury Protection (PIP), Underinsured Motorist (UIM), and Uninsured Motorist (UM) coverage where permitted by law. Full terms, conditions, limits, and exclusions are set forth in the policy documents provided at the time of purchase.',
  'Insurance is only for drivers 21 years and older with a valid driver’s license and must be listed as an additional driver on the rental agreement. Unlicensed drivers are not entitled to coverage under any circumstance.',
  'The renter is responsible for any unlisted drivers. Insurance may not apply if the renter or additional driver violates the rental agreement, insurance agreement, or violates traffic regulations.',
] as const;

/** Fragments of the final disclosure sentence, split around its two links. */
export const BONZAH_DISCLOSURE_AGREEMENT = {
  prefix: 'By proceeding with your purchase, you agree to Bonzah.com’s ',
  termsLabel: 'Terms of Service',
  conjunction: ' and ',
  privacyLabel: 'Privacy Policy',
  suffix: '.',
} as const;

/** Heading shown above the disclosure, matching the source document's section name. */
export const BONZAH_DISCLOSURE_HEADING = 'Insurance Disclosure';
