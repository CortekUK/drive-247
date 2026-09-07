"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Customer control centre — DESIGN SANDBOX. Nothing here is real.
 *
 * No Supabase, no tenant, no auth, no network, no images. Every value is local
 * state over hardcoded demo data, so this route opens cold at
 * /playground/customer-detail-fake and can be driven hard without touching a
 * single production row.
 *
 * ── The idea ──────────────────────────────────────────────────────────────
 *
 * A customer record ALREADY EXISTS, so there is no Save and no Submit: an edit
 * applies on the keystroke. Anything PRODUCED from the record notices when the
 * record moves underneath it, says so in amber, shows exactly what changed, and
 * offers both ways out — re-issue it, or accept that the old one still stands.
 * Amber means exactly one thing here: an output is behind its inputs. It is an
 * ordinary Tuesday, never an error. A block is destructive-red, and never amber.
 *
 * ── Three columns, three jobs ─────────────────────────────────────────────
 *
 *   LEFT    ordinary navigation. Where am I, where can I go. No state at all —
 *           see `_sidebar.tsx` for why it must stay that way.
 *   MIDDLE  the panel you are working in.
 *   RIGHT   the conclusion: can this person be handed keys, and what is stopping
 *           it. No panel can answer that alone — Verification does not know the
 *           balance, Account does not know the licence expired last week — so it
 *           gets a column rather than being restated on every tab.
 *
 * Each thing is stated once, in one column. Two summaries of one fact on one
 * screen is how they drift apart.
 * ────────────────────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { fmtDate } from "@/app/playground/_shared";
import { demoCustomer } from "./_data";
import type { CustomerState, TabId } from "./_data";
import { expiryOf } from "./_bits";
import { CustomerSidebar } from "./_sidebar";
import { Overview } from "./_overview";
import { DocumentsPanel, IdentityPanel, LicencePanel } from "./_person";
import { AccountPanel, ConsentPanel, VerificationPanel, verificationDrift } from "./_standing";
import {
  ActivityPanel,
  FinesPanel,
  MoneyPanel,
  RentalsPanel,
  ReviewsPanel,
  summaryDrift,
} from "./_history";

export default function CustomerDetailFakePage() {
  const [c, setC] = useState<CustomerState>(demoCustomer);
  const [tab, setTab] = useState<TabId>("identity");

  const patch = (fn: (prev: CustomerState) => CustomerState) => setC(fn);

  /**
   * The two things on this screen that can be out of date, computed once here
   * because three different places need the same answer: the panel that shows
   * the banner, the right rail's checklist, and its verdict.
   */
  const verifyDrift = useMemo(() => verificationDrift(c), [c]);
  const reviewDrift = useMemo(() => summaryDrift(c), [c]);

  const licenceExpiry = expiryOf(c.licence.expiry);

  /**
   * The one fact that changes what every other tab means, so it follows the
   * reader to all of them. Ordered hardest-stop first.
   *
   * Deliberately short. The right rail carries the full picture; this strip
   * exists only so a blocked customer cannot be edited for ten minutes by
   * someone who never looked right.
   */
  const alert = c.account.globalBlocks.length
    ? {
        title: "This identity is on the platform blocklist",
        body:
          c.account.globalBlocks[0].reason ||
          "No reason recorded. Every operator on Drive247 sees this.",
        tab: "account" as TabId,
      }
    : c.account.blockedHere
      ? {
          title: "Blocked with you — new bookings are refused",
          body:
            c.account.blockedHere.reason ||
            `No reason recorded yet. Blocked ${fmtDate(c.account.blockedHere.at)}.`,
          tab: "account" as TabId,
        }
      : c.account.status === "Rejected"
        ? {
            title: "This customer was rejected",
            body: c.account.rejection?.reason || "No reason recorded yet. Add one on Account.",
            tab: "account" as TabId,
          }
        : licenceExpiry.state === "expired"
          ? {
              title: "Their licence has expired",
              body: `It ran out on ${fmtDate(c.licence.expiry)}. A car cannot legally go out against it.`,
              tab: "licence" as TabId,
            }
          : null;

  /* ── panels ───────────────────────────────────────────────────────────── */

  const props = { c, patch, onJump: setTab };

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

  /* ── render ───────────────────────────────────────────────────────────── */

  return (
    /*
     * No top header bar, on purpose. northwind's v2 chrome deletes that row
     * outright — `app/(dashboard)/layout.tsx` calls it "the single most visible
     * difference between the two designs" — so a bordered full-width strip is
     * the fastest way to make a screen read as v1. The record's identity lives
     * in the sidebar header instead, exactly as it does for Settings.
     */
    <div className="flex h-screen bg-background bg-app-gradient">
      {/* Left: app chrome, so it wears the sidebar surface the rest of the
          portal's navigation wears. */}
      <aside className="w-[280px] shrink-0 border-r border-sidebar-border bg-sidebar">
        <CustomerSidebar
          title={c.identity.name || "Untitled customer"}
          subtitle={c.identity.email || c.identity.phone || "No contact on file"}
          active={tab}
          onSelect={setTab}
        />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
        {alert && (
          <div className="mb-8 max-w-3xl rounded-4xl bg-destructive/[0.07] px-6 py-5 ring-1 ring-destructive/20">
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

        {panel()}

        <div className="mt-10 max-w-3xl border-t border-foreground/10 pt-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Changes apply as you make them.
            {verifyDrift.length === 0 && c.ai.state === "passed" && (
              <>
                {" "}
                Try editing the licence number on{" "}
                <button
                  type="button"
                  onClick={() => setTab("licence")}
                  className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
                >
                  Licence &amp; driving
                </button>{" "}
                and watch the right-hand column move.
              </>
            )}
          </p>
        </div>
      </main>

      {/* Right: everything the record adds up to. Holds no state of its own —
          it is derived from `c`, so it cannot fall out of step with the middle
          column. */}
      <aside className="w-[360px] shrink-0 border-l border-foreground/10">
        <Overview c={c} verifyDrift={verifyDrift} reviewDrift={reviewDrift} onJump={setTab} />
      </aside>
    </div>
  );
}
