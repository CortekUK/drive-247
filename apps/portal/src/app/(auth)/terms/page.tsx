"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">
            DRIVE247 PLATFORM TERMS OF USE
          </CardTitle>
          <p className="text-sm text-muted-foreground text-center mt-2">
            These Platform Terms of Use (&quot;Terms&quot;) govern access to and use of the Drive247 software platform (the &quot;System&quot;), operated by <em>Cortek Systems Ltd (&quot;Cortek&quot;)</em>.
          </p>
          <p className="text-sm text-muted-foreground text-center">
            By accessing or using the System, the Client and its authorised users agree to be bound by these Terms.
          </p>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-lg font-semibold">1. Scope of the System</h2>
            <p className="text-sm text-muted-foreground">
              The System is a cloud-based software platform designed to assist vehicle rental businesses with administrative workflows, including booking management, customer record keeping, document processing, and operational automation.
            </p>
            <p className="text-sm text-muted-foreground">
              The System is provided solely as a technology tool and does not provide operational, legal, financial, insurance, or compliance services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">2. Authorised Users</h2>
            <p className="text-sm text-muted-foreground">Access to the System is limited to:</p>
            <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
              <li>The Client (vehicle rental operator); and</li>
              <li>Employees or authorised representatives of the Client (&quot;Authorised Users&quot;).</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              The Client is responsible for all actions taken by its Authorised Users and for maintaining secure login credentials.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">3. Client Operational Responsibility</h2>
            <p className="text-sm text-muted-foreground">
              The Client retains full and exclusive responsibility for all vehicle rental operations, including but not limited to:
            </p>
            <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
              <li>Approval or rejection of rental bookings;</li>
              <li>Verification of customer identity and documentation;</li>
              <li>Confirmation of insurance coverage;</li>
              <li>Execution of rental agreements;</li>
              <li>Vehicle release and key handover decisions;</li>
              <li>Compliance with applicable laws and regulations.</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              The System does not make operational decisions. Any automated workflows are administrative in nature and do not constitute approvals, guarantees, or authorisations.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">4. Third-Party Services</h2>
            <p className="text-sm text-muted-foreground">
              The System may integrate with third-party service providers, including but not limited to:
            </p>
            <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
              <li>Payment processors (e.g., Stripe);</li>
              <li>Insurance providers (e.g., Bonzah);</li>
              <li>Electronic signature services (e.g., BoldSign);</li>
              <li>Identity verification services; and</li>
              <li>Other external integrations.</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              All third-party services remain independent providers. Cortek does not control, guarantee, or assume liability for the performance, availability, accuracy, or outcomes of any third-party services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">5. Payments</h2>
            <p className="text-sm text-muted-foreground">
              The System does not collect, hold, or process client funds.
            </p>
            <p className="text-sm text-muted-foreground">
              All payment transactions are conducted directly between renters and the Client through third-party payment processors. Cortek is not a payment intermediary and assumes no responsibility for payment processing, disputes, or fund transfers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">6. Data Responsibility</h2>
            <p className="text-sm text-muted-foreground">
              The Client determines what personal and operational data is collected through the System and is solely responsible for ensuring lawful use, storage, and retention of such data.
            </p>
            <p className="text-sm text-muted-foreground">
              Cortek processes data solely to provide the System and does not control or independently verify the accuracy or legality of information entered by the Client.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">7. System Availability</h2>
            <p className="text-sm text-muted-foreground">
              The System is provided on an &quot;as available&quot; basis. Cortek does not guarantee uninterrupted operation, error-free performance, or specific uptime levels.
            </p>
            <p className="text-sm text-muted-foreground">
              Temporary outages, maintenance, or service interruptions may occur.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">8. Acceptable Use</h2>
            <p className="text-sm text-muted-foreground">The Client and its Authorised Users must not:</p>
            <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
              <li>Use the System for unlawful activities;</li>
              <li>Attempt to bypass security measures;</li>
              <li>Interfere with system integrity;</li>
              <li>Reverse engineer or replicate the System;</li>
              <li>Provide unauthorised access to third parties.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold">9. Limitation of Liability</h2>
            <p className="text-sm text-muted-foreground">
              To the maximum extent permitted by law, Cortek shall not be liable for any indirect, consequential, or business losses arising from use of the System, including loss of revenue, customers, or operational disruption.
            </p>
            <p className="text-sm text-muted-foreground">
              Cortek&apos;s total liability arising from use of the System shall not exceed the fees paid by the Client for access to the System during the preceding twelve (12) months.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">10. No Warranty</h2>
            <p className="text-sm text-muted-foreground">
              The System is provided without warranties of any kind, whether express or implied, including fitness for a particular purpose or operational reliability.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">11. Changes to Terms</h2>
            <p className="text-sm text-muted-foreground">
              Cortek may update these Terms from time to time. Continued use of the System constitutes acceptance of any updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">12. Governing Law</h2>
            <p className="text-sm text-muted-foreground">
              These Terms are governed by the laws of England and Wales.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">13. Acceptance</h2>
            <p className="text-sm text-muted-foreground">
              By accessing or continuing to use the System, the Client and its Authorised Users acknowledge and agree to these Terms.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
