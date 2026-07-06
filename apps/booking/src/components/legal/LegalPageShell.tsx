// Server-rendered chrome for the public compliance pages (/privacy, /terms,
// /sms-opt-in). These pages are fetched by carrier A2P 10DLC reviewers with a
// no-JavaScript client, so everything here must render real HTML on the
// server. The app's normal <Navigation/> and <Footer/> are client components
// whose SERVER fallback is the platform's default branding ("Drive 247 —
// Reliable Dallas Car Rentals") — which made tenant compliance pages look
// like they belong to a different company and failed campaign vetting
// (errors 30908/30882). This shell renders the TENANT's own identity instead.
//
// Used ONLY by the three compliance routes — no other page is affected.

import Link from 'next/link';
import { getTenantLegalEntityLine } from '@/config/tenant-config';

export interface LegalTenantBranding {
  slug: string | null;
  name: string;            // public brand name (app_name || company_name)
  contactEmail: string | null;
  contactPhone: string | null;
}

export function LegalPageShell({
  tenant,
  children,
}: {
  tenant: LegalTenantBranding;
  children: React.ReactNode;
}) {
  const legalLine = getTenantLegalEntityLine(tenant.slug);
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Server-rendered header — tenant brand, links home */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-5 flex items-center justify-between">
          <Link href="/" className="text-xl font-display font-bold text-foreground">
            {tenant.name}
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to {tenant.name}
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/* Server-rendered footer — tenant identity + compliance links */}
      <footer className="border-t border-border mt-16">
        <div className="container mx-auto px-4 py-8 space-y-3 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="font-medium text-foreground">{tenant.name}</span>
            {tenant.contactPhone && <span>{tenant.contactPhone}</span>}
            {tenant.contactEmail && (
              <a href={`mailto:${tenant.contactEmail}`} className="hover:text-foreground">
                {tenant.contactEmail}
              </a>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-foreground underline">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground underline">Terms of Service</Link>
            <Link href="/sms-opt-in" className="hover:text-foreground underline">SMS Messaging Terms</Link>
          </div>
          {legalLine && <p className="text-xs leading-relaxed">{legalLine}</p>}
          <p className="text-xs">© {year} {tenant.name}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default LegalPageShell;
