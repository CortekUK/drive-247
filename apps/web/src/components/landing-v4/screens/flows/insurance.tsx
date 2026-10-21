import {
  AlertCircle,
  Briefcase,
  Car,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FileCheck,
  Shield,
  ShieldCheck,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { FlowPhone } from "./chrome";
import { BookingPage, StartOver, StepHead } from "./book";
import type { Flow } from "./types";
import "./insurance.css";

/* ===================================================================== *
 * "Add insurance" — the widget's step 3 with Bonzah switched on, at a 390px
 * phone, in the ORIGINAL booking design (every tenant but northwind).
 *
 * Mirrored from apps/booking/src:
 *   - components/MultiStepBookingWidget.tsx
 *       4929-4983 step 3 header ("Start over", shield, "Insurance
 *                 Verification" + its paragraph)
 *       4986-5208 "Do you have existing insurance coverage?": the YES card
 *                 and — with isBonzahSellable (config/tenant-config.ts 40-47:
 *                 integration_bonzah on and Bonzah in live mode) — the Bonzah
 *                 card "No, I Need Insurance" / "Get Insurance Now". (A tenant
 *                 without Bonzah sees "No, I Don't Have Insurance" / "Continue
 *                 Without Insurance" there instead.)
 *       5371-5465 the coverage view: "Edit Details", BonzahInsuranceSelector,
 *                 "Go Back" / "Continue to Details"
 *       3417-3428 handleStep3Continue → step 4; 5503-5862 "Your Details",
 *                 whose "Address Information (Required for insurance)"
 *                 block shows because bonzahPremium > 0, pre-filled from
 *                 the Bonzah details form (handleBonzahDetailsSubmit 3437-3448).
 *   - components/BonzahInsuranceSelector.tsx 210-707 (bundle card, the four
 *     coverage cards, "Total Insurance Premium", "Skip Insurance", the
 *     disclosure) with hooks/useBonzahPremium.ts COVERAGE_INFO 152-237 and
 *     lib/bonzah-compliance.ts 73-90, all copy verbatim.
 * Between steps 1 and 2 the renter fills BonzahDetailsForm (address,
 * licence, date of birth); the flow skips that form and opens on the cover.
 *
 * Assumptions: the Sonata is Bonzah-eligible; pickup Nov 7 is after
 * tomorrow (LA time), so no date warnings show. Premiums come from Bonzah's
 * live quote and are DEMO numbers here: the CDW + RCLI bundle = $80.70 for
 * the 3 days (the only price on screen — bundled cards hide their own).
 * Coverage cards' unselected icon tile uses style `var(--muted)`, an HSL
 * triplet, so it computes to transparent — drawn that way. Guest renter;
 * ID not verified yet on step 4. Same tokens, Navigation and stepper as
 * book.tsx; demo data throughout.
 * ===================================================================== */

/* ------------------------------------------------------------------ */
/* Step 3 header (shown above every insurance view)                     */
/* ------------------------------------------------------------------ */

function InsHead() {
  return (
    <>
      <div className="fi-over">
        <StartOver />
      </div>
      <div className="fi-head">
        <span className="fi-shield">
          <Shield />
        </span>
        <h3>Insurance Verification</h3>
        <p>
          Protect your rental with insurance coverage. Choose from your existing policy or get instant coverage through
          our partner.
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — the choice                                                  */
/* ------------------------------------------------------------------ */

function Choice() {
  return (
    <div className="fb-s8">
      <InsHead />
      <div>
        <div className="fi-q">
          <h4>Do you have existing insurance coverage?</h4>
          <div className="fi-opts">
            <div className="fi-opt">
              <div className="fi-optt">
                <div className="fi-ic">
                  <span>
                    <CheckCircle />
                  </span>
                </div>
                <div>
                  <h5>Yes, I Have Insurance</h5>
                  <p>Upload your current insurance certificate and we&apos;ll verify it instantly</p>
                </div>
              </div>
              <div className="fi-optb">
                <span className="fi-btn">
                  <Upload className="mr" />
                  Upload New Certificate
                </span>
                <p className="fi-foot">
                  Instant AI verification
                  <br />
                  Accepted formats: PDF, JPG, PNG
                  <br />
                  Max file size: 10MB
                </p>
              </div>
            </div>
            <div className="fi-opt fi-bz">
              <div className="fi-optt">
                <div className="fi-ic">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/landing-v4/site/bonzah-logo-dark.svg" alt="Bonzah" />
                </div>
                <div>
                  <h5>No, I Need Insurance</h5>
                  <p>Get instant coverage through our trusted partner Bonzah</p>
                </div>
              </div>
              <div className="fi-optb">
                <span className="fi-btn fl-tap">
                  <Shield className="mr" />
                  Get Insurance Now
                </span>
                <p className="fi-foot">
                  Instant online quotes
                  <br />
                  Affordable rates
                  <br />
                  Quick 5-minute setup
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="fi-backrow">
          <span className="fb-ob lg">
            <ChevronLeft className="mr" /> Back to Vehicles
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — BonzahInsuranceSelector                                     */
/* ------------------------------------------------------------------ */

/** Switch: h-6 w-11 rounded-full; checked bg-primary, thumb translate-x-5. */
function Switch({ on, flip, disabled }: { on?: boolean; flip?: boolean; disabled?: boolean }) {
  return (
    <span className={`fi-sw${on ? " on" : ""}${flip ? " flip" : ""}${disabled ? " dis" : ""}`}>
      <i />
    </span>
  );
}

function Feature({ children }: { children: ReactNode }) {
  return (
    <div className="fi-feat">
      <Check />
      <span>{children}</span>
    </div>
  );
}

function CoverageCard({ Icon, name, short, sub, tagline, description, deductible, noDeductible, max, features, bundled }: {
  Icon: typeof Car;
  name: string;
  short: string;
  sub: ReactNode;
  tagline: string;
  description: string;
  deductible: string;
  noDeductible?: boolean;
  max: string;
  features: string[];
  bundled?: boolean;
}) {
  return (
    <div className={`fi-cov${bundled ? " bundled" : ""}`}>
      <div className="fi-covh">
        <div className="fi-covl">
          <span className="fi-tile">
            <Icon />
          </span>
          <div className="fi-covn">
            <div className="fi-nm">
              <h4>{name}</h4>
              <span className="fi-badge sec">{short}</span>
            </div>
            {sub}
          </div>
        </div>
        <Switch disabled={bundled} />
      </div>
      <p className="fi-tag">{tagline}</p>
      <p className="fi-desc">{description}</p>
      <div className="fi-badges">
        <span className={`fi-badge ${noDeductible ? "em" : "sec"}`}>{deductible}</span>
        <span className="fi-badge out">{max}</span>
      </div>
      <div className="fi-feats">
        {features.map((f) => (
          <Feature key={f}>{f}</Feature>
        ))}
      </div>
      <span className="fi-more">
        View Full Coverage Details <ChevronDown />
      </span>
    </div>
  );
}

/** "Click to add coverage" → "Included in the CDW + RCLI bundle" when the bundle flips on. */
function BundledSub() {
  return (
    <span className="fi-swap">
      <span className="fi-sub fi-was">Click to add coverage</span>
      <span className="fi-sub fi-now">Included in the CDW + RCLI bundle</span>
    </span>
  );
}

function Selector() {
  return (
    <div className="fb-s8">
      <InsHead />
      <div className="fb-s6">
        <div className="fi-edit">
          <span>Edit Details</span>
        </div>
        <div className="fb-s6">
          <div className="fi-sh">
            <h3>Protect Your Trip with Bonzah</h3>
            <p>
              Add comprehensive insurance coverage powered by Bonzah. Select the coverages that fit your needs.
            </p>
          </div>

          {/* the CDW + RCLI bundle — flips on */}
          <div className="fi-cov fi-bundle">
            <div className="fi-covh">
              <div className="fi-covl">
                <span className="fi-tile fi-btile">
                  <ShieldCheck />
                </span>
                <div className="fi-covn">
                  <div className="fi-nm">
                    <h4>Damage + Liability Bundle</h4>
                    <span className="fi-badge sec">CDW + RCLI</span>
                  </div>
                  <span className="fi-swap">
                    <span className="fi-sub fi-was">Collision + liability in one selection</span>
                    <span className="fi-price fi-now">
                      $80.70<span>total</span>
                    </span>
                  </span>
                </div>
              </div>
              <span className="fi-tapw fl-tap">
                <Switch flip />
              </span>
            </div>
            <p className="fi-desc mt3">
              Turns on both Collision Damage Waiver (CDW) and Renter&apos;s Contingent Liability (RCLI) together. You
              can still adjust each coverage individually below.
            </p>
            <span className="fi-more">
              View Full Coverage Details <ChevronDown />
            </span>
          </div>

          <div className="fi-grid">
            <CoverageCard
              Icon={Car}
              name="Collision Damage Waiver"
              short="CDW"
              sub={<BundledSub />}
              tagline="Affordable Rental Vehicle Damage Insurance"
              description="Covers physical damages to the rental vehicle when there is an accident with another vehicle."
              deductible="$1,000 Deductible"
              max="Up to $35,000"
              features={["Up to $35,000 Damage", "$1,000 Deductible", "Primary Insurance for accidents between vehicles"]}
              bundled
            />
            <CoverageCard
              Icon={Shield}
              name="Renter's Contingent Liability Insurance"
              short="RCLI"
              sub={<BundledSub />}
              tagline="Primary State Minimum Liability Insurance"
              description="Covers damage to 3rd parties' property and injury when renter is at fault in accident. Does not cover rental vehicle damage or occupants (where allowed by law)."
              deductible="No Deductible"
              noDeductible
              max="State minimum limits"
              features={[
                "Bodily Injury - Per Person - $25,000.00 (specific to your state)",
                "Bodily Injury - Aggregate - $50,000.00 (specific to your state)",
                "Property Damage - $25,000.00 (specific to your state)",
              ]}
              bundled
            />
            <CoverageCard
              Icon={ShieldCheck}
              name="Supplemental Liability Insurance"
              short="SLI"
              sub={<p className="fi-sub">Click to add coverage</p>}
              tagline="Coverage is in Excess of Any Primary Liability Coverage"
              description="Supplements RCLI coverage to enhanced levels of coverage. Not a standalone or primary policy, must be purchased with RCLI."
              deductible="No Deductible"
              noDeductible
              max="Up to $500,000"
              features={[
                "Bodily Injury - Per Person - Up to $100,000 in total",
                "Bodily Injury - Aggregate - Up to $500,000 in total",
                "Property Damage - $10,000 additional coverage",
              ]}
            />
            <CoverageCard
              Icon={Users}
              name="Personal Accident / Personal Effects Insurance"
              short="PAI"
              sub={<p className="fi-sub">Click to add coverage</p>}
              tagline="Accident, Medical & Personal Effects Insurance"
              description="Covers life, medical expenses, and lost or damaged items. Not rental vehicle coverage."
              deductible="$25 Personal Effects Deductible"
              max="Up to $50,000"
              features={[
                "Renter Loss of Life - $50,000",
                "Passenger Loss of Life - $5,000",
                "Accidental Medical Expense - $1,000",
                "Personal Effects Coverage - $500 with up to $25 deductible will be applied",
              ]}
            />
          </div>

          {/* Premium Summary */}
          <div className="fi-prem">
            <div className="fi-premh">
              <span className="fi-premic">
                <ShieldCheck />
              </span>
              <div>
                <h4>Total Insurance Premium</h4>
                <p>2 coverages selected</p>
              </div>
            </div>
            <div className="fi-premv">
              <div>$80.70</div>
              <p>One-time payment</p>
            </div>
            <div className="fi-premb">
              <div>
                <span>CDW + RCLI:</span>
                <span>$80.70</span>
              </div>
            </div>
          </div>

          <div className="fi-skiprow">
            <span className="fb-ghost">
              <X className="mr" />
              Skip Insurance
            </span>
          </div>

          <div className="fi-disc">
            <p className="fi-dh">Insurance Disclosure</p>
            <p>
              By purchasing coverage through this site, you acknowledge that Pablow Inc. dba Bonzah.com
              (&quot;Bonzah&quot;) is the licensed broker of record and offers insurance coverage through various
              insurance carriers. The specific carrier issuing your policy will be identified at the time of purchase
              and in your policy documents.
            </p>
            <p>
              Coverage may include Collision Damage Waiver (CDW/LDW), Rental Car Liability Insurance (RCLI), and
              Supplemental Liability Insurance (SLI) as offered. Coverage excludes medical payments (MedPay), Personal
              Injury Protection (PIP), Underinsured Motorist (UIM), and Uninsured Motorist (UM) coverage where
              permitted by law. Full terms, conditions, limits, and exclusions are set forth in the policy documents
              provided at the time of purchase.
            </p>
          </div>
        </div>
        <div className="fi-navs">
          <span className="fb-ob lg">
            <ChevronLeft className="mr" /> Go Back
          </span>
          <span className="fb-pb lg">
            Continue to Details <ChevronRight className="ml" />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — on to Your Details, insurance address pre-filled            */
/* ------------------------------------------------------------------ */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fb-field">
      <span className="fb-lab">{label}</span>
      {children}
    </div>
  );
}

function Sel({ value }: { value: string }) {
  return (
    <span className="fi-sel">
      <span>{value}</span>
      <ChevronDown />
    </span>
  );
}

function Details() {
  return (
    <div className="fb-s8">
      <StepHead title="Your Details" />
      <div className="fb-s8">
        <div className="fb-g4">
          <Field label="Full Name *">
            <span className="fb-in h12">Daniel Reyes</span>
          </Field>
          <Field label="Email Address *">
            <span className="fb-in h12">daniel.reyes@example.com</span>
          </Field>
        </div>
        <Field label="Phone Number *">
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
        </Field>
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

        <div className="fi-addr">
          <h4>
            Address Information
            <span>(Required for insurance)</span>
          </h4>
          <div className="fi-s4">
            <Field label="Street Address *">
              <span className="fb-in h12">48 Pine Ave</span>
            </Field>
            <div className="fi-s4">
              <Field label="City *">
                <span className="fb-in h12">Long Beach</span>
              </Field>
              <Field label="State *">
                <Sel value="California" />
              </Field>
              <Field label="ZIP Code *">
                <span className="fb-in h12">90802</span>
              </Field>
            </div>
            <div className="fi-s4 pt4">
              <Field label="Driver's License Number *">
                <span className="fb-in h12">D4521873</span>
              </Field>
              <Field label="License State *">
                <Sel value="California" />
              </Field>
            </div>
          </div>
        </div>

        <Field label="Date of Birth *">
          <div className="fi-dob">
            <Sel value="Mar" />
            <Sel value="14" />
            <Sel value="1991" />
          </div>
          <p className="fb-age">
            Age: <span>35 years old</span>
          </p>
          <p className="fb-xs fb-mfg">Driver must be at least 18 years old</p>
        </Field>

        <div className="fb-idv">
          <h4>
            Identity Verification <span className="fb-red">*</span>
          </h4>
          <p className="fb-req">
            <strong>Required:</strong> To ensure security and compliance, all customers must complete identity
            verification before proceeding with their rental.
          </p>
          <div className="fi-vreq">
            <AlertCircle />
            <div>
              <p className="fi-vt">Verification Required</p>
              <p className="fb-xs fb-mfg">
                <strong>You must verify your identity to continue.</strong> Please fill in your details above, then
                click the button below to start the verification process.
              </p>
              <span className="fi-start">
                <FileCheck className="mr" />
                <span>Start Identity Verification</span>
              </span>
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
    <FlowPhone step={step} className="fi">
      {step === 0 ? (
        <BookingPage title="Insurance Verification" current={3} from={0} to={839}>
          <Choice />
        </BookingPage>
      ) : step === 1 ? (
        <BookingPage title="Insurance Verification" current={3} from={700} to={2394} delay={1500} dur={1400}>
          <Selector />
        </BookingPage>
      ) : (
        <BookingPage title="Your Details" current={4} from={0} to={724}>
          <Details />
        </BookingPage>
      )}
    </FlowPhone>
  );
}

export const FLOW_INSURANCE: Flow = {
  id: "insurance",
  title: "Add insurance",
  blurb: "Cover for the trip, bought in the same booking",
  note: "With Bonzah switched on in Integrations",
  steps: [
    { caption: "They say they need cover and tap Get Insurance Now.", ms: 3000 },
    { caption: "They switch on the cover they want and see the price straight away.", ms: 3400 },
    { caption: "They carry on to their details, with the address for the policy already filled in.", ms: 3000 },
  ],
  Screen,
};
