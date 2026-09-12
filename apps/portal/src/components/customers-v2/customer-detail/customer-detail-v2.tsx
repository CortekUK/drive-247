"use client";

/**
 * The customer record — the v2 customer detail screen.
 *
 * Gated to the `northwind` canary by `useV2("customers")`; the other tenants
 * keep the 1,955-line v1 page byte for byte. See `lib/v2.ts` and V2_PLAN §2.
 *
 * ── the idea ────────────────────────────────────────────────────────────────
 *
 * A customer record ALREADY EXISTS, so there is no Save and no Submit: an edit
 * applies on the keystroke. Anything PRODUCED from the record — a verification
 * verdict, a written summary — notices when the record moves underneath it,
 * says so in amber, shows exactly what changed, and offers both ways out. Amber
 * means exactly one thing here: an output is behind its inputs. It is an
 * ordinary Tuesday, never an error. A block is red, and never amber.
 *
 * ── the three columns, and why one of them is missing from this file ────────
 *
 * The playground prototype was a full-screen page with no app chrome, so it
 * drew all three columns itself: section rail, panel, overview. The real route
 * sits inside `(dashboard)/layout.tsx`, which already renders a sidebar — so
 * drawing a third column here stacked two sidebars side by side, which is what
 * the first pass of this screen did.
 *
 * The section rail therefore REPLACES the app sidebar rather than joining it,
 * in `shared/layout/app-sidebar-v2.tsx`. That file already does exactly this
 * for Settings (`isSettingsPage`) and for the rental control centre
 * (`isRentalDetailPage`); customers is the third. This file draws the two
 * columns that are left.
 *
 * ── how the rail and this file agree ────────────────────────────────────────
 *
 * They share nothing. No context, no store, no props — they are siblings in the
 * tree and could not pass anything to each other without a provider wrapping
 * the whole dashboard. What they share instead is:
 *
 *   the URL     `?section=money` — both read it with `useSearchParams`
 *   the list    `sections.ts` — both import SECTIONS, so neither owns it
 *   the data    `useCustomerRow` — same query key, so one fetch, one cache
 *
 * ── each column states a fact exactly once ──────────────────────────────────
 *
 *   RAIL (the sidebar)  where am I, where can I go. No state at all.
 *   MIDDLE (here)       the section you are working in.
 *   RIGHT               the conclusion: can this person be handed keys, and
 *                       what is stopping it. No section can answer that alone —
 *                       Verification does not know the balance, Account does
 *                       not know the licence expired last week — so it gets a
 *                       column rather than being restated on every section.
 */

import { useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { useCustomerDetailV2 } from "./use-customer-detail-v2";
import { SECTIONS, readSectionFrom, sectionHref, type SectionId, type SectionProps } from "./sections";
import { SectionIdentity } from "./section-identity";
import { SectionLicence } from "./section-licence";
import { SectionDocuments } from "./section-documents";
import { SectionVerification } from "./section-verification";
import { SectionAccount } from "./section-account";
import { SectionConsent } from "./section-consent";
import { SectionRentals } from "./section-rentals";
import { SectionMoney } from "./section-money";
import { SectionFines } from "./section-fines";
import { SectionReviews } from "./section-reviews";
import { SectionActivity } from "./section-activity";
import { OverviewRail } from "./overview-rail";
import { ResponsiveContextRail } from "@/components/timeline-v2/context-rail";
import { EmptyHint, Panel, expiryOf, fmtDate } from "./kit";
import type { Drift } from "./kit";
import type { CustomerRecord } from "./types";

/**
 * Which component draws which section.
 *
 * A section with no entry here renders its "not built yet" panel below rather
 * than a blank column — so the rail can carry all eleven from day one. Adding
 * one is a line here plus a file; nothing else in this component changes.
 *
 * The two sections that also take a `drift` prop are wrapped rather than typed
 * loosely, so the shared `SectionProps` contract stays exactly what every
 * section is handed and neither of these can be mounted without its drift.
 */
type ViewProps = SectionProps & { verifyDrift: Drift[]; reviewDrift: Drift[] };

const SECTION_VIEWS: Partial<Record<SectionId, React.ComponentType<ViewProps>>> = {
  identity: SectionIdentity,
  licence: SectionLicence,
  documents: SectionDocuments,
  verification: ({ verifyDrift, reviewDrift: _r, ...p }) => <SectionVerification {...p} drift={verifyDrift} />,
  account: SectionAccount,
  consent: SectionConsent,
  rentals: SectionRentals,
  money: SectionMoney,
  fines: SectionFines,
  reviews: ({ reviewDrift, verifyDrift: _v, ...p }) => <SectionReviews {...p} drift={reviewDrift} />,
  activity: SectionActivity,
};

export function CustomerDetailV2() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const id = (params?.id as string) ?? "";
  const section = readSectionFrom(searchParams.get("section"), searchParams.get("tab"));

  const { record, isLoading, notFound, set, saving, verifyDrift, reviewDrift, canEdit, currency } =
    useCustomerDetailV2(id);

  /**
   * Move to another section.
   *
   * `replace`, not `push`: eleven sections behind one customer would mean an
   * operator who looked at all of them has to press Back eleven times to get
   * out of the record. `scroll: false` because the frame does not scroll —
   * there is no scroll position to restore, and Next's default would fight the
   * panel's own scroll container.
   */
  const onJump = useCallback(
    (next: SectionId) => {
      if (!id) return;
      router.replace(sectionHref(id, next), { scroll: false });
    },
    [id, router]
  );

  /* ── the states before a section can mount ──────────────────────────── */

  if (isLoading) {
    return (
      <Frame>
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </Frame>
    );
  }

  if (notFound || !record) {
    return (
      <Frame>
        <div className="flex h-full min-h-0 w-full max-w-3xl flex-col">
          <div className="shrink-0">
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
              <Link href="/customers">
                <ArrowLeft />
                All customers
              </Link>
            </Button>
            <h2 className="font-heading text-2xl font-medium tracking-tight">That customer is not here</h2>
          </div>
          <div className="mt-7 min-h-0 flex-1 overflow-y-auto">
            <EmptyHint>
              It has either been deleted, or it belongs to a different account. Nothing was changed.
            </EmptyHint>
          </div>
        </div>
      </Frame>
    );
  }

  const View = SECTION_VIEWS[section];
  const meta = SECTIONS.find((s) => s.id === section)!;
  const props: ViewProps = { c: record, set, onJump, canEdit, currency, verifyDrift, reviewDrift };
  const alert = blockingAlert(record);

  return (
    <Frame>
      {/* Keyed on the section so the scroll container is a NEW node each time.
          Without it the panel keeps the previous section's scroll offset and
          you land halfway down a screen you have never seen. */}
      <div key={section} className="flex min-w-0 flex-1 flex-col overflow-hidden pr-6">
        {/* The one fact that changes what every other section means, so it
            follows the reader to all of them. Deliberately short: the right
            rail carries the full picture, and this strip exists only so a
            blocked customer cannot be edited for ten minutes by someone who
            never looked right. */}
        {alert && (
          <div className="mb-5 max-w-3xl shrink-0 rounded-4xl bg-destructive/[0.07] px-6 py-5 ring-1 ring-destructive/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="font-heading text-sm font-semibold text-destructive">{alert.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-destructive/80">{alert.body}</p>
              </div>
              <Button
                variant="link"
                size="sm"
                onClick={() => onJump(alert.section)}
                className="-mt-1 ml-auto shrink-0 text-destructive"
              >
                Review
              </Button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {View ? (
            <View {...props} />
          ) : (
            <Panel title={meta.label} description="">
              <EmptyHint>
                This section has not been built yet. Everything it will show is already on the record —
                nothing is hidden, it just has no screen of its own here so far.
              </EmptyHint>
            </Panel>
          )}
        </div>
      </div>

      {/* ── the overview ─────────────────────────────────────────────────
          Holds no state of its own — everything on it is derived from the same
          record the middle column edits, so it cannot fall out of step with it.

          `min-[1400px]` rather than `xl`, and the width carries a right gutter
          inside itself. The v2 chrome parks a fixed dock against the right edge
          of the viewport — Ask AI, messages, enquiries, notifications,
          vertically centred — so a rail flush to that edge has its values
          printed underneath four icons. The gutter lives inside the rail so the
          border still lands where the column ends.

          The breakpoint is 1400 because at 1280 the middle column would be
          about 450px wide, and its field grids are viewport-keyed: they would
          stay two-up in a column too narrow to hold them. Below 1400 the rail
          drops out and the middle takes the space instead. */}
      <ResponsiveContextRail label="Timeline & at a glance" breakpoint={1400} width={344}>
        <OverviewRail
          c={record}
          verifyDrift={verifyDrift}
          reviewDrift={reviewDrift}
          onJump={onJump}
          currency={currency}
          saving={saving}
        />
      </ResponsiveContextRail>
    </Frame>
  );
}

/**
 * The single hardest stop on this record, or nothing.
 *
 * Ordered hardest-first and returns ONE, because a stack of red boxes above the
 * panel is read as decoration rather than as a stop.
 */
function blockingAlert(c: CustomerRecord): { title: string; body: string; section: SectionId } | null {
  if (c.account.globalBlocks.length) {
    return {
      title: "This identity is on the blocklist",
      body:
        c.account.globalBlocks[0].reason ||
        "No reason recorded. The entry is keyed on the identity, not on this record.",
      section: "account",
    };
  }
  if (c.account.blockedHere) {
    return {
      title: "Blocked with you — new bookings are refused",
      body:
        c.account.blockedHere.reason ||
        `No reason recorded yet. Blocked ${fmtDate(c.account.blockedHere.at)}.`,
      section: "account",
    };
  }
  if (c.account.status === "Rejected") {
    return {
      title: "This customer was rejected",
      body: c.account.rejection?.reason || "No reason recorded yet. Add one on Account.",
      section: "account",
    };
  }
  if (expiryOf(c.licence.expiry).state === "expired") {
    return {
      title: "Their licence has expired",
      body: `It ran out on ${fmtDate(c.licence.expiry)}. A car cannot legally go out against it.`,
      section: "licence",
    };
  }
  return null;
}

/**
 * The fixed frame.
 *
 * The page itself never scrolls; each column scrolls its own content, so the
 * section title and the primary actions stay in view however long the list
 * under them runs. That takes a bounded height, and the dashboard layout does
 * not supply one — its wrapper is `min-h-svh`, which grows.
 *
 * So the height is stated here: the viewport, less the `p-4` that
 * `(dashboard)/layout.tsx` puts around `<main>`. `100svh` rather than `100vh`
 * because mobile browsers count `vh` against the address bar's collapsed
 * height, which leaves a strip of the frame permanently under the chrome.
 *
 * `min-h-0` on the flex children is the other half and is load-bearing:
 * without it a flex child refuses to shrink below its content, and the column
 * grows the page instead of scrolling inside itself.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[calc(100svh-2rem)] min-h-0 w-full overflow-hidden">{children}</div>;
}

export default CustomerDetailV2;
