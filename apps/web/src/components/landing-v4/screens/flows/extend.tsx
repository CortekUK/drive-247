import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CalendarIcon,
  CalendarPlus,
  Car,
  CircleCheck,
  Clock,
  Copy,
  CreditCard,
  MapPin,
  MessageCircle,
  Package,
  Percent,
  Receipt,
  Shield,
  ShieldCheck,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import { FlowPhone, PortalHeader } from "./chrome";
import type { Flow } from "./types";
import "./extend.css";

/* ===================================================================== *
 * Renter flow "Ask for more days": an extension request from the ORIGINAL
 * customer portal, on a 390px phone (no sm:/md: classes apply).
 *
 * Mirrored (apps/booking/src):
 *   - app/(legacy)/(customer-portal)/portal/bookings/[id]/page.tsx
 *       736-740  canExtend = status 'Active' && !is_extended && !PAYG;
 *                hasExtensionPending = is_extended
 *       808-880  header: ghost icon ArrowLeft, h1 "#{rental_number}" text-2xl
 *                font-bold font-mono, the hover-only Copy button (opacity-0
 *                but in the row), status Badge (bg-green-100 text-green-800
 *                for Active), "Extension Pending" (bg-amber-100
 *                text-amber-800), subtitle "{make model} • {reg}" truncate;
 *                then "Request Extension" (CalendarPlus) or the outline
 *                destructive "Cancel Extension Request" (XCircle). At 390px
 *                that button keeps its full width (whitespace-nowrap), so the
 *                title block is squeezed and wraps; drawn as the CSS lays it out.
 *       882-990  photo w-full h-36, the info Card (grid-cols-1, rows
 *                "Period:", "Dates:" dd MMM yyyy, "Amount:", "Pickup:",
 *                "Mileage:"). "Amount:" is monthly_amount (the checkout stores
 *                the grand total there) + a suffix chosen by
 *                rental_period_type === 'daily'; checkout stores 'Daily', so
 *                the code really prints "/mo" — drawn as it renders.
 *       1001-1018 the amber "Outstanding Balance" card (only when > 0)
 *       1102-1186 Tabs grid-cols-3 "Payments" | "Agreements" | "Insurance",
 *                Payments → <PaymentBreakdown>.
 *       270-280 / 1460-1497 Cancel-request AlertDialog (not opened here).
 *   - components/customer-portal/ExtendRentalDialog.tsx 166-400: the dialog
 *     (max-w-[90vw], centred header on mobile), "Current End Date" (MMMM dd,
 *     yyyy), "New End Date" + the CustomerExtensionCalendar trigger (outline,
 *     CalendarIcon, "MMM d, yyyy"), "Select a date after …", the blue
 *     "Estimated Extension Cost" box ("{n} days x {rate}/day"), the info Alert,
 *     "Cancel" / "Request Extension"; then the confirm view: amber title,
 *     "This action cannot be undone!", the summary rows, the sentence, "Go Back"
 *     / "Confirm Request" (bg-amber-600). Success → toast.success("Extension
 *     request submitted successfully"); the page's realtime channel on the
 *     rentals row (page.tsx 576-579) refetches, so is_extended shows.
 *   - hooks/use-extension-pricing.ts: Daily → vehicles.daily_rent per day
 *     (no surcharges by default) → 2 × $58.00 = $116.00.
 *   - components/customer-portal/PaymentBreakdown.tsx 690-925 + 1000-1011:
 *     the single-table card (no extensions yet), used below the tabs.
 *   - components/ui/dialog.tsx, alert.tsx, sonner.tsx (bottom toast,
 *     bg-background, border, shadow-lg).
 *
 * Assumptions:
 *   - Default tenant settings: tax_enabled and service_fee_enabled default to
 *     false (supabase/migrations), so extensionTaxAmount and
 *     extensionServiceFee are 0 and the dialog leaves the "Tax (x%)" and
 *     "Service Fee" rows out, as its `> 0` guards do. Estimated Cost = $116.00.
 *   - No weekend surcharge (weekend_surcharge_percent defaults to 0); Oct 22 and
 *     Oct 23 are weekdays anyway. No promo code, no PAYG, no colour on file.
 *   - The rental: Daily, 18 → 22 Oct 2026, monthly_amount $232.00 paid in full,
 *     no deposit hold, delivery, insurance or extras (those rows show
 *     "Not applied", dimmed, as the component draws $0 rows).
 *   - Demo values: pickup address, 150 miles a day, $0.35/mi excess.
 *   - The car photo is the landing's stock sedan (/landing-v4/site/car1.webp);
 *     there is no Camry photo in apps/web/public.
 *   - The date is picked in a second dialog (CustomerExtensionCalendar); the
 *     flow shows the form after the pick rather than that picker.
 * ===================================================================== */

const REF = "#R-8c41e7";

/** booking detail Badge colours (getRentalStatusColor etc.) */
type Tone = "grn" | "blu" | "teal" | "pur" | "amb" | "cyan" | "rose" | "ind";

export type BreakdownRow = {
  label: string;
  detail: string;
  Icon: typeof Car;
  tone: Tone;
  amount: string;
  /** amount > 0 */
  applied: boolean;
  status: "Paid" | "Not Paid" | "Not Applied" | "No Hold";
  /** shows a checkbox (unpaid, amount > 0, not the deposit) */
  selectable?: boolean;
  checked?: boolean;
};

/** The original-rental rows as PaymentBreakdown builds them (373-457) for a paid Daily rental. */
export const ORIGINAL_ROWS: BreakdownRow[] = [
  { label: "Rental", detail: "Daily", Icon: Car, tone: "grn", amount: "$232.00", applied: true, status: "Paid" },
  { label: "Tax", detail: "Not applied", Icon: Percent, tone: "blu", amount: "$0.00", applied: false, status: "Not Applied" },
  { label: "Insurance", detail: "Not applied", Icon: ShieldCheck, tone: "teal", amount: "$0.00", applied: false, status: "Not Applied" },
  { label: "Service Fee", detail: "Not applied", Icon: Receipt, tone: "pur", amount: "$0.00", applied: false, status: "Not Applied" },
  { label: "Pre-Auth Hold", detail: "Not applied", Icon: Shield, tone: "amb", amount: "$0.00", applied: false, status: "No Hold" },
  { label: "Delivery Fee", detail: "Not applied", Icon: Truck, tone: "cyan", amount: "$0.00", applied: false, status: "Not Applied" },
  { label: "Collection Fee", detail: "Not applied", Icon: MapPin, tone: "rose", amount: "$0.00", applied: false, status: "Not Applied" },
  { label: "Extras", detail: "Not applied", Icon: Package, tone: "ind", amount: "$0.00", applied: false, status: "Not Applied" },
];

/**
 * PaymentBreakdown's renderTable (690-925): Table inside `relative w-full
 * overflow-auto`, so at 390px the 7 columns overflow and the renter swipes.
 * `swipe` plays that swipe (the table slides left to show Status/Amount).
 */
export function BreakdownTable({ rows, swipe }: { rows: BreakdownRow[]; swipe?: boolean }) {
  const anySelectable = rows.some((r) => r.selectable);
  const allChecked = anySelectable && rows.filter((r) => r.selectable).every((r) => r.checked);
  return (
    <div className="fx-tw">
      <table className={`fx-t${swipe ? " fx-swipe" : ""}`}>
        <thead>
          <tr>
            {anySelectable ? (
              <th className="fx-ck">
                <span className={`fx-box${allChecked ? " on" : ""}`}>{allChecked ? <CheckMark /> : null}</span>
              </th>
            ) : null}
            <th className={anySelectable ? "" : "fx-pl6"}>Category</th>
            <th className="fx-w110">Mode</th>
            <th className="fx-w110 fx-c">Status</th>
            <th className="fx-w110 fx-r">Amount</th>
            <th className="fx-w110 fx-r">Refunded</th>
            <th className="fx-w120 fx-r fx-pr6">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, detail, Icon, tone, amount, applied, status, selectable, checked }) => {
            // opacity-40 when !applied && !showHoldState (no hold on file → not shown)
            const unpaid = status === "Not Paid";
            return (
              <tr key={label + detail} className={applied ? undefined : "fx-dim"}>
                {anySelectable ? (
                  <td className="fx-ck">
                    {selectable ? (
                      <span className={`fx-box${checked ? " on" : ""}`}>{checked ? <CheckMark /> : null}</span>
                    ) : null}
                  </td>
                ) : null}
                <td className={anySelectable ? "" : "fx-pl6"}>
                  <div className="fx-cat">
                    <span className={`fx-ico${applied ? ` fx-${tone}` : ""}`}>
                      <Icon />
                    </span>
                    <div>
                      <p className="fx-lb">{label}</p>
                      <p className="fx-dt">{detail}</p>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="fx-bd fx-bd-mode">Regular</span>
                </td>
                <td className="fx-c">
                  <span className={`fx-bd fx-bd-${status === "Paid" ? "paid" : unpaid ? "due" : "na"}`}>{status}</span>
                </td>
                <td className="fx-r">
                  <span className={`fx-amt${applied ? "" : " fx-amt-na"}`}>{amount}</span>
                </td>
                <td className="fx-r">
                  <span className="fx-dash">-</span>
                </td>
                <td className="fx-r fx-pr6">{unpaid ? <span className="fx-pay">Pay</span> : <span className="fx-dash2">-</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Checkbox's Indicator: lucide Check h-4 w-4 */
function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * The booking detail page (page.tsx 806-1186) for the active Camry.
 * `children` is the Payments tab's content.
 */
export function BookingDetail({
  dates,
  action,
  tapAction,
  pending,
  balance,
  children,
}: {
  dates: string;
  action: "request" | "cancel";
  tapAction?: boolean;
  pending?: boolean;
  balance?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <PortalHeader />
      <main className="fl-main">
        <div className="fx-pg">
          {/* Back button + header */}
          <div className="fx-hd">
            <span className="fx-back">
              <ArrowLeft />
            </span>
            <div className="fx-tt">
              <div className="fx-tl">
                <h1>{REF}</h1>
                <span className="fx-copy">
                  <Copy />
                </span>
                <span className="fl-badge fx-b-grn">Active</span>
                {pending ? <span className="fl-badge fx-b-amb">Extension Pending</span> : null}
              </div>
              <p className="fx-sub">Toyota Camry • 7KQR551</p>
            </div>
            {action === "request" ? (
              <span className={`fl-btn pri fx-act${tapAction ? " fl-tap" : ""}`}>
                <CalendarPlus />
                Request Extension
              </span>
            ) : (
              <span className="fl-btn out fx-act fx-cxl">
                <XCircle />
                Cancel Extension Request
              </span>
            )}
          </div>

          {/* Vehicle photo + quick info */}
          <div className="fx-veh">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing-v4/site/car1.webp" alt="Toyota Camry" />
            <div className="fl-card fx-info">
              <div>
                <Calendar />
                <span className="fl-mfg">Period:</span>
                <span>Daily</span>
              </div>
              <div>
                <Calendar />
                <span className="fl-mfg">Dates:</span>
                <span>{dates}</span>
              </div>
              <div>
                <CreditCard />
                <span className="fl-mfg">Amount:</span>
                <span className="fx-strong">
                  $232.00<span className="fl-mfg fx-norm">/mo</span>
                </span>
              </div>
              <div>
                <MapPin />
                <span className="fl-mfg">Pickup:</span>
                <span className="fx-trunc">1420 Harbor Blvd, Oakland, CA</span>
              </div>
              <div>
                <Clock />
                <span className="fl-mfg">Mileage:</span>
                <span>
                  150 miles<span className="fl-mfg"> (excess: $0.35/mi)</span>
                </span>
              </div>
            </div>
          </div>

          {/* Balance summary */}
          {balance ? (
            <div className="fl-card fx-bal">
              <AlertCircle />
              <div>
                <p className="fx-bal-l">Outstanding Balance</p>
                <p className="fx-bal-v">{balance}</p>
              </div>
            </div>
          ) : null}

          {/* Tabs: Payments / Agreements / Insurance */}
          <div>
            <div className="fx-tabs">
              <span className="on">Payments</span>
              <span>Agreements</span>
              <span>Insurance</span>
            </div>
            <div className="fx-tabc">{children}</div>
          </div>
        </div>
      </main>
    </>
  );
}

/** TraxChatWidget → TraxChatButton, fixed on every portal page. */
export function TraxButton() {
  return (
    <span className="fx-trax">
      <MessageCircle />
    </span>
  );
}

/** PaymentBreakdown with no extensions: one card, one table (1000-1011). */
function OriginalBreakdown() {
  return (
    <div className="fl-card">
      <h3 className="fx-pbt">Payment Breakdown</h3>
      <BreakdownTable rows={ORIGINAL_ROWS} />
    </div>
  );
}

/** ExtendRentalDialog's DialogContent over the page (overlay bg-black/80). */
function Dialog({ children }: { children: ReactNode }) {
  return (
    <div className="fx-ov">
      <div className="fx-dlg fl-late">
        {children}
        <span className="fx-x">
          <X />
        </span>
      </div>
    </div>
  );
}

function RequestForm() {
  return (
    <Dialog>
      <div className="fx-dh">
        <h2>Extend Rental</h2>
        <p>Request an extension for your rental. The admin will review your request.</p>
      </div>
      <div className="fx-db">
        <div className="fx-cur">
          <Calendar />
          <div>
            <p>Current End Date</p>
            <p className="fx-cur-v">October 22, 2026</p>
          </div>
        </div>

        <div className="fx-pick">
          <span className="fx-lab">New End Date</span>
          <span className="fl-btn out fx-trig">
            <CalendarIcon />
            <span>Oct 24, 2026</span>
          </span>
          <p className="fx-help">Select a date after Oct 22, 2026</p>
        </div>

        <div className="fx-est">
          <div className="fx-est-h">
            <CreditCard />
            <span>Estimated Extension Cost</span>
          </div>
          <p className="fx-est-v">$116.00</p>
          <p className="fx-est-d">2 days x $58.00/day</p>
        </div>

        <div className="fx-alert">
          <AlertCircle />
          <div>
            Your request will be reviewed by our team. You will be notified once it&apos;s approved or if additional
            information is needed.
          </div>
        </div>

        <div className="fx-btns">
          <span className="fl-btn out">Cancel</span>
          <span className="fl-btn pri fl-tap">Request Extension</span>
        </div>
      </div>
    </Dialog>
  );
}

function ConfirmView() {
  return (
    <Dialog>
      <div className="fx-dh">
        <h2 className="fx-warn">
          <AlertTriangle />
          Confirm Extension Request
        </h2>
      </div>
      <div className="fx-db">
        <div className="fx-alert fx-undo">
          <AlertTriangle />
          <div>This action cannot be undone!</div>
        </div>

        <div className="fx-sum">
          <div className="fx-row">
            <span className="fl-mfg">Current End Date</span>
            <span className="fx-v">Oct 22, 2026</span>
          </div>
          <div className="fx-row">
            <span className="fl-mfg">New End Date</span>
            <span className="fx-v fx-pri">Oct 24, 2026</span>
          </div>
          <div className="fx-row fx-sep">
            <span className="fx-per">Extension Period</span>
            <span className="fx-plus">+2 days</span>
          </div>
          <div className="fx-cost">
            <div className="fx-row">
              <span className="fl-mfg">Rental Fee</span>
              <span className="fx-sm">$116.00</span>
            </div>
            <div className="fx-row fx-tot">
              <span>Estimated Cost</span>
              <span className="fx-big">$116.00</span>
            </div>
          </div>
        </div>

        <p className="fx-by">
          By confirming, you are requesting to extend your rental by <strong>2 days</strong>. The estimated cost is $116.00.
          The admin will review and approve your request.
        </p>

        <div className="fx-btns">
          <span className="fl-btn out">Go Back</span>
          <span className="fl-btn pri fx-amber fl-tap">Confirm Request</span>
        </div>
      </div>
    </Dialog>
  );
}

function Screen({ step }: { step: number }) {
  const pending = step === 3;
  return (
    <FlowPhone step={step} className="fx">
      <BookingDetail dates="18 Oct 2026 — 22 Oct 2026" action={pending ? "cancel" : "request"} tapAction={step === 0} pending={pending}>
        <OriginalBreakdown />
      </BookingDetail>
      <TraxButton />
      {step === 1 ? <RequestForm /> : null}
      {step === 2 ? <ConfirmView /> : null}
      {pending ? (
        <div className="fx-toast fl-late">
          <CircleCheck />
          <span>Extension request submitted successfully</span>
        </div>
      ) : null}
    </FlowPhone>
  );
}

export const FLOW_EXTEND: Flow = {
  id: "extend",
  title: "Ask for more days",
  blurb: "They request it, you approve it",
  steps: [
    { caption: "Mid-rental, your renter opens the booking and taps Request Extension.", ms: 3000 },
    { caption: "They pick a new return date and see the estimated cost straight away.", ms: 3400 },
    { caption: "They check the summary and confirm. Nothing is charged yet.", ms: 3200 },
    { caption: "The booking shows Extension Pending until you approve it in your dashboard.", ms: 3200 },
  ],
  Screen,
};
