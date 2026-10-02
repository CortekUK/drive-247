"use client";

/**
 * The rental control centre — the v2 rental detail screen.
 *
 * Gated to the `northwind` canary by `useV2("rentals")`; the other tenants keep
 * the 8,099-line v1 page byte for byte. See `lib/v2.ts` and V2_PLAN §2.
 *
 * The idea it is built on: a rental is a living record, not a form somebody
 * submitted once. There is no Create button and no Save — the rental already
 * exists. What the screen offers instead is a set of STAGES, each one a
 * decision the rental carries, and anything PRODUCED from those decisions (the
 * agreement, the insurance policy, the damage report) is meant to notice when
 * they move underneath it. The operator never has to remember which document
 * contained which term.
 *
 * ── the three columns, and why one of them is missing here ──────────────────
 *
 * The playground prototype was a full-screen page with no app chrome, so it drew
 * all three columns itself: stage rail, panel, right rail. The real route sits
 * inside `(dashboard)/layout.tsx`, which already renders a 280px sidebar — so
 * drawing a third column here would stack two sidebars side by side.
 *
 * The stage rail therefore REPLACES the app sidebar rather than joining it, in
 * `shared/layout/app-sidebar-v2.tsx`. That file already does exactly this for
 * Settings (`isSettingsPage`): a Back link, a scoped title, and a nav for that
 * area alone. Rentals now has the same branch. This file draws the two columns
 * that are left.
 *
 * ── how the rail and this file agree ────────────────────────────────────────
 *
 * They share nothing. No context, no store, no props — they are siblings in the
 * tree and could not pass anything to each other without a provider wrapping the
 * whole dashboard. What they share instead is:
 *
 *   the URL     `?stage=payments` — both read it with `useSearchParams`
 *   the list    `stages.ts` — both import STAGES, so neither owns it
 *   the data    `useRentalDetailV2` — same query key, so one fetch, one cache
 *
 * That is why the stage lives in the URL rather than in React state, and it
 * pays for itself twice over: a stage is deep-linkable, and it survives a
 * refresh. Settings already works this way (`?tab=`).
 */

import { useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { deriveRentalDetail, useRentalDetailV2, type RentalRow } from "./use-rental-detail-v2";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonFaker } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import { STAGES, readStage, stageHref, type StageId, type StageProps } from "./stages";
import { StageCustomer } from "./stage-customer";
import { StageVehicle } from "./stage-vehicle";
import { StageWhenWhere } from "./stage-when-where";
import { StageExtras } from "./stage-extras";
import { StagePayments } from "./stage-payments";
import { StageAgreement } from "./stage-agreement";
import { StageInsurance } from "./stage-insurance";
import { StageHandover } from "./stage-handover";
import { readExtension, readOverview, readPeriod } from "./extension-flow";
import { RentalOverview } from "./rental-overview";
import { ExtensionView } from "./extension-view";
import { PeriodView } from "./period-view";
import { previewPeriods } from "./rail-preview";
import { useV2 } from "@/lib/v2-context";
import { RightRail, rentalRailTabs } from "./right-rail";
import { ContextColumn, DOCK_CLEARANCE, RecordDock, RecordDockNav, contextTabPanels, useWiderThan } from "@/components/ui-v2/record-dock";
import { EmptyHint, Panel } from "./_kit";

/**
 * Which component draws which stage.
 *
 * A stage with no entry here renders its "not built yet" panel below rather
 * than a blank column — so the rail can carry all eight from day one while the
 * screens land one at a time. Adding a stage is one line in this map plus one
 * file; nothing else in this component changes.
 */
/**
 * A valid uuid that matches no row. The stages and the rail read their own data
 * off the customer and car ids, so the placeholder hands them one that fetches
 * nothing rather than a string Postgres would reject.
 */
const NO_ROW = "00000000-0000-0000-0000-000000000000";

/**
 * The placeholder rental the skeleton is drawn from: only its shapes are ever
 * seen. The rental id is the REAL one from the URL, so the payment plan and
 * ledger the stages read start loading alongside the rental itself.
 */
function skeletonRental(id: string): RentalRow {
  const f = skeletonFaker(0);
  return {
    id,
    rental_number: `R-${f.word(5, 6)}`,
    status: "active",
    start_date: f.date(3).slice(0, 10),
    end_date: f.date(-4).slice(0, 10),
    pickup_time: null,
    return_time: null,
    customer_id: NO_ROW,
    vehicle_id: NO_ROW,
    tenant_id: null,
    total_amount: f.money(),
    customers: {
      id: NO_ROW,
      name: f.text(2, 3),
      email: `${f.word(6, 10)}@${f.word(5, 8)}.com`,
      phone: "+1 555 000 0000",
      created_at: f.date(200),
      date_of_birth: null,
      identity_verification_status: null,
      license_number: f.word(8, 10),
      license_state: null,
      is_blocked: false,
      blocked_reason: null,
    },
    vehicles: {
      id: NO_ROW,
      reg: f.word(6, 8),
      make: f.word(4, 8),
      model: f.word(3, 7),
      year: 2024,
      status: null,
      daily_rent: f.money(40, 200),
      weekly_rent: null,
      monthly_rent: null,
      lockbox_code: null,
      lockbox_instructions: null,
    },
  };
}

const STAGE_VIEWS: Partial<Record<StageId, React.ComponentType<StageProps>>> = {
  customer: StageCustomer,
  vehicle: StageVehicle,
  when: StageWhenWhere,
  extras: StageExtras,
  agreement: StageAgreement,
  insurance: StageInsurance,
  payments: StagePayments,
  handover: StageHandover,
};

export function RentalDetailV2() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const id = (params?.id as string) ?? null;
  const stage = readStage(searchParams.get("stage"));
  /* An open extension (Management → Add period) takes the stage panel's place;
     the left rail swaps to its steps from the same URL. See extension-flow.ts. */
  const extension = readExtension(searchParams);
  /* A period opened from its Management card (`?period=`). Periods are the
     northwind preview for now (rail-preview.ts), so only the v2 chrome has any. */
  const periodView = extension ? null : readPeriod(searchParams);
  /* The whole rental at a glance (`?overview=1`, Management's Overview card). */
  const overview = !extension && !periodView && readOverview(searchParams);
  const previewOn = useV2("chrome");

  const { detail: loadedDetail, isLoading: detailLoading, notFound, error, refetch } = useRentalDetailV2(id);
  const isLoading = useSkeletonLoading(detailLoading);

  // While the rental loads, the real screen renders a placeholder rental and
  // <AutoSkeleton> turns it into the skeleton.
  const placeholder = useMemo(() => (id ? deriveRentalDetail(skeletonRental(id)) : null), [id]);
  const detail = isLoading ? placeholder : loadedDetail;

  /**
   * Move to another stage.
   *
   * `replace`, not `push`: eight stages behind one rental would mean an
   * operator who looked at all of them has to press Back eight times to get out
   * of the rental. `scroll: false` because the frame does not scroll — there is
   * no scroll position to restore, and Next's default would fight the panel's
   * own scroll container.
   */
  const onStage = useCallback(
    (next: StageId) => {
      if (!id) return;
      router.replace(stageHref(id, next), { scroll: false });
    },
    [id, router]
  );

  const onRefetch = useCallback(() => {
    void refetch();
  }, [refetch]);

  /* Which columns fit. The stage rail is the app sidebar, a closed sheet below
     `md`; the context column needs 1280. Whatever does not fit becomes a button
     on the dock instead. Read here, above the early returns below, because a
     hook cannot be called conditionally. */
  const railFits = useWiderThan(768);
  const contextFits = useWiderThan(1280);
  const docked = !railFits || !contextFits;

  /* ── the states before a stage can mount ────────────────────────────── */

  if (!detail || (!isLoading && (error || notFound))) {
    return (
      <Frame>
        <div className="flex h-full min-h-0 w-full max-w-3xl flex-col">
          <div className="shrink-0">
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
              <Link href="/rentals">
                <ArrowLeft />
                All rentals
              </Link>
            </Button>
            <h2 className="font-heading text-2xl font-medium tracking-tight">
              {notFound ? "That rental is not here" : "That rental would not load"}
            </h2>
          </div>
          <div className="mt-7 min-h-0 flex-1 overflow-y-auto no-scrollbar">
            <EmptyHint>
              {notFound
                ? "It has either been deleted, or it belongs to a different account. Nothing was changed."
                : (error?.message ?? "Something went wrong reading it. Try again in a moment.")}
            </EmptyHint>
          </div>
        </div>
      </Frame>
    );
  }

  const View = STAGE_VIEWS[stage];
  const meta = STAGES.find((s) => s.id === stage)!;
  // Remount the stage and the rail when the real rental lands, so nothing a
  // stage seeded into its own state from the placeholder outlives it.
  const phase = isLoading ? "skeleton" : "loaded";
  return (
    <AutoSkeleton loading={isLoading}>
    <Frame>
      {/* Keyed on the stage so the scroll container is a NEW node each time.
          Without it the panel keeps the previous stage's scroll offset and you
          land halfway down a screen you have never seen.

          The right padding is the gutter to the context column, so it only
          applies where that column is drawn. The bottom padding is the dock's
          own height, so the last row of a stage clears the pill instead of
          sitting under it. */}
      <div
        key={`${extension ? `ext-${extension.step}` : periodView ? `period-${periodView.period}-${periodView.step}` : overview ? "overview" : stage}:${phase}`}
        className={`flex min-w-0 flex-1 flex-col overflow-hidden md:pr-6${docked ? " " + DOCK_CLEARANCE : ""}`}
      >
        {extension ? (
          <ExtensionView detail={detail} state={extension} />
        ) : overview ? (
          <RentalOverview detail={detail} />
        ) : periodView ? (
          <PeriodView
            detail={detail}
            state={periodView}
            period={previewOn ? previewPeriods(detail).find((p) => p.id === periodView.period) ?? null : null}
          />
        ) : View ? (
          <View detail={detail} onStage={onStage} refetch={onRefetch} />
        ) : (
          <Panel title={meta.label} description={meta.prompt}>
            <EmptyHint>
              This stage has not been built yet. Everything it will show is already on the rental — nothing is
              hidden, it just has no screen of its own here so far.
            </EmptyHint>
          </Panel>
        )}
      </div>

      {contextFits ? (
        <ContextColumn label="Management & activity" bordered={false}>
          {/* One flat accent tone, end to end (Oct 2 2026): a 9% --chart-3
              (the brand's violet, a step off the page wash) over the card
              colour, opaque, so the page gradient does not run through the
              rail. Quiet on purpose — the stage panel is the work, this is
              its context. The column reaches into main's 16px right padding
              (`md:-mr-4`) so the tab divider meets the window edge, and the
              tint reaches the top and bottom edges the same way. Its left edge
              is not a line: the tint starts at the stage cards' edge, 24px out in
              the gutter, and fades in over 56px (a mask), so the page wash
              melts into it without washing over the cards. Light only —
              dark mode stays one tone.

              The override is for this screen only, so the shared
              `timeline.css` is untouched: even 16px padding either side (the
              shared body pads 12px left / 40px right, which put this content
              off centre). The tab strip is context-rail.tsx's icon strip. */}
          <div className="relative flex min-h-0 flex-1 flex-col md:-mr-4 [&_.tl-context-body]:!px-4">
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-4 -left-6 -top-4 right-0 [mask-image:linear-gradient(to_right,transparent,black_3.5rem)] [background:linear-gradient(hsl(var(--chart-3)/0.09),hsl(var(--chart-3)/0.09)),hsl(var(--card))] dark:hidden"
            />
            <div className="relative flex min-h-0 flex-1 flex-col">
              <RightRail key={phase} detail={detail} refetch={onRefetch} />
            </div>
          </div>
        </ContextColumn>
      ) : null}

      {/* The circle carries the stages, because moving between them is what an
          operator does on every visit to a rental. Its icon is the stage they
          are on, so the dock also answers "where am I" without a word on it.
          Back to the list flanks it on the left, the activity panel on the
          right — the same two things the desktop rails hold. */}
      <RecordDock
        back={{ href: "/rentals", label: "All rentals", icon: ArrowLeft }}
        primary={
          railFits
            ? undefined
            : {
                id: "stages",
                label: meta.label,
                icon: meta.icon,
                description: "Every stage of this rental. You are on " + meta.label + ".",
                content: (close: () => void) => (
                  <RecordDockNav
                    groups={[{ items: STAGES }]}
                    current={stage}
                    hrefFor={(next: StageId) => stageHref(id!, next)}
                    close={close}
                  />
                ),
              }
        }
        secondary={
          contextFits
            ? []
            : /* One icon per context view: Management, Messages, Trax, Notifications, Activity.
                 Each is a tap, not a tap-then-a-tab. */
              contextTabPanels(rentalRailTabs(detail))
        }
      />
    </Frame>
    </AutoSkeleton>
  );
}

/**
 * The fixed frame.
 *
 * The page itself never scrolls; each column scrolls its own content, so the
 * stage title and the primary actions stay in view however long the list under
 * them runs. That takes a bounded height, and the dashboard layout does not
 * supply one — its wrapper is `min-h-svh`, which grows.
 *
 * So the height is stated here: the viewport, less the `p-4` that
 * `(dashboard)/layout.tsx` puts around `<main>`. `100svh` rather than `100vh`
 * because mobile browsers count `vh` against the address bar's collapsed
 * height, which leaves a strip of the frame permanently under the chrome.
 *
 * `min-h-0` on the flex children is the other half and is load-bearing:
 * without it a flex child refuses to shrink below its content, and the column
 * grows the page instead of scrolling inside itself.
 *
 * If a banner is showing above `<main>` the frame is pushed down by its height
 * and the page gains that much scroll. That is the correct trade: a
 * deposit-hold warning is worth a few pixels of page scroll, and the
 * alternative — subtracting a height nothing measures — would be wrong on
 * every screen where no banner is showing.
 *
 * Desktop (md and up): no top bar. The layout drops TopBarV2 on this route
 * at md and up (Oct 2 2026, `isRentalDetailV2` in `(dashboard)/layout.tsx`),
 * so <main> starts at its own 16px padding and the frame fills the viewport
 * less main's 16px top and bottom — the same `100svh - 2rem` as a phone. The
 * 32px panel title then centres at 16 + 16 = 32.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100svh-2rem)] min-h-0 w-full overflow-hidden md:overflow-visible">
      {children}
    </div>
  );
}

export default RentalDetailV2;
