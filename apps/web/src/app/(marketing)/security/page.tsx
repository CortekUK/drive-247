import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security & Compliance — Drive247",
  description: "How Drive247 keeps your data safe.",
};

export default function SecurityPage() {
  return (
    <article className="prose prose-zinc mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1>Security &amp; Compliance</h1>
      <p className="lead">
        Drive247 takes the security of your business data seriously. Here is
        an overview of our practices and commitments.
      </p>

      <h2>Infrastructure</h2>
      <ul>
        <li>
          Hosted on industry-leading cloud infrastructure with SOC 2 and ISO
          27001 certifications.
        </li>
        <li>All data encrypted in transit (TLS 1.2+) and at rest (AES-256).</li>
        <li>Automated backups with point-in-time recovery.</li>
      </ul>

      <h2>Application security</h2>
      <ul>
        <li>Role-based access control for operator accounts.</li>
        <li>Server-side input validation and parameterized database queries.</li>
        <li>Rate limiting and abuse protection on public endpoints.</li>
        <li>Regular dependency audits and security patching.</li>
      </ul>

      <h2>Payment handling</h2>
      <p>
        Payments are processed through Stripe, a PCI DSS Level 1 certified
        provider. Drive247 never stores raw credit card numbers.
      </p>

      <h2>Data privacy</h2>
      <ul>
        <li>
          Rental operators are data controllers; Cortek acts as a data processor
          under a formal data processing agreement.
        </li>
        <li>
          Data can be exported or deleted upon request in compliance with
          applicable regulations.
        </li>
      </ul>

      <h2>Responsible disclosure</h2>
      <p>
        If you discover a security vulnerability, please report it to{" "}
        <a href="mailto:security@cortek.co">security@cortek.co</a>. We
        appreciate responsible disclosure and will respond within 48 hours.
      </p>
    </article>
  );
}
