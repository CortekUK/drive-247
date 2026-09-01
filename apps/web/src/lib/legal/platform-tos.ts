/**
 * Drive247 platform Terms of Service — the contract between Cortek Systems Ltd
 * (trading as Drive247) and the rental businesses who subscribe to the Platform.
 *
 * ── STATUS ────────────────────────────────────────────────────────────────────
 * This is Appendix A of the 6 August 2026 handoff: the rewritten ToS that is
 * with the solicitor for final sign-off. It is NOT live yet — the canonical
 * /terms page still serves the previous document while PLATFORM_TOS_IS_DRAFT
 * is true.
 *
 * It lives in apps/web because drive-247.com/terms is the CANONICAL public home
 * of this contract. The portal's old second copy is retired and 307s here.
 *
 * TO SHIP IT (one change, after sign-off):
 *   1. flip PLATFORM_TOS_IS_DRAFT to false here
 *   2. set PLATFORM_TOS_VERSION in supabase/functions/_shared/platform-tos.ts
 *      to PLATFORM_TOS_PENDING_VERSION ("2026-08-01")
 * The version test in apps/portal/src/__tests__/lib/platform-tos.test.ts fails
 * until both are done, so the two can never drift.
 *
 * ── BRACKETED PLACEHOLDERS — DO NOT FILL THESE IN ─────────────────────────────
 * Three placeholders are deliberately left exactly as the solicitor draft has
 * them. Per the handoff memo: "Leave every bracketed placeholder in Appendix A
 * exactly as written — don't fill in Governing Law, Venue, or the Privacy Policy
 * URL yourself. They're pending the solicitor and Ghulam."
 *   · [Governing Law Jurisdiction]  — Section 34
 *   · [Venue]                       — Section 34
 *   · [Privacy Policy URL]          — Section 17
 * There is a test asserting all three are still present and unfilled. If you are
 * here to fill one in, it should come from the solicitor, not from a guess.
 *
 * The effective date is likewise unset ("[Insert Date of Publication]").
 *
 * ── EDITING RULES ─────────────────────────────────────────────────────────────
 * This is legal copy. Do not reword, "clean up", or fix apparent typos inline —
 * flag them back to Ghulam. Renumbering sections silently breaks the internal
 * cross-references (Section 7 is cited by 27; 19 by 18; 20 by 14; 21 by 23;
 * 30 by 24).
 */

export type TosBlock =
  /** Ordinary paragraph. */
  | { t: "p"; text: string }
  /** Block that must render in capitals, as drafted (Sections 29 and 30). */
  | { t: "caps"; text: string }
  /** Numbered sub-clause with a bold lead-in, e.g. "6.1 Billing in Advance." */
  | { t: "lead"; lead: string; text: string }
  /** Defined term (Section 2). */
  | { t: "def"; term: string; text: string };

export interface TosSection {
  n: number;
  title: string;
  body: TosBlock[];
}

/** Flip to false only after solicitor sign-off — see the header. */
export const PLATFORM_TOS_IS_DRAFT = true;

/** Version this document will be recorded as once it goes live. */
export const PLATFORM_TOS_PENDING_VERSION = "2026-08-01";

export const PLATFORM_TOS_TITLE = "Terms of Service";
export const PLATFORM_TOS_SUBTITLE =
  "Software Platform for Independent Vehicle Rental Operators";
export const PLATFORM_TOS_EFFECTIVE_DATE = "[Insert Date of Publication]";
export const PLATFORM_TOS_LAST_UPDATED = "6 August 2026 (draft)";

export const PLATFORM_TOS_SECTIONS: TosSection[] = [
  {
    n: 1,
    title: "Introduction",
    body: [
      {
        t: "p",
        text:
          'These Terms of Service (the "Terms") form a binding legal agreement between Cortek Systems Ltd, operating as "Drive247" ("Drive247," "we," "us," or "our"), and the rental business entity identified during account creation ("Customer," "you," or "your"). These Terms govern access to and use of the Drive247 software platform, including its website, web application, application programming interfaces (APIs), and all related tools and services (collectively, the "Platform").',
      },
      {
        t: "p",
        text:
          'By creating an account, subscribing to the Platform, clicking "I Agree," or otherwise accessing or using any part of the Platform, you confirm that you have read, understood, and agree to be bound by these Terms and by our Privacy Policy, which is incorporated into these Terms by reference. If you do not agree to these Terms, you must not access or use the Platform.',
      },
      {
        t: "p",
        text:
          'If you are entering into these Terms on behalf of a company or other legal entity, you represent that you have the authority to bind that entity, in which case "Customer," "you," and "your" refer to that entity.',
      },
    ],
  },
  {
    n: 2,
    title: "Definitions",
    body: [
      {
        t: "def",
        term: "Platform",
        text:
          "means the Drive247 software-as-a-service product, including all associated websites, applications, APIs, integrations, and documentation, as may be updated by Drive247 from time to time.",
      },
      {
        t: "def",
        term: "Customer",
        text:
          'means the vehicle rental business (or individual operating one) that registers for and subscribes to the Platform. Drive247\'s product and marketing materials may refer to Customers as "operators" — that usage is descriptive only and does not alter the defined term used in these Terms.',
      },
      {
        t: "def",
        term: "Renter",
        text:
          "means an individual who rents a vehicle from a Customer using the Platform.",
      },
      {
        t: "def",
        term: "Customer Data",
        text:
          "means all data relating to Renters, bookings, rentals, vehicles, and related records that a Customer submits to, or that is generated within, the Platform.",
      },
      {
        t: "def",
        term: "Subscription",
        text: "means the paid plan selected by a Customer to access the Platform.",
      },
      {
        t: "def",
        term: "Third-Party Services",
        text:
          "means services provided by parties other than Drive247 that integrate with or are accessible through the Platform, including payment processors, insurance providers, identity verification providers, e-signature providers, and communications providers.",
      },
      {
        t: "def",
        term: "Content",
        text:
          "means text, data, software, images, and other material made available through the Platform, whether provided by Drive247, a Customer, a Renter, or a third party.",
      },
    ],
  },
  {
    n: 3,
    title: "About Drive247",
    body: [
      {
        t: "p",
        text:
          "Drive247 is a cloud-based software platform designed for independent vehicle rental businesses operating within the United States. The Platform provides tools including, without limitation, booking management, fleet management, customer relationship records, digital rental agreements, identity verification integrations, payment integrations, insurance integrations, artificial-intelligence-assisted administrative features, reporting and analytics, workflow automation, and website management.",
      },
      {
        t: "p",
        text:
          "Drive247 is a software provider only. Drive247 is not a vehicle rental operator, insurance company, insurance broker, payment processor, financial institution, law firm, legal adviser, or compliance consultant, and is not a party to any rental agreement, insurance policy, or payment transaction entered into by a Customer or Renter.",
      },
    ],
  },
  {
    n: 4,
    title: "Eligibility",
    body: [
      {
        t: "p",
        text:
          "By using the Platform, you represent and warrant that: (a) you are at least 18 years of age; (b) if registering on behalf of a business, you have full legal authority to bind that business to these Terms; (c) the information you provide during registration and thereafter is accurate, current, and complete; and (d) your use of the Platform, and your rental business generally, will comply with all applicable federal, state, and local laws and regulations.",
      },
    ],
  },
  {
    n: 5,
    title: "Accounts",
    body: [
      {
        t: "p",
        text:
          "You are responsible for maintaining the confidentiality and security of your account credentials, for restricting access to the Platform to authorized users within your organization, and for all activity that occurs under your account, whether or not authorized by you. The Customer is responsible for all actions taken by its employees, contractors, and authorized users through the Platform, and may not rely on the acts or omissions of any such individual as a defense to its obligations under these Terms. You must notify Drive247 promptly at support@drive-247.com if you become aware of any actual or suspected unauthorized access to, or use of, your account.",
      },
    ],
  },
  {
    n: 6,
    title: "Subscription & Billing",
    body: [
      {
        t: "lead",
        lead: "6.1 Billing in Advance.",
        text:
          "Subscription fees are billed in advance on a recurring basis (monthly or annual, as selected). Your first period's subscription fee is payable during onboarding, before Platform access is granted, unless otherwise agreed in writing by Drive247.",
      },
      {
        t: "lead",
        lead: "6.2 Auto-Renewal.",
        text:
          "Unless cancelled in accordance with these Terms, your Subscription will automatically renew at the end of each billing period using your saved payment method, at the then-current price for your plan.",
      },
      {
        t: "lead",
        lead: "6.3 Taxes.",
        text:
          "Fees are exclusive of applicable sales, use, VAT, or similar taxes, which will be added to invoices where required by law.",
      },
      {
        t: "lead",
        lead: "6.4 Price Changes.",
        text:
          "Drive247 may revise Subscription pricing from time to time. Drive247 will provide reasonable prior notice of any price increase before it takes effect on your account, and continued use of the Platform after that date constitutes acceptance of the new price.",
      },
      {
        t: "lead",
        lead: "6.5 No Proration on Downgrade.",
        text:
          "Except as required by law or expressly stated at checkout, fees are non-refundable, including where you downgrade your plan or use the Platform for only part of a billing period. Except where required by applicable law, no refunds or credits will be issued for partial billing periods, unused Subscriptions, or cancelled accounts.",
      },
    ],
  },
  {
    n: 7,
    title: "Failed Payments",
    body: [
      {
        t: "p",
        text:
          "If a payment cannot be collected, Drive247 may retry the charge, restrict certain Platform functionality, and/or suspend or terminate your access to the Platform until payment is received. Suspension of access does not relieve you of your obligation to pay all outstanding fees.",
      },
    ],
  },
  {
    n: 8,
    title: "Customer Responsibilities",
    body: [
      {
        t: "p",
        text:
          "The Customer is, at all times, solely and exclusively responsible for: accepting or rejecting any rental request; verifying the identity, driving license, and eligibility of Renters; confirming that adequate insurance coverage is in place for each rental; inspecting, maintaining, and ensuring the roadworthiness of vehicles; setting and communicating pricing; collecting and remitting applicable taxes; complying with all applicable federal, state, and local laws (including consumer protection, licensing, and rental-specific regulations); resolving disputes with Renters; and otherwise operating the Customer's rental business.",
      },
      {
        t: "p",
        text:
          "Drive247 never approves rentals, authorizes the release of a vehicle to a Renter, verifies a Renter's suitability to rent or drive a vehicle, or guarantees the accuracy of any information displayed on the Platform. Any tool, workflow, or output that appears to facilitate these decisions is provided solely to assist the Customer's own independent judgment, and does not substitute for it.",
      },
    ],
  },
  {
    n: 9,
    title: "Bookings & Rental Decisions",
    body: [
      {
        t: "p",
        text:
          "Automated workflows within the Platform (including but not limited to booking confirmations, pricing calculations, availability checks, and rules-based flags) are administrative and informational only. They do not constitute an operational approval, a legal opinion, or professional advice of any kind. Customers must independently verify all relevant information before releasing a vehicle to, or entering into a rental agreement with, a Renter.",
      },
    ],
  },
  {
    n: 10,
    title: "Insurance",
    body: [
      {
        t: "p",
        text:
          "Insurance products made available through or in connection with the Platform (including third-party integrations such as Bonzah, where applicable) are supplied by independent, licensed insurance providers who are not affiliated with Drive247. Drive247 is not an insurer, insurance broker, managing general agent, or underwriter. Drive247 accepts no responsibility or liability for underwriting decisions, policy terms, coverage determinations, premium calculations, or claims handling, all of which are the sole responsibility of the relevant insurance provider and the Customer.",
      },
    ],
  },
  {
    n: 11,
    title: "Payment Processing",
    body: [
      {
        t: "p",
        text:
          "Payments made through the Platform are processed by independent, third-party payment processors (including Stripe and its affiliates). Drive247 does not receive, hold, custody, or control Renter or Customer funds at any point, and is not a party to the underlying payment transaction. Drive247 is not responsible for payment disputes, processing delays, declined transactions, chargebacks, or any acts or omissions of a payment processor. Customers are responsible for complying with the terms of service of any payment processor they use.",
      },
    ],
  },
  {
    n: 12,
    title: "Third-Party Integrations",
    body: [
      {
        t: "p",
        text:
          "The Platform may integrate with, or provide access to, Third-Party Services, including Stripe, identity verification providers, e-signature providers, telematics and vehicle-tracking providers, communications providers (including SMS and WhatsApp messaging providers), artificial-intelligence services, and other third-party systems. Drive247 does not control, and is not liable for, the availability, performance, accuracy, security, or business practices of any Third-Party Service, including outages, API changes, pricing changes, or discontinuation of any Third-Party Service. Your use of any Third-Party Service is subject to that provider's own terms and policies. Drive247 does not guarantee that any specific third-party integration (including, without limitation, Stripe, Bonzah, Tesla, or WhatsApp) will remain available throughout the term of a Subscription.",
      },
    ],
  },
  {
    n: 13,
    title: "Electronic Signatures",
    body: [
      {
        t: "p",
        text:
          "The Platform provides electronic signature tools for the convenience of Customers in generating and executing rental agreements and related documents. Customers are solely responsible for ensuring that documents generated or executed through the Platform satisfy the legal requirements applicable to their business and jurisdiction, including requirements relating to the enforceability of electronic signatures.",
      },
    ],
  },
  {
    n: 14,
    title: "Generated Documents",
    body: [
      {
        t: "p",
        text:
          'The Platform may automatically generate rental agreements, invoices, receipts, reminder messages, emails, SMS messages, and other AI-assisted or template-based content based on information supplied by the Customer (collectively, "Generated Documents").',
      },
      {
        t: "p",
        text:
          "The Customer is solely responsible for reviewing all Generated Documents before relying on them, issuing them to a Renter or any other third party, or making any operational, financial, or legal decision based on them.",
      },
      {
        t: "p",
        text:
          "Drive247 does not warrant that any Generated Document is legally compliant, accurate, complete, or suitable for any particular purpose, and no Generated Document constitutes legal, tax, or compliance advice. Generated Documents that use artificial intelligence are additionally subject to Section 20 (AI-Assisted Features).",
      },
    ],
  },
  {
    n: 15,
    title: "Identity Verification",
    body: [
      {
        t: "p",
        text:
          "Identity verification and document-authentication tools available on the Platform are provided to assist Customers in their own decision-making process. Drive247 does not guarantee the identity of any individual, the authenticity of any document, or the suitability of any Renter to rent or operate a vehicle. Customers remain solely responsible for their own verification and acceptance decisions.",
      },
    ],
  },
  {
    n: 16,
    title: "Customer Data",
    body: [
      {
        t: "p",
        text:
          "As between Drive247 and the Customer, the Customer retains all ownership rights in Customer Data. By submitting Customer Data to the Platform, the Customer grants Drive247 a limited, non-exclusive, worldwide license to host, store, process, transmit, and display such Customer Data solely as necessary to provide, maintain, secure, and improve the Platform, and as otherwise permitted under these Terms and our Privacy Policy. The Customer represents that it has all necessary rights and consents to submit Customer Data to the Platform and to permit Drive247's use of that data as described in this Section.",
      },
    ],
  },
  {
    n: 17,
    title: "Privacy",
    body: [
      {
        t: "p",
        text:
          "Personal information submitted to or collected through the Platform is processed in accordance with our Privacy Policy, available at [Privacy Policy URL], which is incorporated into these Terms by reference. Customers remain responsible for their own compliance with applicable privacy and data protection legislation (including, where applicable, state privacy laws) with respect to Customer Data they collect, use, and share via the Platform.",
      },
    ],
  },
  {
    n: 18,
    title: "Intellectual Property",
    body: [
      {
        t: "p",
        text:
          "All software, source code, object code, designs, user interfaces, documentation, trademarks, logos, and other intellectual property comprising or relating to the Platform are and remain the exclusive property of Drive247 or its licensors. No rights in the Platform are granted to the Customer except as expressly set out in Section 19 (Licence to Use the Platform).",
      },
    ],
  },
  {
    n: 19,
    title: "Licence to Use the Platform",
    body: [
      {
        t: "p",
        text:
          "Subject to the Customer's compliance with these Terms and payment of applicable fees, Drive247 grants the Customer a limited, non-exclusive, non-transferable, non-sublicensable, revocable licence to access and use the Platform solely for its own internal vehicle rental business during an active Subscription. No other rights are granted, whether by implication, estoppel, or otherwise, and this licence terminates automatically on expiry or termination of the Subscription.",
      },
    ],
  },
  {
    n: 20,
    title: "AI-Assisted Features",
    body: [
      {
        t: "p",
        text:
          'The Platform may include features that use artificial intelligence or machine learning to generate suggestions, summaries, pricing recommendations, or other outputs ("AI Features"). AI Features may evolve over time and may include generative AI, predictive models, workflow automation, and decision-support tools. AI Features are provided for informational purposes only, may contain errors or inaccuracies, and must be independently reviewed by the Customer before being relied upon. The Customer remains solely responsible for all business, pricing, operational, and legal decisions made using or informed by AI Features.',
      },
    ],
  },
  {
    n: 21,
    title: "Acceptable Use",
    body: [
      {
        t: "p",
        text:
          "You must not, and must not permit any third party to: (a) misuse the Platform or use it for any unlawful purpose; (b) upload or transmit viruses, malware, or other malicious code; (c) scrape, crawl, or extract data from the Platform other than through supported APIs; (d) reverse engineer, decompile, or attempt to derive the source code of the Platform; (e) circumvent or attempt to circumvent any security or access-control measure; or (f) use the Platform to harass, defraud, or infringe the rights of any third party.",
      },
    ],
  },
  {
    n: 22,
    title: "Fair Usage",
    body: [
      {
        t: "p",
        text:
          "Subscriptions are intended for ordinary use by a single rental business in the operation of its own fleet. Drive247 may monitor Platform usage and may throttle, suspend, or charge additional fees for usage that, in Drive247's reasonable judgment, is excessive or abusive, including without limitation: (a) API call volumes materially exceeding normal usage for a business of the Customer's size; (b) automated, scripted, or bot-driven interaction with the Platform outside supported integrations; (c) data storage materially exceeding reasonable operational needs; (d) SMS, email, or WhatsApp message volumes materially exceeding ordinary rental-communication needs; or (e) any use that degrades Platform performance or availability for other customers. Except where immediate action is necessary to protect the Platform or other customers, Drive247 will provide reasonable notice and an opportunity to remedy excessive usage before restricting access.",
      },
    ],
  },
  {
    n: 23,
    title: "White-Labeling & Reproduction",
    body: [
      {
        t: "p",
        text:
          "The Customer may not copy, reproduce, reverse engineer, resell, sublicense, white-label, rebrand, or otherwise make the Platform, or any substantial part of its functionality, design, or underlying technology, available to any third party, whether for commercial purposes or otherwise, unless expressly authorized in writing by Drive247. This restriction is in addition to, and does not limit, the restrictions in Section 21 (Acceptable Use).",
      },
    ],
  },
  {
    n: 24,
    title: "Platform Availability",
    body: [
      {
        t: "p",
        text:
          'The Platform is provided on an "as available" basis. Drive247 may perform scheduled or emergency maintenance, update, add, or remove features, or otherwise change the Platform at its discretion. Drive247 does not guarantee uninterrupted or error-free operation of the Platform and will have no liability for any unavailability, subject to Section 30 (Limitation of Liability).',
      },
    ],
  },
  {
    n: 25,
    title: "Support Services",
    body: [
      {
        t: "p",
        text:
          "Drive247 provides Customer support on a commercially reasonable basis through the channels made available from time to time (including in-Platform messaging and email). Drive247 does not guarantee any specific response time or resolution time unless expressly agreed in a separate written agreement (for example, a service-level agreement). Support does not include custom software development, business or operational consultancy, legal advice, accounting or tax advice, or insurance advice, and nothing provided as part of support should be relied upon as such.",
      },
    ],
  },
  {
    n: 26,
    title: "Security",
    body: [
      {
        t: "p",
        text:
          "Drive247 maintains commercially reasonable administrative, technical, and physical safeguards designed to protect the Platform and data processed through it. No system can be guaranteed to be completely secure, and Drive247 cannot and does not guarantee absolute security. Customers are responsible for maintaining the security of their own credentials, devices, and networks used to access the Platform.",
      },
    ],
  },
  {
    n: 27,
    title: "Suspension & Termination",
    body: [
      {
        t: "p",
        text:
          "Drive247 may suspend or terminate your access to the Platform, in whole or in part, immediately and without prior notice, if: (a) you breach these Terms; (b) Drive247 reasonably suspects fraud or abuse; (c) payment cannot be collected as described in Section 7; (d) continued provision of the Platform to you would create a security risk to Drive247 or other users; or (e) required to comply with applicable law. You may cancel your Subscription at any time through the Platform or by contacting support@drive-247.com; cancellation will take effect at the end of the then-current billing period and does not, except as required by law, entitle you to a refund of fees already paid.",
      },
    ],
  },
  {
    n: 28,
    title: "Data After Termination",
    body: [
      {
        t: "p",
        text:
          "Upon termination or cancellation of your account, you are responsible for exporting any Customer Data or other records you wish to retain, using the export tools available on the Platform, before the effective date of termination. Following termination, Drive247 may retain your data for a limited period as required for legal, accounting, or legitimate business purposes, after which it may be permanently deleted in accordance with our data retention practices.",
      },
    ],
  },
  {
    n: 29,
    title: "Disclaimers",
    body: [
      {
        t: "caps",
        text:
          'TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. DRIVE247 DOES NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT ANY DEFECTS WILL BE CORRECTED.',
      },
    ],
  },
  {
    n: 30,
    title: "Limitation of Liability",
    body: [
      {
        t: "caps",
        text:
          "TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW: (A) DRIVE247 WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATING TO THESE TERMS OR YOUR USE OF THE PLATFORM, REGARDLESS OF THE THEORY OF LIABILITY AND EVEN IF DRIVE247 HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES; AND (B) DRIVE247'S AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE PLATFORM WILL NOT EXCEED THE TOTAL SUBSCRIPTION FEES PAID BY YOU TO DRIVE247 IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.",
      },
    ],
  },
  {
    n: 31,
    title: "Indemnification",
    body: [
      {
        t: "p",
        text:
          "You agree to defend, indemnify, and hold harmless Drive247, its officers, directors, employees, and agents, from and against any and all claims, liabilities, damages, losses, and expenses (including reasonable attorneys' fees) arising out of or in any way connected with: (a) your rental business operations; (b) any rental, Renter interaction, or dispute involving a Renter; (c) Customer Data or other data you upload or submit to the Platform; (d) your breach of these Terms; or (e) your violation of any applicable law.",
      },
    ],
  },
  {
    n: 32,
    title: "Platform Changes",
    body: [
      {
        t: "p",
        text:
          "Drive247 may, at its discretion, modify, improve, add to, remove, or replace features or functionality of the Platform at any time, provided that Drive247 will use reasonable efforts to avoid materially reducing core functionality that you are actively paying for without reasonable notice.",
      },
    ],
  },
  {
    n: 33,
    title: "Changes to These Terms",
    body: [
      {
        t: "p",
        text:
          "Drive247 may amend these Terms from time to time. Where changes are material, Drive247 will provide reasonable notice (for example, by email or in-Platform notice) before the changes take effect. Your continued use of the Platform after the effective date of any change constitutes your acceptance of the revised Terms. If you do not agree to a change, your sole remedy is to stop using the Platform and cancel your Subscription.",
      },
    ],
  },
  {
    n: 34,
    title: "Governing Law & Dispute Resolution",
    body: [
      {
        t: "p",
        text:
          "These Terms and any dispute arising out of or relating to them will be governed by, and construed in accordance with, the laws of [Governing Law Jurisdiction], without regard to conflict-of-laws principles. The parties consent to the exclusive jurisdiction of the courts located in [Venue] for any dispute not otherwise subject to arbitration.",
      },
    ],
  },
  {
    n: 35,
    title: "Compliance with Laws",
    body: [
      {
        t: "p",
        text:
          "Customers remain solely responsible for complying with all applicable federal, state, and local laws and regulations relating to their rental business, including but not limited to consumer protection, motor vehicle rental, insurance, tax, employment, and data privacy laws.",
      },
    ],
  },
  {
    n: 36,
    title: "Force Majeure",
    body: [
      {
        t: "p",
        text:
          "Drive247 will not be liable for any delay or failure to perform its obligations under these Terms resulting from causes beyond its reasonable control, including acts of God, natural disasters, war, terrorism, labor disputes, internet or telecommunications failures, or failures of Third-Party Services.",
      },
    ],
  },
  {
    n: 37,
    title: "Confidentiality",
    body: [
      {
        t: "p",
        text:
          "Each party agrees to use the other party's Confidential Information (information reasonably understood to be confidential given its nature and the circumstances of disclosure) solely to perform its obligations under these Terms, and to protect it using at least the same degree of care it uses to protect its own confidential information, but no less than a reasonable degree of care. This Section does not apply to information that is or becomes publicly available through no fault of the receiving party, or that is required to be disclosed by law.",
      },
    ],
  },
  {
    n: 38,
    title: "Electronic Acceptance",
    body: [
      {
        t: "p",
        text:
          'The Customer agrees that electronic acceptance of these Terms — including by creating an account, clicking "I Agree," or otherwise proceeding past a point where these Terms are presented — has the same legal effect as a handwritten signature, to the fullest extent permitted by applicable law.',
      },
    ],
  },
  {
    n: 39,
    title: "Electronic Communications",
    body: [
      {
        t: "p",
        text:
          "By using the Platform, you consent to receive operational notices, invoices, and legal notices electronically, including by email or through in-Platform notifications. Electronic communications satisfy any legal requirement that such communications be in writing.",
      },
    ],
  },
  {
    n: 40,
    title: "Assignment",
    body: [
      {
        t: "p",
        text:
          "You may not assign or transfer these Terms, or any rights or obligations under them, without Drive247's prior written consent. Drive247 may assign these Terms without your consent in connection with a merger, acquisition, corporate reorganization, or sale of substantially all of its assets.",
      },
    ],
  },
  {
    n: 41,
    title: "No Waiver",
    body: [
      {
        t: "p",
        text:
          "No failure or delay by either party in exercising any right under these Terms will operate as a waiver of that right, nor will any single or partial exercise of a right preclude any other or further exercise of that right.",
      },
    ],
  },
  {
    n: 42,
    title: "Severability",
    body: [
      {
        t: "p",
        text:
          "If any provision of these Terms is held to be invalid, illegal, or unenforceable, that provision will be limited or eliminated to the minimum extent necessary, and the remaining provisions will continue in full force and effect.",
      },
    ],
  },
  {
    n: 43,
    title: "Entire Agreement",
    body: [
      {
        t: "p",
        text:
          "These Terms, together with the Privacy Policy and any other documents expressly incorporated by reference, constitute the entire agreement between you and Drive247 regarding the Platform, and supersede all prior or contemporaneous agreements, communications, and proposals, whether oral or written, relating to the same subject matter.",
      },
    ],
  },
  {
    n: 44,
    title: "Survival",
    body: [
      {
        t: "p",
        text:
          "Provisions relating to Intellectual Property, the Licence to Use the Platform, Limitation of Liability, Indemnification, Confidentiality, and payment obligations accrued prior to termination will survive any termination or expiration of these Terms.",
      },
    ],
  },
  {
    n: 45,
    title: "Beta Features",
    body: [
      {
        t: "p",
        text:
          'From time to time, Drive247 may make beta, preview, or early-access features available. Such features are provided "as is," may be modified or withdrawn at any time without notice, and are excluded from any service-level commitments Drive247 may otherwise offer.',
      },
    ],
  },
  {
    n: 46,
    title: "Feedback",
    body: [
      {
        t: "p",
        text:
          "If you provide Drive247 with feedback, suggestions, or ideas about the Platform, you grant Drive247 an unrestricted, perpetual, royalty-free right to use that feedback for any purpose, without any obligation or compensation to you.",
      },
    ],
  },
  {
    n: 47,
    title: "Marketing & Publicity",
    body: [
      {
        t: "p",
        text:
          "Drive247 may identify the Customer as a user of the Platform, and may display the Customer's name, logo, and publicly available business information on Drive247's website, marketing materials, case studies, and investor materials, unless the Customer objects in writing, in which case Drive247 will cease such use within a reasonable time.",
      },
    ],
  },
  {
    n: 48,
    title: "Independent Contractors",
    body: [
      {
        t: "p",
        text:
          "Nothing in these Terms creates a partnership, joint venture, employment, or agency relationship between you and Drive247. Neither party has the authority to bind the other or to incur obligations on the other's behalf.",
      },
    ],
  },
  {
    n: 49,
    title: "Notices",
    body: [
      {
        t: "p",
        text:
          "Notices to Drive247 must be sent to support@drive-247.com. Notices to you will be sent to the email address or in-Platform contact details associated with your account. Notices are deemed given when sent, except that notices of termination or breach must also be confirmed by a method providing proof of delivery where legally required.",
      },
    ],
  },
  {
    n: 50,
    title: "Contact",
    body: [
      { t: "p", text: "Questions about these Terms may be directed to:" },
      { t: "p", text: "Support: support@drive-247.com" },
      { t: "p", text: "Website: https://drive-247.com" },
    ],
  },
];

/** Closing acknowledgement, rendered centred and emphasised below Section 50. */
export const PLATFORM_TOS_CLOSING =
  "BY CREATING AN ACCOUNT, SUBSCRIBING TO, OR USING THE PLATFORM, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY THESE TERMS OF SERVICE.";

/**
 * The placeholders that must survive until the solicitor supplies real values.
 * Asserted by apps/portal/src/__tests__/lib/platform-tos.test.ts.
 */
export const PLATFORM_TOS_PENDING_PLACEHOLDERS = [
  "[Governing Law Jurisdiction]",
  "[Venue]",
  "[Privacy Policy URL]",
] as const;
