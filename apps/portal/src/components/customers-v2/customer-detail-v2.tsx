"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — the screen.
 *
 * ── The idea ──────────────────────────────────────────────────────────────
 *
 * A customer record ALREADY EXISTS, so there is no Save and no Submit: an edit
 * applies on the keystroke. Anything PRODUCED from the record notices when the
 * record moves underneath it, says so in amber, shows exactly what changed, and
 * offers a way out. Amber means exactly one thing here: an output is behind its
 * inputs. It is an ordinary Tuesday, never an error. A block is red, and never
 * amber.
 *
 * ── Three columns, three jobs ─────────────────────────────────────────────
 *
 *   LEFT    ordinary navigation. Where am I, where can I go. No state at all —
 *           see `record-sidebar.tsx` for why it must stay that way.
 *   MIDDLE  the panel you are working in.
 *   RIGHT   the conclusion: can this person be handed keys, and what is
 *           stopping it. No panel can answer that alone — Verification does not
 *           know the balance, Account does not know the licence expired last
 *           week — so it gets a column rather than being restated on every tab.
 *
 * Each thing is stated once, in one column. Two summaries of one fact on one
 * screen is how they drift apart.
 *
 * ── Why it measures its own height ────────────────────────────────────────
 *
 * The screen is a fixed frame: nothing scrolls the page, each column scrolls
 * itself. That needs a real pixel height, and this component does not know what
 * the dashboard layout put above it — a maintenance banner, a deposit-hold
 * strip, a v1 header on a tenant that has not moved yet. So it measures its own
 * top offset and fills what is left, the same way `RentalOnboardingShell` does
 * one screen over. `100vh` minus a guessed constant breaks the first time a
 * banner appears.
 * ────────────────────────────────────────────────────────────────────────── */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, UserX } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { summaryDrift, verificationDrift } from "./derive";
import { expiryOf, fmtDate } from "./kit";
import { OverviewRail } from "./overview-rail";
import { RecordSidebar } from "./record-sidebar";
import { AccountPanel, ConsentPanel, VerificationPanel } from "./panels-standing";
import { ActivityPanel, FinesPanel, MoneyPanel, RentalsPanel, ReviewsPanel } from "./panels-history";
import { DocumentsPanel, IdentityPanel, LicencePanel } from "./panels-person";
import { useCustomerDraft } from "./use-customer-draft";
import { useCustomerRecord } from "./use-customer-record";
import type { TabId } from "./types";

const TAB_IDS: TabId[] = [
  "identity",
  "licence",
  "documents",
  "verification",
  "account",
  "consent",
  "rentals",
  "money",
  "fines",
  "reviews",
  "activity",
];

/** Fills from this component's top offset down to the bottom of the viewport. */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<string>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top;
      setHeight(`${Math.max(420, window.innerHeight - top - 8)}px`);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return { ref, height };
}

export function CustomerDetailV2({ customerId }: { customerId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const { ref, height } = useFillHeight();

  const { record, isLoading, notFound } = useCustomerRecord(customerId);
  const { set, saving } = useCustomerDraft(customerId);

  /**
   * The tab is a query param so a link into "this customer's money" survives a
   * refresh and can be pasted into a message. v1's `?tab=` values are honoured
   * where they still mean the same thing.
   */
  const initial = searchParams.get("tab");
  const [tab, setTab] = useState<TabId>(() => {
    if (initial && (TAB_IDS as string[]).includes(initial)) return initial as TabId;
    if (initial === "payments") return "money";
    if (initial === "gig-driver") return "licence";
    if (initial === "vehicles") return "rentals";
    return "identity";
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }, [tab]);

  /** The two things on this screen that can be out of date, computed once here
   *  because the panel showing the banner and the rail's checklist both need
   *  the same answer. */
  const verifyDrift = useMemo(() => (record ? verificationDrift(record) : []), [record]);
  const reviewDrift = useMemo(() => (record ? summaryDrift(record) : []), [record]);

  if (isLoading) return <LoadingFrame refEl={ref} height={height} />;

  if (notFound || !record) {
    return (
      <div ref={ref} style={{ height }} className="flex min-h-0 flex-col items-center justify-center gap-4">
        <UserX className="size-8 text-muted-foreground" />
        <div className="text-center">
          <p className="font-heading text-lg font-medium">No such customer</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tenant?.company_name || "This account"} has no customer with that id.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/customers")}>
          Back to customers
        </Button>
      </div>
    );
  }

  const editable = canEdit("customers");
  const licenceExpiry = expiryOf(record.licence.expiry);

  /**
   * The one fact that changes what every other tab means, so it follows the
   * reader to all of them. Ordered hardest-stop first.
   *
   * Deliberately short. The right rail carries the full picture; this strip
   * exists only so a blocked customer cannot be edited for ten minutes by
   * someone who never looked right.
   */
  const alert = record.account.globalBlocks.length
    ? {
        title: "This identity is on the blocklist",
        body:
          record.account.globalBlocks[0].reason ||
          "No reason recorded. The entry is keyed on the identity, not on this record.",
        tab: "account" as TabId,
      }
    : record.account.blockedHere
      ? {
          title: "Blocked with you — new bookings are refused",
          body:
            record.account.blockedHere.reason ||
            `No reason recorded yet. Blocked ${fmtDate(record.account.blockedHere.at)}.`,
          tab: "account" as TabId,
        }
      : record.account.status === "Rejected"
        ? {
            title: "This customer was rejected",
            body: record.account.rejection?.reason || "No reason recorded yet. Add one on Account.",
            tab: "account" as TabId,
          }
        : licenceExpiry.state === "expired"
          ? {
              title: "Their licence has expired",
              body: `It ran out on ${fmtDate(record.licence.expiry)}. A car cannot legally go out against it.`,
              tab: "licence" as TabId,
            }
          : null;

  const props = {
    c: record,
    set,
    onJump: setTab,
    canEdit: editable,
    currency: tenant?.currency_code || "USD",
  };

  const panel = () => {
    switch (tab) {
      case "identity":
        return <IdentityPanel {...props} />;
      case "licence":
        return <LicencePanel {...props} />;
      case "documents":
        return <DocumentsPanel {...props} />;
      case "verification":
        return <VerificationPanel {...props} drift={verifyDrift} />;
      case "account":
        return <AccountPanel {...props} />;
      case "consent":
        return <ConsentPanel {...props} />;
      case "rentals":
        return <RentalsPanel {...props} />;
      case "money":
        return <MoneyPanel {...props} />;
      case "fines":
        return <FinesPanel {...props} />;
      case "reviews":
        return <ReviewsPanel {...props} drift={reviewDrift} />;
      case "activity":
        return <ActivityPanel {...props} />;
      default:
        return null;
    }
  };

  return (
    // `-m-4` cancels the dashboard main's own padding so the three columns meet
    // the edges of the content inset. Without it the screen sits in a 16px
    // frame and the two rails read as floating cards rather than as chrome.
    <div ref={ref} style={{ height }} className="-m-4 flex min-h-0 overflow-hidden">
      <aside className="hidden w-56 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <RecordSidebar
          title={record.identity.name || "Untitled customer"}
          subtitle={record.identity.email || record.identity.phone || "No contact on file"}
          active={tab}
          onSelect={setTab}
          footer={
            editable ? (
              <p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Changes apply as you make them. There is no Save.
              </p>
            ) : (
              <p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
                You have view-only access to customers.
              </p>
            )
          }
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden px-6 py-6 lg:px-10 lg:py-8">
        {alert && (
          <div className="mb-6 max-w-3xl shrink-0 rounded-4xl bg-destructive/[0.07] px-6 py-5 ring-1 ring-destructive/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="font-heading text-sm font-semibold text-destructive">{alert.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-destructive/80">{alert.body}</p>
              </div>
              <Button
                variant="link"
                size="sm"
                onClick={() => setTab(alert.tab)}
                className="-mt-1 ml-auto shrink-0 text-destructive"
              >
                Review
              </Button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1">{panel()}</div>
      </main>

      {/* Holds no state of its own — it is derived from the record, so it
          cannot fall out of step with the middle column. */}
      {/*
        `min-[1400px]` rather than `xl`, and the width carries a right gutter.
        The v2 chrome parks a fixed dock against the right edge of the viewport
        — Ask AI, messages, enquiries, notifications, vertically centred — so a
        rail flush to that edge has its values printed underneath four icons.
        The gutter lives inside the rail so the border still lands where the
        column ends.

        The breakpoint is 1400 because at 1280 the middle column would be about
        450px wide, and its two-up field grids are viewport-keyed: they would
        stay two-up in a column too narrow to hold them. Below 1400 the rail
        drops out and the middle takes the space instead.
      */}
      <aside className="hidden w-[344px] shrink-0 border-l border-foreground/10 min-[1400px]:block">
        <OverviewRail
          c={record}
          verifyDrift={verifyDrift}
          reviewDrift={reviewDrift}
          onJump={setTab}
          currency={tenant?.currency_code || "USD"}
          saving={saving}
        />
      </aside>
    </div>
  );
}

function LoadingFrame({
  refEl,
  height,
}: {
  refEl: React.RefObject<HTMLDivElement | null>;
  height?: string;
}) {
  return (
    <div ref={refEl} style={{ height }} className="-m-4 flex min-h-0 overflow-hidden">
      <aside className="hidden w-56 shrink-0 border-r border-sidebar-border bg-sidebar p-4 lg:block">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 h-4 w-32" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-6 lg:px-10 lg:py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-96" />
        <div className="mt-8 max-w-3xl space-y-4">
          <Skeleton className="h-48 w-full rounded-4xl" />
          <Skeleton className="h-64 w-full rounded-4xl" />
        </div>
      </main>
      <aside className="hidden w-[344px] shrink-0 border-l border-foreground/10 p-4 min-[1400px]:block">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-5 h-16 w-full rounded-3xl" />
        <div className="mt-6 space-y-2.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </aside>
    </div>
  );
}
