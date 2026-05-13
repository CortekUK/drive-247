import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Drive247",
  description: "How Drive247 and Cortek handle your data.",
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-zinc mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1>Privacy Policy</h1>
      <p className="lead">
        Last updated: February 2026
      </p>

      <h2>Who we are</h2>
      <p>
        Drive247 is a product of Cortek (&quot;we&quot;, &quot;us&quot;,
        &quot;our&quot;), a UK-registered company. We act as a{" "}
        <strong>data processor</strong> on behalf of the independent rental
        operators (&quot;controllers&quot;) who use our platform to manage their
        car rental businesses.
      </p>

      <h2>What data we collect</h2>
      <ul>
        <li>
          <strong>Lead information:</strong> Email address submitted via our
          landing page contact form.
        </li>
        <li>
          <strong>Usage data:</strong> Anonymous analytics to improve our
          website (pages visited, referral source, device type).
        </li>
      </ul>

      <h2>How we use your data</h2>
      <ul>
        <li>To respond to enquiries and schedule calls.</li>
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
        <a href="mailto:privacy@cortek.co">privacy@cortek.co</a>.
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
