import type { Metadata } from 'next';
import { Card } from "@/components/ui/card";
import { getPrivacyPageContent, getLegalTenantBranding } from "@/lib/legal-page-content";
import LegalPageShell from "@/components/legal/LegalPageShell";

// Server-rendered so carrier / A2P 10DLC review crawlers and SEO bots see the
// full policy text without executing JS. Client rendering left the server HTML
// blank and failed SMS campaign vetting (errors 30908 / 30882). Uses
// LegalPageShell (not the client Navigation/Footer, whose server fallback is
// the platform's default branding) so the page is visibly the TENANT's own.
export const dynamic = 'force-dynamic';

const LEGAL_CONTENT_STYLES = `
  .legal-content h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: hsl(var(--primary));
    font-family: var(--font-display);
  }
  .legal-content h2:first-child {
    margin-top: 0;
  }
  .legal-content p {
    color: hsl(var(--muted-foreground));
    margin-bottom: 1rem;
    line-height: 1.75;
  }
  .legal-content ul {
    list-style-type: disc;
    margin-left: 1.5rem;
    margin-bottom: 1rem;
    color: hsl(var(--muted-foreground));
  }
  .legal-content li {
    margin-bottom: 0.5rem;
    line-height: 1.6;
  }
  .legal-content a {
    color: hsl(var(--accent));
    text-decoration: none;
  }
  .legal-content a:hover {
    text-decoration: underline;
  }
`;

export async function generateMetadata(): Promise<Metadata> {
  const [content, tenant] = await Promise.all([
    getPrivacyPageContent(),
    getLegalTenantBranding(),
  ]);
  return { title: `${content.title || 'Privacy Policy'} | ${tenant.name}` };
}

export default async function PrivacyPage() {
  const [privacyContent, tenant] = await Promise.all([
    getPrivacyPageContent(),
    getLegalTenantBranding(),
  ]);

  return (
    <LegalPageShell tenant={tenant}>
      <section className="pt-12 pb-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-5xl md:text-6xl font-display font-bold mb-6 text-gradient-metal">
              {privacyContent.title}
            </h1>

            <Card className="p-8 md:p-12 shadow-metal bg-card/50 backdrop-blur">
              <style>{LEGAL_CONTENT_STYLES}</style>
              <div
                className="legal-content"
                dangerouslySetInnerHTML={{ __html: privacyContent.content }}
              />

              {privacyContent.last_updated && (
                <p className="text-sm text-muted-foreground pt-6 mt-6 border-t border-border">
                  Last updated: {new Date(privacyContent.last_updated).toLocaleDateString('en-US')}
                </p>
              )}
            </Card>
          </div>
        </div>
      </section>
    </LegalPageShell>
  );
}
