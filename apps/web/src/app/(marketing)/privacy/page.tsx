import type { Metadata } from "next";

/**
 * THE CANONICAL Drive247 Privacy Policy — drive-247.com/privacy
 *
 * WHY THIS PAGE CHANGED. It previously opened by stating, without qualification,
 * that Cortek "act[s] as a data processor on behalf of the independent rental
 * operators (controllers)". That is true of RENTER data — the records an
 * operator enters about its own customers — and it was the only audience the
 * page had when it was purely a marketing-site policy.
 *
 * It is no longer the only audience. The portal's /privacy-policy route now
 * redirects here, so this is also the policy that a rental operator and its
 * STAFF accept when they sign in and when they subscribe. For their own account
 * data, Cortek decides the purposes and means — that is a CONTROLLER
 * relationship, and the blanket processor claim stated the opposite. Getting
 * that backwards is not a wording nit: the two roles carry different duties.
 *
 * ── WHAT IS STILL OUTSTANDING (Ghulam) ────────────────────────────────────────
 * This page now describes the ROLES and the CATEGORIES of data accurately, which
 * is a factual description of what the platform demonstrably does. It stops
 * there, deliberately. The full policy still needs, and this page does not
 * invent:
 *   · a retention period for operator/staff account data (the 24-month figure
 *     below covers marketing leads only, and was already published)
 *   · lawful bases for each processing purpose
 *   · the sub-processor list (Supabase, Stripe, AWS SES/SNS, Twilio, OpenAI,
 *     BoldSign and Bonzah are all in the stack)
 *   · international transfer mechanism (UK company, US-hosted infrastructure)
 *   · the rights-request procedure and response times
 * Those create binding commitments and belong to whoever owns the document.
 */

export const metadata: Metadata = {
  title: "Privacy Policy — Drive247",
  description: "How Drive247 and Cortek handle your data.",
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-zinc mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1>Privacy Policy</h1>
      <p className="lead">Last updated: August 2026</p>

      <p>
        <strong>We are expanding this policy.</strong> The sections below
        describe who is responsible for your information and what we hold. A
        fuller policy — covering retention periods for account data, the
        providers we rely on, and how to exercise your rights — is being
        finalised and will be published here. In the meantime you can reach us
        at <a href="mailto:privacy@cortek.co">privacy@cortek.co</a> with any
        question about your data.
      </p>

      <h2>Who we are</h2>
      <p>
        Drive247 is a product of Cortek (&quot;we&quot;, &quot;us&quot;,
        &quot;our&quot;), a UK-registered company. Drive247 is a software
        platform used by independent vehicle rental businesses to run their
        operations.
      </p>

      <h2>Who this policy covers</h2>
      <p>
        Our role differs depending on whose information is involved, so this
        policy covers three groups:
      </p>
      <ul>
        <li>
          <strong>Visitors to this website.</strong> If you contact us or submit
          the enquiry form, we decide how that information is used, so we are
          the <strong>controller</strong> of it.
        </li>
        <li>
          <strong>Rental operators and their staff.</strong> If you hold a
          Drive247 portal account, we decide how your account and sign-in
          information is used in order to provide and secure the platform, so we
          are the <strong>controller</strong> of it.
        </li>
        <li>
          <strong>Renters.</strong> Information about renters is entered and
          controlled by the rental business you booked with. They are the{" "}
          <strong>controller</strong>; we act as a{" "}
          <strong>processor</strong> on their behalf and only handle that
          information on their instructions. For how a particular rental
          business uses your information, see the privacy policy on their own
          booking site.
        </li>
      </ul>

      <h2>What data we collect</h2>
      <ul>
        <li>
          <strong>Lead information:</strong> Email address submitted via our
          landing page contact form.
        </li>
        <li>
          <strong>Operator and staff account information:</strong> Name, email
          address, role within the business, and sign-in records for the users a
          rental business creates on its portal account.
        </li>
        <li>
          <strong>Usage data:</strong> Anonymous analytics to improve our
          website (pages visited, referral source, device type).
        </li>
      </ul>

      <h2>How we use your data</h2>
      <ul>
        <li>To respond to enquiries and schedule calls.</li>
        <li>
          To provide, secure, support, and bill for the Drive247 platform.
        </li>
        <li>To improve our marketing and website experience.</li>
        <li>We do not sell your personal data to third parties.</li>
      </ul>

      <h2>Data retention</h2>
      <p>
        Lead data is retained for up to 24 months or until you request
        deletion. Platform data processed on behalf of rental operators is
        retained per their instructions and our data processing agreement.
      </p>

      <h2>Your rights</h2>
      <p>
        You may request access to, correction of, or deletion of your personal
        data by contacting us at{" "}
        <a href="mailto:privacy@cortek.co">privacy@cortek.co</a>. If your
        request concerns information held by a rental business about a booking,
        we will pass it to that business, who is responsible for answering it.
      </p>

      <h2>Related documents</h2>
      <p>
        Use of the Drive247 platform is also governed by our{" "}
        <a href="/terms">Terms of Service</a>.
      </p>

      <h2>Contact</h2>
      <p>
        Cortek
        <br />
        Email: <a href="mailto:privacy@cortek.co">privacy@cortek.co</a>
      </p>
    </article>
  );
}
