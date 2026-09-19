import LegacyRootLayout, { generateMetadata as legacyMetadata } from './(legacy)/layout';
import LegacyNotFound from './(legacy)/not-found';

/**
 * The 404 for an address no page answers — the original design's 404 inside
 * the original design's layout, with a real 404 status, exactly as it was when
 * app/not-found.tsx sat next to the booking app's single root layout.
 *
 * Needed because the booking app now has two root layouts — (legacy) for every
 * tenant's original design and (northwind) for Northwind's new design — and Next
 * cannot pick a root layout for an unmatched address by itself
 * (next.config.ts: experimental.globalNotFound).
 *
 * Northwind never reaches this: the middleware sends all of Northwind's pages to
 * the new design, whose own catch-all answers unknown addresses.
 */
export const generateMetadata = legacyMetadata;

export default function GlobalNotFound() {
  return (
    <LegacyRootLayout>
      <LegacyNotFound />
    </LegacyRootLayout>
  );
}
