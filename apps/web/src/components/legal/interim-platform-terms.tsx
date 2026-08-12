/**
 * DRIVE247 PLATFORM TERMS OF USE — the INTERIM canonical platform contract.
 *
 * Served at drive-247.com/terms while PLATFORM_TOS_IS_DRAFT is true, i.e. until
 * the solicitor signs off on the Appendix A rewrite.
 *
 * WHY THIS DOCUMENT AND NOT THE MARKETING ONE IT REPLACED.
 * Two operator-facing terms documents were live before the consolidation: this
 * 13-section text (served by the portal at {tenant}.portal.drive-247.com/terms)
 * and an 8-section summary on the marketing site. Consolidating onto the
 * marketing URL initially carried the marketing *text* across too — which meant
 * that during the sign-off window the contract a tenant is charged against had
 * no payment terms, no governing law, no liability cap and no warranty
 * disclaimer. This document has all four (sections 5, 12, 9 and 10).
 *
 * The legal wording is byte-identical to what was already published; only the
 * wrapper markup changed (portal Card + "use client" → the marketing site's
 * prose article, so it renders server-side alongside /privacy and /security).
 * Nothing here was drafted, reworded, or summarised — per the handoff, legal
 * copy goes back to Ghulam rather than being edited inline.
 *
 * KNOWN TENSION, flagged not resolved: section 12 says England and Wales, while
 * Appendix A leaves [Governing Law Jurisdiction] open pending the solicitor and
 * describes the platform as serving operators "within the United States". If
 * the solicitor lands on a US jurisdiction, this interim clause is inconsistent
 * with where the contract is heading. It is unchanged from what was already
 * live, so this is not a new exposure — but it is the clause to ask about first.
 *
 * The 8-section marketing text this replaced is in git:
 *   git show d54f96d7:apps/web/src/app/\(marketing\)/terms/page.tsx
 */

export function InterimPlatformTerms() {
  return (
    <article className="prose prose-zinc mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1>Drive247 Platform Terms of Use</h1>
      <p className="lead">
        These Platform Terms of Use (&quot;Terms&quot;) govern access to and use
        of the Drive247 software platform (the &quot;System&quot;), operated by{" "}
        <em>Cortek Systems Ltd (&quot;Cortek&quot;)</em>.
      </p>
      <p>
        By accessing or using the System, the Client and its authorised users
        agree to be bound by these Terms.
      </p>

      <h2>1. Scope of the System</h2>
      <p>
        The System is a cloud-based software platform designed to assist vehicle
        rental businesses with administrative workflows, including booking
        management, customer record keeping, document processing, and
        operational automation.
      </p>
      <p>
        The System is provided solely as a technology tool and does not provide
        operational, legal, financial, insurance, or compliance services.
      </p>

      <h2>2. Authorised Users</h2>
      <p>Access to the System is limited to:</p>
      <ul>
        <li>The Client (vehicle rental operator); and</li>
        <li>
          Employees or authorised representatives of the Client (&quot;Authorised
          Users&quot;).
        </li>
      </ul>
      <p>
        The Client is responsible for all actions taken by its Authorised Users
        and for maintaining secure login credentials.
      </p>

      <h2>3. Client Operational Responsibility</h2>
      <p>
        The Client retains full and exclusive responsibility for all vehicle
        rental operations, including but not limited to:
      </p>
      <ul>
        <li>Approval or rejection of rental bookings;</li>
        <li>Verification of customer identity and documentation;</li>
        <li>Confirmation of insurance coverage;</li>
        <li>Execution of rental agreements;</li>
        <li>Vehicle release and key handover decisions;</li>
        <li>Compliance with applicable laws and regulations.</li>
      </ul>
      <p>
        The System does not make operational decisions. Any automated workflows
        are administrative in nature and do not constitute approvals,
        guarantees, or authorisations.
      </p>

      <h2>4. Third-Party Services</h2>
      <p>
        The System may integrate with third-party service providers, including
        but not limited to:
      </p>
      <ul>
        <li>Payment processors (e.g., Stripe);</li>
        <li>Insurance providers (e.g., Bonzah);</li>
        <li>Electronic signature services (e.g., BoldSign);</li>
        <li>Identity verification services; and</li>
        <li>Other external integrations.</li>
      </ul>
      <p>
        All third-party services remain independent providers. Cortek does not
        control, guarantee, or assume liability for the performance,
        availability, accuracy, or outcomes of any third-party services.
      </p>

      <h2>5. Payments</h2>
      <p>The System does not collect, hold, or process client funds.</p>
      <p>
        All payment transactions are conducted directly between renters and the
        Client through third-party payment processors. Cortek is not a payment
        intermediary and assumes no responsibility for payment processing,
        disputes, or fund transfers.
      </p>

      <h2>6. Data Responsibility</h2>
      <p>
        The Client determines what personal and operational data is collected
        through the System and is solely responsible for ensuring lawful use,
        storage, and retention of such data.
      </p>
      <p>
        Cortek processes data solely to provide the System and does not control
        or independently verify the accuracy or legality of information entered
        by the Client.
      </p>

      <h2>7. System Availability</h2>
      <p>
        The System is provided on an &quot;as available&quot; basis. Cortek does
        not guarantee uninterrupted operation, error-free performance, or
        specific uptime levels.
      </p>
      <p>
        Temporary outages, maintenance, or service interruptions may occur.
      </p>

      <h2>8. Acceptable Use</h2>
      <p>The Client and its Authorised Users must not:</p>
      <ul>
        <li>Use the System for unlawful activities;</li>
        <li>Attempt to bypass security measures;</li>
        <li>Interfere with system integrity;</li>
        <li>Reverse engineer or replicate the System;</li>
        <li>Provide unauthorised access to third parties.</li>
      </ul>

      <h2>9. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, Cortek shall not be liable for
        any indirect, consequential, or business losses arising from use of the
        System, including loss of revenue, customers, or operational disruption.
      </p>
      <p>
        Cortek&apos;s total liability arising from use of the System shall not
        exceed the fees paid by the Client for access to the System during the
        preceding twelve (12) months.
      </p>

      <h2>10. No Warranty</h2>
      <p>
        The System is provided without warranties of any kind, whether express
        or implied, including fitness for a particular purpose or operational
        reliability.
      </p>

      <h2>11. Changes to Terms</h2>
      <p>
        Cortek may update these Terms from time to time. Continued use of the
        System constitutes acceptance of any updated Terms.
      </p>

      <h2>12. Governing Law</h2>
      <p>These Terms are governed by the laws of England and Wales.</p>

      <h2>13. Acceptance</h2>
      <p>
        By accessing or continuing to use the System, the Client and its
        Authorised Users acknowledge and agree to these Terms.
      </p>
    </article>
  );
}
