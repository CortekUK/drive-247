import { ArrowRight, Check, CheckCircle, ChevronLeft, CreditCard, Download, FileText, Home, Loader2, Shield, User } from "lucide-react";
import { FlowPhone, SiteNav } from "./chrome";
import type { Flow } from "./types";
import "./pay.css";

/* ===================================================================== *
 * Flow "Pay for the booking" — the ORIGINAL booking design at 390px.
 *
 * The real order (apps/booking/src/components/BookingCheckoutStep.tsx):
 *   "Confirm & Pay $192.00" (2235-2271) → handlePayment → proceedWithPayment
 *   (825-1585): setCheckoutProgress(1…6) drives <CheckoutProgressOverlay>
 *   (components/CheckoutProgressOverlay.tsx; labels 141-147), the invoice is
 *   created at step 4 and step 5 is "Preparing payment"; then the overlay
 *   closes and the InvoiceDialog opens (1570-1573, "Show invoice dialog first
 *   (before payment)"). Its "Continue to Sign Agreement" runs
 *   handleSendDocuSign (701-783): BoldSign email, then after 1.5s the redirect
 *   to Stripe's hosted Checkout (redirectToStripePayment, 530-585). Stripe's
 *   page is a third party's UI and is NOT drawn. Stripe returns the renter to
 *   app/(legacy)/booking-success/page.tsx (700-810), "Rental Confirmed".
 * So the steps are: 1 progress overlay → 2 invoice → 3 Rental Confirmed.
 *
 *   1  CheckoutProgressOverlay at currentStep 5 of 6 (round(5/6·100) = 83%):
 *      fixed inset-0 bg-background/80 backdrop-blur-md over the checkout page;
 *      card max-w-md mx-4 p-8 rounded-2xl. Under it: the bottom of the Price
 *      Summary card (Grand Total, "Processing..." on the pay button).
 *   2  InvoiceDialog (components/InvoiceDialog.tsx 350-615) in ui/dialog.tsx:
 *      w-[95vw] max-h-[90vh] p-6 gap-4, square corners below sm, over
 *      bg-black/80. Scrolled to its end, where the buttons are (flex-col-reverse:
 *      "Continue to Sign Agreement" on top, "Print / Save PDF" under it).
 *   3  booking-success: fixed Navigation, the card scrolled so the Rental
 *      Summary and buttons show. The confetti burst (fireConfetti) is not drawn.
 *
 * Amounts — a default tenant: tax_enabled, service_fee_enabled false
 * (supabase/migrations "ADD COLUMN … DEFAULT false"), global_deposit_amount 0
 * (DEFAULT 0, so no deposit row or hold), no extras, no delivery fee, no
 * promo, the renter skipped Bonzah cover, weekend_surcharge_percent 0 (so the
 * breakdown is the flat "$64.00/day × 3 days"). Invoice = Rental Fee $192.00,
 * Total $192.00 — the only two rows InvoiceDialog renders for that tenant.
 *
 * Copy as the code formats it: invoice dates 'PPP' / 'PP'; invoice number
 * INV-yyyyMMdd-XXXX (lib/invoiceUtils.ts generateInvoiceNumber); success
 * dates "MMM dd, yyyy"; the success page's "Reference:" is
 * rental.id.substring(0, 8).toUpperCase() (page.tsx 607), NOT rental_number —
 * so for rental R-3fa0d2 (id 3fa0d2b7-…) it reads 3FA0D2B7. That path sets
 * monthly_amount (→ "Rental Amount:") and Period Type, not `total`, so the
 * summary shows "Rental Amount:" rather than "Amount Paid:".
 *
 * Known product bug, NOT copied: the overlay's progress fill lost its CSS
 * (.checkout-progress-bar-fill, background hsl(var(--primary)) + shimmer) in
 * commit ced762b7 "delete unreachable code", so live it currently renders no
 * visible fill. It is drawn here as designed (primary fill, no shimmer).
 * ===================================================================== */

const STEPS = [
  "Verifying customer details",
  "Securing your vehicle",
  "Processing insurance",
  "Generating invoice",
  "Preparing payment",
  "Almost there",
];
const CURRENT = 5;

/** The bottom of the checkout page under the overlay (Price Summary card + pay buttons). */
function CheckoutUnder({ processing }: { processing: boolean }) {
  return (
    <div className="fp-under">
      <SiteNav signedIn />
      <div className="fp-co">
        <div className="fl-card fp-sum">
          <div className="fp-gt">
            <div>
              <span className="fp-gt-l">Amount Due</span>
              <span className="fp-gt-h">Grand Total</span>
            </div>
            <span className="fp-gt-v">$192.00</span>
          </div>
          <p className="fp-rcpt">You&apos;ll receive a digital receipt immediately.</p>
          <div className="fp-promo">
            <span className="fl-label">Promo Code</span>
            <div className="fp-promo-r">
              <span className="fl-input ph fp-h9">Enter code</span>
              <span className="fl-btn out fp-h9">Apply</span>
            </div>
          </div>
          <div className="fp-acts">
            <span className={`fl-btn grad full fp-lg${processing ? " fp-dis" : ""}`}>
              {processing ? (
                <>
                  <Loader2 className="fp-mr fp-sp" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="fp-mr" />
                  Confirm & Pay $192.00
                </>
              )}
            </span>
            <span className={`fl-btn out full fp-lg${processing ? " fp-dis" : ""}`}>
              <ChevronLeft className="fp-mr" />
              Back to Vehicles
            </span>
            <span className="fp-secured">
              <Shield />
              Secured by Stripe. Card details never stored.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Progress() {
  return (
    <div className="fp-scrim">
      <div className="fp-pcard fl-late">
        <div className="fp-spin">
          <span className="fp-glow" />
          <span className="fp-ring">
            <Loader2 />
          </span>
        </div>
        <h3>Processing Your Booking</h3>
        <p className="fp-psub">Please don&apos;t close this page</p>
        <div className="fp-track">
          <span style={{ width: "83%" }} />
        </div>
        <p className="fp-pct">83%</p>
        <div className="fp-steps">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n < CURRENT ? "done" : n === CURRENT ? "on" : "todo";
            return (
              <div key={label} className={`fp-st ${state}`}>
                <span className="fp-dot">{state === "done" ? <Check /> : <i />}</span>
                <span className="fp-lbl">
                  {label}
                  {state === "on" ? (
                    <span className="fp-ell">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Invoice() {
  return (
    <div className="fp-dim">
      <div className="fp-dlg fl-late">
        <div className="fp-dscroll">
          <div className="fp-dh">
            <FileText />
            Invoice
          </div>

          <div className="fp-sp6">
            <div className="fp-co-h">
              <h1>Northwind Rentals</h1>
            </div>

            <div className="fp-bill">
              <div>
                <h3>Bill To:</h3>
                <div className="fp-lines">
                  <p className="fp-fm">Daniel Reyes</p>
                  <p>daniel.reyes@example.com</p>
                  <p>+1 (555) 010-0147</p>
                </div>
              </div>
              <div>
                <h3>Invoice Details:</h3>
                <div className="fp-lines">
                  <p>
                    <span className="fl-mfg">Invoice #:</span> <strong>INV-20261020-K7QX</strong>
                  </p>
                  <p>
                    <span className="fl-mfg">Date:</span> October 20th, 2026
                  </p>
                  <p>
                    <span className="fl-mfg">Due Date:</span> November 7th, 2026
                  </p>
                </div>
              </div>
            </div>

            <div className="fp-ri">
              <h3>Rental Information</h3>
              <div className="fp-ri-g">
                <div>
                  <p className="fl-mfg">Vehicle:</p>
                  <p className="fp-fm">Hyundai Sonata</p>
                  <p className="fl-mfg fp-xs">Reg: 9LMV284</p>
                </div>
                <div>
                  <p className="fl-mfg">Rental Period:</p>
                  <p className="fp-fm">Nov 7, 2026 - Nov 10, 2026</p>
                </div>
              </div>
            </div>

            <div className="fp-tbl">
              <div className="fp-tr fp-th">
                <span>Description</span>
                <span>Amount</span>
              </div>
              <div className="fp-tr fp-bb">
                <div>
                  <p className="fp-fm">Rental Fee</p>
                  <p className="fl-mfg fp-xs">Hyundai Sonata (9LMV284)</p>
                  <div className="fp-bd">
                    <span>$64.00/day × 3 days</span>
                  </div>
                </div>
                <span className="fp-fm fp-top">$192.00</span>
              </div>
              <div className="fp-tr fp-tot">
                <span>Total</span>
                <span>$192.00</span>
              </div>
            </div>

            <div className="fp-foot">
              <p>Thank you for your business!</p>
              <p className="fp-xs">This is a computer-generated invoice.</p>
            </div>
          </div>

          <div className="fp-dbtns">
            <span className="fl-btn out full">
              <Download className="fp-mr" />
              Print / Save PDF
            </span>
            <span className="fl-btn grad full fp-flat fl-tap">
              Continue to Sign Agreement
              <ArrowRight className="fp-ml" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Confirmed() {
  return (
    <>
      <div className="fp-succ">
        <div className="fp-scard">
          <div className="fp-ok">
            <CheckCircle />
          </div>
          <h1 className="fp-sh1">Rental Confirmed</h1>
          <p className="fp-ref">
            Reference: <span>3FA0D2B7</span>
          </p>
          <p className="fp-thx">Thank you for your rental. Your payment has been processed successfully.</p>

          <div className="fp-rs">
            <h2>Rental Summary</h2>
            <div className="fp-rs-g">
              <div>
                <span className="fl-mfg">Vehicle:</span>
                <span className="fp-fm">Hyundai Sonata</span>
              </div>
              <div>
                <span className="fl-mfg">Registration:</span>
                <span className="fp-fm">9LMV284</span>
              </div>
              <div>
                <span className="fl-mfg">Start Date:</span>
                <span className="fp-fm">Nov 07, 2026</span>
              </div>
              <div>
                <span className="fl-mfg">End Date:</span>
                <span className="fp-fm">Nov 10, 2026</span>
              </div>
              <div>
                <span className="fl-mfg">Period Type:</span>
                <span className="fp-fm">Daily</span>
              </div>
              <div className="fp-amt">
                <span className="fl-mfg fp-fm">Rental Amount:</span>
                <span className="fp-amt-v">$192.00</span>
              </div>
            </div>
          </div>

          <div className="fp-sbtns">
            <span className="fl-btn grad full fp-flat">
              <User className="fp-mr" />
              Go to My Portal
            </span>
            <span className="fl-btn out full">
              <Home className="fp-mr" />
              Return to Home
            </span>
          </div>
        </div>
      </div>
      {/* Navigation is fixed top-0, so it stays over the scrolled page */}
      <div className="fp-navfix">
        <SiteNav signedIn />
      </div>
    </>
  );
}

export const FLOW_PAY: Flow = {
  id: "pay",
  title: "Pay for the booking",
  blurb: "Card payment at checkout, invoice included",
  steps: [
    { caption: "The renter taps Confirm & Pay and watches the booking being set up, invoice and all.", ms: 3000 },
    { caption: "They check the invoice, then continue to sign the agreement and pay by card.", ms: 3400 },
    { caption: "Once the card goes through, they land on Rental Confirmed with a summary of the trip.", ms: 3200 },
  ],
  Screen: ({ step }) => (
    <FlowPhone step={step} className="fp">
      {step === 0 ? (
        <>
          <CheckoutUnder processing />
          <Progress />
        </>
      ) : step === 1 ? (
        <>
          <CheckoutUnder processing={false} />
          <Invoice />
        </>
      ) : (
        <Confirmed />
      )}
    </FlowPhone>
  ),
};
