import type { CSSProperties } from "react";
import { CalendarPlus, Car, CheckCircle, ChevronDown, DollarSign, Home, Loader2, Percent, Receipt, ShieldCheck } from "lucide-react";
import { FlowPhone, SiteNav } from "./chrome";
import { BookingDetail, BreakdownTable, TraxButton, type BreakdownRow } from "./extend";
import type { Flow } from "./types";
import "./pay-due.css";

/* ===================================================================== *
 * Renter flow "Pay what's due": paying an approved extension from the
 * ORIGINAL customer portal, on a 390px phone (no sm:/md: classes apply).
 * The booking detail page, its table and the Trax button come from
 * extend.tsx (same page, same rental).
 *
 * What the code really produces (apps/booking/src unless noted):
 *   - Approval: apps/portal/src/components/rentals/ExtensionRequestDialog.tsx
 *     262-270 moves end_date to the requested date and clears is_extended
 *     (so "Request Extension" is back in the header); 405-428 writes an
 *     'Extension Rental' ledger charge with reference
 *     "Extension #1: 2 days (Oct 22 → Oct 24, 2026)" (no Tax / Service Fee
 *     charges while those are off).
 *   - components/customer-portal/PaymentBreakdown.tsx
 *       348-375  extension charges grouped by "Extension #(n)"
 *       946-1001 the extension table: Rental (detail "{n} days ({from} → {to})"
 *                parsed from that reference), Tax, Insurance, Service Fee
 *       1013-1077 with an extension the card is an Accordion (type single,
 *                default "original"): "Original Rental" (green) and
 *                "Extension #1" (blue), each with an outline total badge
 *       690-925  renderTable: checkbox column when something is payable,
 *                Category / Mode / Status / Amount / Refunded / Action
 *                ("Not Paid" red, "Paid" emerald, blue "Pay"); inside
 *                `overflow-auto`, so at 390px the renter swipes it
 *       897-922  the sticky bar: "{n} item{n > 1 ? 's' : ''} selected — {total}"
 *                (so "1 item selected"), "Pay Selected" (DollarSign)
 *       555-583  payCategories → create-checkout-session (Stripe Checkout, not
 *                drawn), successUrl /booking-success?…&type=invoice
 *   - app/(legacy)/(customer-portal)/portal/bookings/[id]/page.tsx 1001-1018
 *     "Outstanding Balance" (extension outstanding from
 *     rental_extension_totals), gone once paid.
 *   - app/(legacy)/booking-success/page.tsx 22-233 InvoicePaymentSuccess:
 *     confetti on mount, Navigation (fixed), pt-24, the green circle with
 *     Loader2 → CheckCircle, "Processing Payment..." / "Please wait while we
 *     confirm your payment." → "Payment Received" / "Thank you! Your payment
 *     has been processed successfully.", "You can close this page now.",
 *     outline "Back to Home"; then components/Footer.tsx (mobile brand block,
 *     Services / Company columns).
 *
 * Assumptions / honest limits:
 *   - The return from Stripe lands on /booking-success, NOT on portal/payments:
 *     the "Payment Successful" banner there needs ?payment=success, which
 *     nothing in this path sets. So step 3 is the real success page, and step
 *     4 is the renter back on the booking, with the extension open again
 *     (the accordion re-opens on "Original Rental" by default; they tap it).
 *   - Default tenant: no tax, no service fee, no extension insurance → the
 *     extension's only charge is Rental $116.00; the $0 rows are dimmed.
 *   - The page scroll and the table swipe are the renter's own gestures
 *     (portal header is not sticky; the table wrapper is overflow-auto).
 *   - Confetti pieces are a fixed, deterministic stand-in for canvas-confetti's
 *     random burst (default colours, from 60% of the page height).
 *   - The demo tenant has no city on file, so the footer tagline is the
 *     default "Reliable Car Rentals".
 * ===================================================================== */

const extRows = (paid: boolean, checked: boolean): BreakdownRow[] => [
  {
    label: "Rental",
    detail: "2 days (Oct 22 → Oct 24, 2026)",
    Icon: Car,
    tone: "grn",
    amount: "$116.00",
    applied: true,
    status: paid ? "Paid" : "Not Paid",
    selectable: !paid,
    checked,
  },
  { label: "Tax", detail: "Not applied", Icon: Percent, tone: "blu", amount: "$0.00", applied: false, status: "Not Applied" },
  { label: "Insurance", detail: "Not applied", Icon: ShieldCheck, tone: "teal", amount: "$0.00", applied: false, status: "Not Applied" },
  { label: "Service Fee", detail: "Not applied", Icon: Receipt, tone: "pur", amount: "$0.00", applied: false, status: "Not Applied" },
];

/** PaymentBreakdown with one extension (1013-1077), "Extension #1" open. */
function ExtensionBreakdown({ paid, checked, swipe }: { paid: boolean; checked?: boolean; swipe?: boolean }) {
  return (
    <div className="fl-card">
      <h3 className="fpd-pbt">Payment Breakdown</h3>
      <div className="fpd-acc">
        <div className="fpd-item">
          <div className="fpd-trig fpd-orig">
            <span className="fpd-tl">
              <span className="fpd-tile">
                <Car />
              </span>
              <span className="fpd-name">Original Rental</span>
              <span className="fpd-tot">$232.00</span>
            </span>
            <ChevronDown />
          </div>
        </div>
        <div className="fpd-item">
          <div className="fpd-trig fpd-ext open">
            <span className="fpd-tl">
              <span className="fpd-tile">
                <CalendarPlus />
              </span>
              <span className="fpd-name">Extension #1</span>
              <span className="fpd-tot">$116.00</span>
            </span>
            <ChevronDown />
          </div>
          <BreakdownTable rows={extRows(paid, !!checked)} swipe={swipe} />
          {checked ? (
            <div className="fpd-bar fl-late">
              <p>
                1 item selected &mdash; <span>$116.00</span>
              </p>
              <span className="fl-btn pri fpd-paysel fl-tap">
                <DollarSign />
                Pay Selected
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** canvas-confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } }) — a fixed handful */
const CONFETTI: [number, number, number, string][] = [
  [-120, 250, 200, "#26ccff"], [-96, 300, -160, "#a25afd"], [-74, 210, 260, "#ff5e7e"], [-58, 330, -220, "#88ff5a"],
  [-40, 270, 180, "#fcff42"], [-22, 350, -140, "#ffa62d"], [-8, 240, 240, "#ff36ff"], [6, 320, -200, "#26ccff"],
  [20, 280, 150, "#a25afd"], [34, 345, -260, "#ff5e7e"], [50, 230, 210, "#88ff5a"], [66, 305, -180, "#fcff42"],
  [82, 260, 230, "#ffa62d"], [100, 320, -150, "#ff36ff"], [118, 220, 190, "#26ccff"], [-110, 190, -240, "#fcff42"],
  [-84, 360, 170, "#ff36ff"], [-30, 200, -190, "#88ff5a"], [42, 370, 220, "#ffa62d"], [92, 200, -210, "#a25afd"],
];

function PaymentReceived() {
  return (
    <div className="fpd-ok">
      <div className="fpd-nav">
        <SiteNav signedIn />
      </div>
      <div className="fpd-okb">
        <div className="fpd-okc">
          <div className="fpd-circ">
            <Loader2 className="fpd-was fpd-spin" />
            <CheckCircle className="fpd-now" />
          </div>
          <h1 className="fpd-sw">
            <span className="fpd-was">Processing Payment...</span>
            <span className="fpd-now">Payment Received</span>
          </h1>
          <p className="fpd-lead fpd-sw">
            <span className="fpd-was">Please wait while we confirm your payment.</span>
            <span className="fpd-now">Thank you! Your payment has been processed successfully.</span>
          </p>
          <p className="fpd-close fpd-now">You can close this page now.</p>
          <div className="fpd-now">
            <span className="fl-btn out fpd-home">
              <Home />
              Back to Home
            </span>
          </div>
        </div>
      </div>
      <footer className="fpd-foot">
        <div className="fpd-brand">
          <h3>Northwind Rentals</h3>
          <span className="fpd-rule" />
          <p>Reliable Car Rentals</p>
        </div>
        <div className="fpd-cols">
          <div>
            <h4>Services</h4>
            <span className="fpd-rule2" />
            <ul>
              <li>Fleet &amp; Pricing</li>
              <li>Book a Vehicle</li>
              <li>Promotions</li>
            </ul>
          </div>
          <div>
            <h4>Company</h4>
            <span className="fpd-rule2" />
            <ul>
              <li>About Us</li>
              <li>Reviews</li>
              <li>Contact</li>
            </ul>
          </div>
        </div>
      </footer>
      <div className="fpd-confetti" aria-hidden="true">
        {CONFETTI.map(([dx, h, r, c], i) => (
          <i key={i} style={{ "--dx": `${dx}px`, "--h": `${h}px`, "--r": `${r}deg`, background: c } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}

function Screen({ step }: { step: number }) {
  if (step === 2) {
    return (
      <FlowPhone step={step} className="fx fp">
        <PaymentReceived />
      </FlowPhone>
    );
  }
  const paid = step === 3;
  return (
    <FlowPhone step={step} className="fx fp">
      <div className={`fpd-scroll fpd-s${step}`}>
        <BookingDetail dates="18 Oct 2026 — 24 Oct 2026" action="request" balance={paid ? undefined : "$116.00"}>
          <ExtensionBreakdown paid={paid} checked={step === 1} swipe={step !== 1} />
        </BookingDetail>
      </div>
      <TraxButton />
    </FlowPhone>
  );
}

export const FLOW_PAY_DUE: Flow = {
  id: "pay-due",
  title: "Pay what's due",
  blurb: "Clear a balance from their phone",
  steps: [
    { caption: "Once you approve their extension, its $116.00 shows in their booking as Not Paid.", ms: 3400 },
    { caption: "They tick it and tap Pay Selected, then pay by card on a secure checkout page.", ms: 3000 },
    { caption: "Back from checkout, the payment is confirmed on the spot.", ms: 3000 },
    { caption: "In their booking the extension now reads Paid, and nothing is outstanding.", ms: 3200 },
  ],
  Screen,
};
