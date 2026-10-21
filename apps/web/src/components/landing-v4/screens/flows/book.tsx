import type { CSSProperties, ReactNode } from "react";
import {
  Building2,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  CreditCard,
  Gauge,
  Globe,
  Grid3x3,
  List,
  Maximize2,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  User,
  Briefcase,
  Car,
  X,
} from "lucide-react";
import { FlowPhone, SiteNav } from "./chrome";
import type { Flow } from "./types";
import "./book.css";

/* ===================================================================== *
 * "Book a car" — the renter books on the tenant's own site, at a 390px
 * phone, in the ORIGINAL booking design (every tenant but northwind).
 *
 * Mirrored from apps/booking/src:
 *   - components/home/legacy-home.tsx 238-242: <section id="booking"
 *     py-20 bg-muted/20><div container px-4><MultiStepBookingWidget/>.
 *   - components/MultiStepBookingWidget.tsx
 *       3621-3653 getStepTitle + the .bk-hero header (h1, gradient rule,
 *                 subtitle; the trust-point meta is hidden below 640px)
 *       3677-3721 the Card (p-4 border shadow) and the 5-node stepper
 *       3742-4031 step 1 "Rental Details" (timezone bar, Pickup/Return,
 *                 "Continue to Vehicle Selection")
 *       4034-4925 step 2 "Select Your Vehicle" (toolbar, grid card, the
 *                 mobile action bar "Back" / "Review & Pay")
 *       5503-6338 step 4 "Your Details" (guest form, DOB, Identity
 *                 Verification → the guest's "Identity Verified" box)
 *       6341-6407 step 5 "Review & Confirm" → BookingCheckoutStep
 *   - components/LocationPicker.tsx 220-238 (fixed address only → the
 *     "Our Location" FREE card), components/ui/time-picker.tsx 365-391,
 *     components/ui/phone-input.tsx 150-232.
 *   - components/BookingCheckoutStep.tsx 1621-1890 (Rental Summary, Your
 *     Details, Terms) and 1891-2305 (Price Summary, Promo Code,
 *     "Confirm & Pay {grand total}", "Back to Vehicles", secured-by line).
 *   - app/(legacy)/globals.css 160-251 (.bk-hero, .bk-step__node/_line).
 *
 * Assumptions (a new self-serve tenant's defaults, from the migrations):
 *   - fixed_address_enabled true, multiple/area off → "Our Location" card.
 *   - tax_enabled false, service_fee_enabled false, global deposit 0, no
 *     extras, no weekend surcharge, no promo, no installments at 3 days →
 *     the Price Summary is just "Rental (3 days)" $192.00, so the Grand
 *     Total and the button are $192.00. Plate shown (registration not hidden).
 *   - booking_header CMS text as signup-provision seeds it
 *     (_shared/tenant-cms-content.ts 71-75) with location "Long Beach".
 *   - Not insurance-exempt, so the stepper has 5 nodes; this flow shows
 *     steps 1, 2, 4 and 5 (insurance is its own flow, insurance.tsx).
 *   - Step 4: a guest who has just verified in the session (verificationStatus
 *     'verified', not signed in). The ID photo thumbnails under "Identity
 *     Verified" are left out (they are the renter's own blurred documents).
 *   - Car photos are the landing's stock images; the Tesla/Camry rates and
 *     plates around the Sonata are demo data, like everything else here.
 * Each step opens on the hero and scrolls down to its card, the way the
 * page moves on a phone; the fixed Navigation stays on top.
 * ===================================================================== */

/* ------------------------------------------------------------------ */
/* Shared page pieces (insurance.tsx uses them too)                    */
/* ------------------------------------------------------------------ */

const STEPS = [
  { step: 1, label: "Trip", full: "Trip Details" },
  { step: 2, label: "Vehicle", full: "Choose Vehicle" },
  { step: 3, label: "Insurance", full: "Insurance Verification" },
  { step: 4, label: "Details", full: "Customer Details" },
  { step: 5, label: "Review", full: "Review & Confirm" },
];

/** The widget's stepper (3680-3721): done = check, current = glowing node. */
function Stepper({ current }: { current: number }) {
  return (
    <div className="fb-stepper">
      <div className="fb-steps">
        {STEPS.map(({ step, label, full }, i) => (
          <div key={step} className={`fb-st${step > current ? " far" : ""}`}>
            <div
              className={`fb-node${current >= step ? " on" : ""}${current === step ? " cur" : ""}`}
              aria-label={`Step ${step} of ${STEPS.length}: ${full}`}
            >
              {current > step ? <Check /> : <span>{step}</span>}
            </div>
            <span className={`fb-stl${current >= step ? " on" : ""}`}>{label}</span>
            {i < STEPS.length - 1 ? <div className="fb-line" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The home page's booking section with the widget, scrolled: the page opens
 * at `from` px and moves to `to` px (both down the page). The fixed site
 * Navigation sits over it.
 */
export function BookingPage({ title, current, from, to, delay, dur, children }: {
  title: string;
  current: number;
  from: number;
  to: number;
  /** when the scroll starts, ms (default 450) */
  delay?: number;
  /** how long the scroll takes, ms (default 1100) */
  dur?: number;
  children: ReactNode;
}) {
  const scroll = {
    "--fb-from": `${-from}px`,
    "--fb-to": `${-to}px`,
    ...(delay !== undefined ? { animationDelay: `${delay}ms` } : {}),
    ...(dur !== undefined ? { animationDuration: `${dur}ms` } : {}),
  } as CSSProperties;
  return (
    <>
      <div className="fb-scroll" style={scroll}>
        <section className="fb-sec">
          <section className="fb-hero">
            <h1>{title}</h1>
            <div className="fb-rule">
              <div />
            </div>
            <p>Pick your dates and vehicle — we&apos;ll take care of the rest in Long Beach.</p>
          </section>
          <div className="fb-card">
            <Stepper current={current} />
            <div className="fb-body">{children}</div>
          </div>
        </section>
      </div>
      <div className="fb-navfix">
        <SiteNav />
      </div>
    </>
  );
}

/** Step header: h3 + the outline "Start over" button (border-b-2 primary/30). */
export function StepHead({ title, big }: { title: string; big?: boolean }) {
  return (
    <div className={`fb-head${big ? " big" : ""}`}>
      <h3>{title}</h3>
      <StartOver />
    </div>
  );
}

export function StartOver() {
  return (
    <span className="fb-over">
      <RefreshCw /> Start over
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Rental Details                                              */
/* ------------------------------------------------------------------ */

function Leg({ kind }: { kind: "Pickup" | "Return" }) {
  return (
    <div className="fb-leg">
      <div className="fb-legh">
        <span className={`fb-dot ${kind === "Pickup" ? "g" : "o"}`} />
        <h4>{kind}</h4>
      </div>
      <div className="fb-field">
        <span className="fb-flab">Location</span>
        <div className="fb-fixed">
          <span className="fb-fixic">
            <Building2 />
          </span>
          <div className="fb-fixt">
            <div className="fb-fixn">
              <span>Our Location</span>
              <span className="fb-free">FREE</span>
            </div>
            <p>1200 Harbor Way, Long Beach, CA 90802</p>
          </div>
        </div>
      </div>
      <div className="fb-field">
        <span className="fb-flab">Date &amp; Time</span>
        <div className="fb-dt">
          <span className="fb-ob h11">
            <Calendar />
            {kind === "Pickup" ? "Nov 07" : "Nov 10"}
          </span>
          <span className="fb-ob h11">
            <Clock />
            10:00 AM
          </span>
        </div>
      </div>
    </div>
  );
}

function TripStep() {
  return (
    <div className="fb-s8">
      <StepHead title="Rental Details" />
      <div className="fb-tz">
        <div className="fb-tzl">
          <span className="fb-tzg">
            <Globe />
          </span>
          <span className="fb-mfg">You:</span>
          <span className="fb-tzsel">
            <span>Pacific Time (Los Angeles)</span>
            <ChevronDown />
          </span>
        </div>
        <div className="fb-clock">
          <Clock />
          <span>10:00 AM</span>
        </div>
      </div>
      <div className="fb-legs">
        <Leg kind="Pickup" />
        <Leg kind="Return" />
      </div>
      <span className="fb-pb h14 fl-tap">
        Continue to Vehicle Selection <ChevronRight className="ml" />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Select Your Vehicle                                         */
/* ------------------------------------------------------------------ */

function VehicleCard({ name, reg, colour, price, img, pick }: {
  name: string;
  reg: string;
  colour: string;
  price: string;
  img: string;
  pick?: boolean;
}) {
  return (
    <div className={`fb-vc${pick ? " pick" : ""}`}>
      <div className="fb-swap fb-vtag">
        <span className="fb-reg fb-was">{reg}</span>
        {pick ? (
          <span className="fb-tick fb-now">
            <Check />
          </span>
        ) : null}
      </div>
      <div className="fb-vimg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt="" />
        <span className="fb-photos">
          <Maximize2 />
          <span>View photos</span>
        </span>
      </div>
      <div className="fb-vb">
        <div className="fb-vinfo">
          <div>
            <h4>{name}</h4>
            <p className="fb-xs fb-mfg">{colour}</p>
          </div>
          <div className="fb-spec">
            <Gauge />
            Unlimited miles
          </div>
          <div className="fb-price">
            <div className="fb-prow">
              <span className="fb-pv">{price}</span>
              <span className="fb-pl">/ day *</span>
            </div>
            <p className="fb-tax">* + taxes and fees</p>
          </div>
        </div>
        {pick ? (
          <span className="fb-swap fb-selw">
            <span className="fb-sel fb-was fl-tap">Select</span>
            <span className="fb-sel on fb-now">Selected</span>
          </span>
        ) : (
          <span className="fb-sel">Select</span>
        )}
      </div>
    </div>
  );
}

function VehicleStep() {
  return (
    <div className="fb-s6">
      <span className="fb-ghost fb-back">
        <ChevronLeft /> Back to Trip Details
      </span>
      <div className="fb-vhead">
        <StepHead title="Select Your Vehicle" big />
        <p className="fb-lead">Choose from our curated fleet of premium rentals.</p>
        <div className="fb-trip">
          <Calendar />
          <span>Nov 07 → Nov 10</span>
          <span>•</span>
          <span>1200 Harbor Way</span>
          <span>•</span>
          <span>3 days</span>
        </div>
      </div>
      <div className="fb-tool">
        <div className="fb-search">
          <Search />
          <span>Search brand, model, or color…</span>
        </div>
        <span className="fb-trig">
          <span>Recommended</span>
          <ChevronDown />
        </span>
        <span className="fb-ob fb-filt">
          <SlidersHorizontal />
          Filters
        </span>
        <div className="fb-view">
          <span className="on">
            <Grid3x3 />
          </span>
          <span>
            <List />
          </span>
        </div>
      </div>
      {/* the list box: max-h-[70vh] overflow-y-auto, scrolled to the Sonata */}
      <div className="fb-list">
        <div className="fb-listin">
          <VehicleCard name="Tesla Model 3" reg="8ZTE403" colour="Midnight Silver" price="$89" img="/landing-v3/tesla-bg.webp" />
          <VehicleCard name="Hyundai Sonata" reg="9LMV284" colour="Silver" price="$64" img="/landing-v4/site/car1.webp" pick />
          <VehicleCard name="Toyota Camry" reg="7KQR551" colour="Black" price="$58" img="/landing-v3/car4.webp" />
        </div>
      </div>
      <div className="fb-bar">
        <span className="fb-ob lg">
          <ChevronLeft /> Back
        </span>
        <span className="fb-pb lg">
          Review &amp; Pay <ChevronRight className="ml" />
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — Your Details (guest, ID just verified)                      */
/* ------------------------------------------------------------------ */

function DetailsStep() {
  return (
    <div className="fb-s8">
      <StepHead title="Your Details" />
      <div className="fb-s8">
        <div className="fb-g4">
          <div className="fb-field">
            <span className="fb-lab">Full Name *</span>
            <span className="fb-in h12 dis">Daniel Reyes</span>
            <p className="fb-ok">
              <CheckCircle /> Verified from ID document
            </p>
          </div>
          <div className="fb-field">
            <span className="fb-lab">Email Address *</span>
            <span className="fb-in h12">daniel.reyes@example.com</span>
          </div>
        </div>
        <div className="fb-field">
          <span className="fb-lab">Phone Number *</span>
          <div className="fb-phone">
            <span className="fb-cc">
              <span>+1</span>
              <ChevronsUpDown />
            </span>
            <span className="fb-in valid">
              555 010 0147
              <span className="fb-cnt">10/10</span>
            </span>
          </div>
        </div>
      </div>
      <div className="fb-s8">
        <div className="fb-gig">
          <span className="fb-cb" />
          <div>
            <span className="fb-gigl">
              <Briefcase />
              Are you a gig driver?
            </span>
            <p className="fb-xs fb-mfg">Tick this if you drive for Uber, Bolt, Lyft, DoorDash, etc.</p>
          </div>
        </div>
        <div className="fb-field">
          <span className="fb-lab">Date of Birth *</span>
          <div className="fb-field">
            <span className="fb-in h12 ro">March 14, 1991</span>
            <p className="fb-from">
              <CheckCircle /> From your ID document
            </p>
            <p className="fb-age">
              Age: <span>35 years old</span>
            </p>
          </div>
        </div>
        <div className="fb-idv">
          <h4>
            Identity Verification <span className="fb-red">*</span>
          </h4>
          <p className="fb-req">
            <strong>Required:</strong> To ensure security and compliance, all customers must complete identity
            verification before proceeding with their rental.
          </p>
          <div className="fb-verified fl-late">
            <div className="fb-vrow">
              <CheckCircle />
              <div>
                <p className="fb-vt">Identity Verified</p>
                <p className="fb-xs fb-mfg">
                  Your identity has been verified as <strong>Daniel Reyes</strong>. Your details have been updated
                  with verified information.
                </p>
                <p className="fb-xs fb-mfg fb-lic">License/ID: D452****</p>
              </div>
            </div>
            <span className="fb-clear">
              <X /> Clear
            </span>
          </div>
        </div>
      </div>
      <div className="fb-nav2">
        <span className="fb-ob h11 pr">
          <ChevronLeft className="mr" /> Back
        </span>
        <span className="fb-pb h11 fl-tap">
          Continue <ChevronRight className="ml" />
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 5 — Review & Confirm (BookingCheckoutStep)                      */
/* ------------------------------------------------------------------ */

function ReviewStep() {
  return (
    <div className="fb-s6">
      <StepHead title="Review & Confirm" />
      <div className="fb-s6">
        <div className="fb-rc">
          <h3>Rental Summary</h3>
          <div className="fb-rcb">
            <div className="fb-ri">
              <Car />
              <div>
                <p className="fb-m">Hyundai Sonata</p>
                <p className="fb-sm fb-mfg">Silver • 9LMV284</p>
              </div>
            </div>
            <div className="fb-ri">
              <Calendar />
              <div>
                <p className="fb-m">3 days</p>
                <p className="fb-sm fb-mfg">Nov 07, 2026 - Nov 10, 2026</p>
              </div>
            </div>
            <div className="fb-tl">
              <div className="fb-tli">
                <span className="fb-tld on" />
                <p className="fb-tlk on">Pickup</p>
                <p className="fb-tla">1200 Harbor Way, Long Beach, CA 90802</p>
                <p className="fb-xs fb-mfg">Nov 07, 2026 at 10:00</p>
              </div>
              <div className="fb-tli last">
                <span className="fb-tld" />
                <p className="fb-tlk">Return</p>
                <p className="fb-tla">1200 Harbor Way, Long Beach, CA 90802</p>
                <p className="fb-xs fb-mfg">Nov 10, 2026 at 10:00</p>
              </div>
            </div>
          </div>
        </div>
        <div className="fb-rc">
          <h3 className="mb4">Your Details</h3>
          <div className="fb-who">
            <div>
              <User />
              <p className="fb-m">Daniel Reyes</p>
            </div>
            <div>
              <span className="fb-at">@</span>
              <p className="fb-sm">daniel.reyes@example.com</p>
            </div>
            <div>
              <span className="fb-at" />
              <p className="fb-sm">+1555 010 0147</p>
            </div>
          </div>
        </div>
        <div className="fb-rc plain">
          <div className="fb-agree">
            <span className="fb-cb on">
              <Check />
            </span>
            <p>
              I agree to the <span className="fb-ul">Terms &amp; Conditions</span> and{" "}
              <span className="fb-ul">Privacy Policy</span>.
            </p>
          </div>
          <div className="fb-agree">
            <span className="fb-cb on">
              <Check />
            </span>
            <p>
              I authorize <strong>Northwind Rentals</strong> to charge my payment method for post-rental charges
              permitted under the rental agreement, including excess mileage, cleaning, fuel, tolls, damage, late
              return fees, and other agreed charges.
            </p>
          </div>
          <p className="fb-xs fb-mfg">Additional post-rental charges may apply as described in the rental agreement.</p>
        </div>
        <div className="fb-rc sum">
          <h3 className="fb-metal">Price Summary</h3>
          <div className="fb-s3">
            <div>
              <div className="fb-line2">
                <span className="fb-mfg">Rental (3 days)</span>
                <span className="fb-m">$192.00</span>
              </div>
              <div className="fb-unit">$64.00/day × 3 days</div>
            </div>
            <div className="fb-sep" />
            <div className="fb-grand">
              <div>
                <span className="fb-xs fb-mfg">Amount Due</span>
                <span className="fb-gt">Grand Total</span>
              </div>
              <span className="fb-gv">$192.00</span>
            </div>
            <p className="fb-xs fb-mfg fb-rcpt">You&apos;ll receive a digital receipt immediately.</p>
          </div>
          <div className="fb-promo">
            <span className="fb-lab">Promo Code</span>
            <div>
              <span className="fb-in h9 ph">Enter code</span>
              <span className="fb-ob h9 dis">Apply</span>
            </div>
          </div>
          <div className="fb-pay">
            <span className="fb-gb fl-tap">
              <CreditCard className="mr" />
              Confirm &amp; Pay $192.00
            </span>
            <span className="fb-ob lg w">
              <ChevronLeft className="mr" />
              Back to Vehicles
            </span>
            <div className="fb-secure">
              <Shield />
              <span>Secured by Stripe. Card details never stored.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Screen({ step }: { step: number }) {
  return (
    <FlowPhone step={step} className="fb">
      {step === 0 ? (
        <BookingPage title="Book Your Rental" current={1} from={0} to={388}>
          <TripStep />
        </BookingPage>
      ) : step === 1 ? (
        <BookingPage title="Choose Vehicle" current={2} from={0} to={580}>
          <VehicleStep />
        </BookingPage>
      ) : step === 2 ? (
        <BookingPage title="Your Details" current={4} from={0} to={671}>
          <DetailsStep />
        </BookingPage>
      ) : (
        <BookingPage title="Review & Confirm" current={5} from={0} to={1216}>
          <ReviewStep />
        </BookingPage>
      )}
    </FlowPhone>
  );
}

export const FLOW_BOOK: Flow = {
  id: "book",
  title: "Book a car",
  blurb: "On your own booking site, any hour of the day",
  steps: [
    { caption: "They pick where they'll collect the car and the dates they need it.", ms: 3000 },
    { caption: "They browse your fleet and choose a car at your daily rate.", ms: 3200 },
    { caption: "They fill in their details and verify their ID on the spot.", ms: 3200 },
    { caption: "They check the summary and pay the total upfront.", ms: 3400 },
  ],
  Screen,
};
