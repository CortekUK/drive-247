import { loadFleetSeed } from '@nw/components/fleet/fleet-seed';
import { getTenantSlug } from '@nw/lib/cms/server';
import { Template2Closing } from '@nw/template-2/closing';

/**
 * Template 2 ("Glass") — the closing call to action at the foot of a page
 * (Fleet and Pricing, Promotions, Reviews, Contact, the policies, the blog):
 * the home page's closing pane, with the server's fleet as its first paint.
 * Spaced like one more pane in the page's stack, above the footer.
 */
export async function Template2PageClosing({ fleetLink = true }: { fleetLink?: boolean }) {
  const slug = await getTenantSlug();
  const seed = slug ? await loadFleetSeed(slug) : null;
  return (
    <div className="pb-3">
      <Template2Closing seed={seed} flush fleetLink={fleetLink} />
    </div>
  );
}
