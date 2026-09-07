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

import { useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { useRentalDetailV2 } from "./use-rental-detail-v2";
import { STAGES, readStage, stageHref, type StageId, type StageProps } from "./stages";
import { StageCustomer } from "./stage-customer";
import { StageVehicle } from "./stage-vehicle";
import { StageWhenWhere } from "./stage-when-where";
import { StageExtras } from "./stage-extras";
import { StagePayments } from "./stage-payments";
import { StageAgreement } from "./stage-agreement";
import { StageInsurance } from "./stage-insurance";
import { StageHandover } from "./stage-handover";
import { RightRail } from "./right-rail";
import { EmptyHint, Panel } from "./_kit";

/**
 * Which component draws which stage.
 *
 * A stage with no entry here renders its "not built yet" panel below rather
 * than a blank column — so the rail can carry all eight from day one while the
 * screens land one at a time. Adding a stage is one line in this map plus one
 * file; nothing else in this component changes.
 */
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

  const { detail, isLoading, notFound, error, refetch } = useRentalDetailV2(id);

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

  /* ── the states before a stage can mount ────────────────────────────── */

  if (isLoading) {
    return (
      <Frame>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </Frame>
    );
  }

  if (error || notFound || !detail) {
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
          <div className="mt-7 min-h-0 flex-1 overflow-y-auto">
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

  return (
    <Frame>
      {/* Keyed on the stage so the scroll container is a NEW node each time.
          Without it the panel keeps the previous stage's scroll offset and you
          land halfway down a screen you have never seen. */}
      <div key={stage} className="flex min-w-0 flex-1 flex-col overflow-hidden pr-6">
        {View ? (
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

      {/* ── right rail ───────────────────────────────────────────────────
          A matched pair with the stage rail on the far side of the screen —
          same 360px the prototype used, the border flipped to `border-l` so the
          two frame the content between them.

          `RightRail` draws its tabs — messages and activity, with extensions
          gated off by `multi-period.ts` — and supplies its own column: an
          `h-11` tab strip that lines up with the stage rail's back-link row,
          then a `min-h-0 flex-1` body. Each tab scrolls its own middle and pins
          its own controls (the composer, the activity filter), so a long list
          can never push a control off the bottom of the screen. The aside stays
          the frame.

          Hidden below `xl`: at 360px it would take more from the panel than it
          gives back, and both of its tabs have a full page of their own to fall
          back on.

          The `pr-12` gutter that clears the v2 chrome's fixed QuickDock (see
          `(dashboard)/layout.tsx`) moved INTO `RightRail`, because it belongs
          on the scrolling body and not on the tab strip above it. */}
      <aside className="hidden w-[360px] shrink-0 flex-col border-l border-foreground/10 xl:flex">
        <RightRail detail={detail} refetch={onRefetch} />
      </aside>
    </Frame>
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
 */
function Frame({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[calc(100svh-2rem)] min-h-0 w-full overflow-hidden">{children}</div>;
}

export default RentalDetailV2;
