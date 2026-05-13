import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Drive247",
  description: "Terms governing use of the Drive247 platform.",
};

export default function TermsPage() {
  return (
    <article className="prose prose-zinc mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1>Terms of Service</h1>
      <p className="lead">
        Last updated: February 2026
      </p>

      <h2>1. Agreement</h2>
      <p>
        By accessing or using the Drive247 platform (&quot;Service&quot;),
        operated by Cortek (&quot;Company&quot;), you agree to be bound by
        these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>2. Service description</h2>
      <p>
        Drive247 provides a software-as-a-service platform for independent car
        rental operators, including a branded booking website, operations
        administration dashboard, and renter portal.
      </p>

      <h2>3. Accounts &amp; access</h2>
      <p>
        You are responsible for maintaining the confidentiality of your account
        credentials and for all activities that occur under your account.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        You agree not to misuse the Service, interfere with its operation, or
        use it for any unlawful purpose. We reserve the right to suspend
        accounts that violate these terms.
      </p>

      <h2>5. Intellectual property</h2>
      <p>
        The Service, including its code, design, and documentation, is owned by
        Cortek. Your data remains yours — you may export it at any time.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Cortek shall not be liable for
        any indirect, incidental, or consequential damages arising from use of
        the Service.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these terms from time to time. Continued use of the
        Service constitutes acceptance of the updated terms.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions about these terms? Email us at{" "}
        <a href="mailto:legal@cortek.co">legal@cortek.co</a>.
      </p>
    </article>
  );
}
