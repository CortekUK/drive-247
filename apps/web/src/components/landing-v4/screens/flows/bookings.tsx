import type { ComponentType } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  Calendar,
  CalendarCheck,
  Car,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  DollarSign,
  History,
  MapPin,
  MessageCircle,
  Percent,
  Search,
} from "lucide-react";
import { FlowPhone, PortalHeader } from "./chrome";
import type { Flow } from "./types";
import "./bookings.css";

/* ===================================================================== *
 * Flow "See their bookings" — the ORIGINAL customer portal at 390px.
 *
 * Mirrors (apps/booking/src/...):
 *   app/(legacy)/(customer-portal)/layout.tsx  <main flex-col gap-4 p-4>,
 *       TraxChatWidget (components/customer-portal/trax-chat/TraxChatButton.tsx,
 *       fixed bottom-6 right-6 h-14 w-14)
 *   app/(legacy)/(customer-portal)/portal/bookings/page.tsx (219-425)
 *       header, StatCard ×4 (34-59), All/Active/Current/Past tabs, search,
 *       Newest First sort (h-11 full width below sm), the rental rows
 *       (330-401): thumb h-12 w-16, #ref pill, name, dates, "Booked …"; the
 *       plate, amount and Sign Agreement badge are hidden below sm.
 *   app/(legacy)/(customer-portal)/portal/bookings/[id]/page.tsx (809-1110)
 *       back button, "#ref" h1 font-mono, status badge, "vehicle • plate",
 *       photo h-36, info card (Period/Dates/Amount/Pickup/Mileage), the
 *       Payments/Agreements/Insurance tabs, and the top of the Payments tab:
 *       components/customer-portal/PaymentBreakdown.tsx (1005-1014, rows 492-530,
 *       row cells 757-870).
 *
 *   1  My Bookings, top of the page.
 *   2  The same page scrolled to its end; the renter taps the Sonata row.
 *   3  /portal/bookings/{id} for the Sonata.
 *
 * Demo data (shared with the other flows): the Sonata just booked and paid
 * (R-3fa0d2, booked 20 Oct 2026 09:52). A paid booking stays status
 * "Pending" until the operator approves it (BookingCheckoutStep 1099
 * status "Pending"/approval_status "pending"; the Stripe webhooks never set
 * rentals.status), so it shows the amber Pending badge. The Camry
 * (R-8c41e7) is Active; Tesla Model 3 and Ford Mustang are Completed.
 * Stats follow useCustomerRentalStats (hooks/use-customer-rentals.ts
 * 205-221): "Active Rentals" counts Active + Pending + Reserved rentals not yet
 * ended, so it is 2 (Sonata + Camry), not 1; Total 4; Past 2; Total Spent is
 * the sum of monthly_amount = 192 + 232 (Camry 4 × $58) + 255 (Tesla
 * 3 × $85) + 237 (Mustang 3 × $79) = $916.00. Rows sort by created_at, newest
 * first. Only the Sonata has a photo in apps/web/public; the others use the
 * page's own no-photo fallback (Car icon on bg-muted).
 *
 * Known product bug, copied as-is: the detail page appends a unit to the
 * TOTAL amount by comparing rental_period_type to lowercase 'daily'/'weekly',
 * but bookings store "Daily" (BookingCheckoutStep calculateRentalPeriodType),
 * so a 3-day rental reads "$192.00/mo" ([id]/page.tsx ~921-925). Change
 * AMOUNT_UNIT below if the booking app is fixed.
 * Mileage allowance (vehicle.daily_mileage 150, excess $0.25/mi) is demo data.
 * ===================================================================== */

const AMOUNT_UNIT = "/mo";

type Icon = ComponentType<{ className?: string }>;
type Status = "Pending" | "Active" | "Completed";

const STATS: [string, string, Icon][] = [
  ["Active Rentals", "2", Car],
  ["Total Rentals", "4", CalendarCheck],
  ["Past Rentals", "2", History],
  ["Total Spent", "$916.00", DollarSign],
];

const RENTALS: { ref: string; name: string; photo?: string; dates: string; booked: string; status: Status }[] = [
  { ref: "R-3fa0d2", name: "Hyundai Sonata", photo: "/landing-v4/cars/sonata.webp", dates: "07 Nov 2026 — 10 Nov 2026", booked: "20 Oct 2026, 09:52", status: "Pending" },
  { ref: "R-8c41e7", name: "Toyota Camry", dates: "18 Oct 2026 — 22 Oct 2026", booked: "11 Oct 2026, 16:20", status: "Active" },
  { ref: "R-b2e817", name: "Tesla Model 3", dates: "12 Sep 2026 — 15 Sep 2026", booked: "03 Sep 2026, 18:47", status: "Completed" },
  { ref: "R-04d9f3", name: "Ford Mustang", dates: "21 Aug 2026 — 24 Aug 2026", booked: "14 Aug 2026, 11:02", status: "Completed" },
];

function Trax() {
  return (
    <span className="fbk-trax">
      <MessageCircle />
    </span>
  );
}

function BookingsPage({ tap }: { tap?: boolean }) {
  return (
    <div className={tap ? "fbk-end" : undefined}>
      <PortalHeader />
      <main className="fl-main">
        <div className="fbk-pg">
          <div className="fbk-ph">
            <div>
              <h1>My Bookings</h1>
              <p>View and manage your rentals</p>
            </div>
            <span className="fl-btn pri full">
              <Car className="fbk-mr" />
              Book a Vehicle
            </span>
          </div>

          <div className="fbk-stats">
            {STATS.map(([title, value, I]) => (
              <div key={title} className="fl-card">
                <div className="fbk-sh">
                  <h3>{title}</h3>
                  <I />
                </div>
                <div className="fbk-sv">{value}</div>
              </div>
            ))}
          </div>

          <div className="fbk-bar">
            <div className="fbk-tabs">
              <span className="on">All</span>
              <span>Active</span>
              <span>Current</span>
              <span>Past</span>
            </div>
            <div className="fbk-tools">
              <div className="fbk-srch">
                <Search />
                <span>Search by reference...</span>
              </div>
              <div className="fbk-sort">
                <ArrowUpDown />
                <span className="fbk-sel">
                  <span>Newest First</span>
                  <ChevronDown />
                </span>
              </div>
            </div>
          </div>

          <div className="fbk-list">
            {RENTALS.map((r, i) => (
              <div key={r.ref} className={`fbk-row${tap && i === 0 ? " fl-tap" : ""}`}>
                <div className="fbk-th">
                  {r.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.photo} alt={r.name} />
                  ) : (
                    <Car />
                  )}
                </div>
                <div className="fbk-info">
                  <div className="fbk-l1">
                    <span className="fbk-ref">#{r.ref}</span>
                    <p className="fbk-nm">{r.name}</p>
                  </div>
                  <div className="fbk-l2">
                    <span>
                      <Calendar />
                      {r.dates}
                    </span>
                    <span>
                      <Clock />
                      Booked {r.booked}
                    </span>
                  </div>
                </div>
                {/* Alerts (Sign Agreement / Extension Pending are hidden below sm) */}
                <div className="fbk-alerts" />
                <span className={`fl-badge fbk-st ${r.status.toLowerCase()}`}>{r.status}</span>
                <ChevronRight className="fbk-chev" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function BookingDetail() {
  return (
    <>
      <PortalHeader />
      <main className="fl-main">
        <div className="fbk-dpg">
          <div className="fbk-dh">
            <span className="fbk-back">
              <ArrowLeft />
            </span>
            <div className="fbk-dhm">
              <div className="fbk-dh1">
                <h1>#R-3fa0d2</h1>
                {/* copy button: opacity-0 until hover/focus, still takes its place */}
                <span className="fbk-copy">
                  <Copy />
                </span>
                <span className="fl-badge fbk-amber">Pending</span>
              </div>
              <p className="fbk-dsub">Hyundai Sonata • 9LMV284</p>
            </div>
          </div>

          <div className="fbk-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="fbk-photo" src="/landing-v4/cars/sonata.webp" alt="Hyundai Sonata" />
            <div className="fl-card fbk-info-c">
              <div>
                <Calendar />
                <span className="fl-mfg">Period:</span>
                <span>Daily</span>
              </div>
              <div>
                <Calendar />
                <span className="fl-mfg">Dates:</span>
                <span>07 Nov 2026 — 10 Nov 2026</span>
              </div>
              <div>
                <CreditCard />
                <span className="fl-mfg">Amount:</span>
                <span className="fbk-fm">
                  $192.00<span className="fl-mfg fbk-fn">{AMOUNT_UNIT}</span>
                </span>
              </div>
              <div>
                <MapPin />
                <span className="fl-mfg">Pickup:</span>
                <span className="fbk-trunc">1200 Harbor Way, Long Beach, CA 90802</span>
              </div>
              <div>
                <Clock />
                <span className="fl-mfg">Mileage:</span>
                <span>
                  150 miles<span className="fl-mfg"> (excess: $0.25/mi)</span>
                </span>
              </div>
            </div>
          </div>

          <div>
            <div className="fbk-dtabs">
              <span className="on">Payments</span>
              <span>Agreements</span>
              <span>Insurance</span>
            </div>
            <div className="fl-card fbk-pb fl-late">
              <h3>Payment Breakdown</h3>
              <div className="fbk-tw">
                <table>
                  <thead>
                    <tr>
                      <th className="fbk-pl6">Category</th>
                      <th className="fbk-w110">Mode</th>
                      <th className="fbk-w110 fbk-c">Status</th>
                      <th className="fbk-w110 fbk-r">Amount</th>
                      <th className="fbk-w110 fbk-r">Refunded</th>
                      <th className="fbk-w120 fbk-r fbk-pr6">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="fbk-pl6">
                        <div className="fbk-cat">
                          <span className="fbk-ci fbk-grn">
                            <Car />
                          </span>
                          <div>
                            <p className="fbk-cl">Rental</p>
                            <p className="fbk-cd">Daily</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="fl-badge fbk-ob fbk-mode">Regular</span>
                      </td>
                      <td className="fbk-c">
                        <span className="fl-badge fbk-ob fbk-paid">Paid</span>
                      </td>
                      <td className="fbk-r fbk-amt">$192.00</td>
                      <td className="fbk-r">
                        <span className="fbk-dash">-</span>
                      </td>
                      <td className="fbk-r fbk-pr6">
                        <span className="fbk-dash fbk-dash3">-</span>
                      </td>
                    </tr>
                    <tr className="fbk-na">
                      <td className="fbk-pl6">
                        <div className="fbk-cat">
                          <span className="fbk-ci">
                            <Percent />
                          </span>
                          <div>
                            <p className="fbk-cl">Tax</p>
                            <p className="fbk-cd">Not applied</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="fl-badge fbk-ob fbk-mode">Regular</span>
                      </td>
                      <td className="fbk-c">
                        <span className="fl-badge fbk-ob fbk-mode">Not Applied</span>
                      </td>
                      <td className="fbk-r fbk-amt">$0.00</td>
                      <td className="fbk-r">
                        <span className="fbk-dash">-</span>
                      </td>
                      <td className="fbk-r fbk-pr6">
                        <span className="fbk-dash fbk-dash3">-</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export const FLOW_BOOKINGS: Flow = {
  id: "bookings",
  title: "See their bookings",
  blurb: "Every rental in their own account",
  steps: [
    { caption: "The renter opens My Bookings and sees their rentals and what they have spent so far.", ms: 3000 },
    { caption: "They scroll their rentals, past and upcoming, and tap the one they just booked.", ms: 2800 },
    { caption: "The booking shows the car, dates, amount and pickup address, with payments, agreement and insurance on tabs.", ms: 3400 },
  ],
  Screen: ({ step }) => (
    <FlowPhone step={step} className="fb">
      {step === 2 ? <BookingDetail /> : <BookingsPage tap={step === 1} />}
      <Trax />
    </FlowPhone>
  ),
};
