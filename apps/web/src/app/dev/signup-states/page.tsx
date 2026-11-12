import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchSignupPlans } from "@/lib/plans-server";
import { MOCK_DONE_TOKENS, MOCK_LINK_TOKENS } from "@/lib/subscribe-link-mock";

/**
 * Every screen of the self-serve signup, one link each — the script for
 * recording the signup Supercut on localhost.
 *
 * Every link opens the landing page in MOCK mode (components/onboarding/
 * mock-signup.ts): the real screens, nothing real behind them. No user, tenant,
 * Stripe customer or charge is created. `?scenario=` picks a failure, `?at=`
 * starts part-way through, `?carry=` arrives with a code, `?plan=` opens the
 * signup on that plan, and `?mock=reset` makes every link a fresh start.
 *
 * DEVELOPMENT ONLY, DEV-BRANCH-FIRST (see app/signup-preview/page.tsx for why
 * the order matters): in a production build the branch folds away and the
 * route is a 404.
 */

export const metadata: Metadata = {
  title: "Signup states (dev)",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const IS_DEV = process.env.NODE_ENV === "development";

type Item = {
  name: string;
  /** What to do once the link is open. Omitted when the link lands on it. */
  steps?: string;
  /** Link options. */
  at?: "payment" | "build" | "done" | "recover";
  scenario?: string;
  carry?: string;
  /** Extra links: label -> options. */
  more?: Array<{ label: string; at?: Item["at"]; scenario?: string; carry?: string }>;
  /** A plain href instead of a signup link (pay-by-link pages). */
  href?: string;
};

type Group = { title: string; intro?: string; items: Item[] };

const FILL_YOU = "Name: Jordan Miller, email: anything@yourcompany.com, Continue.";
const FILL_PASSWORD = "Password: drive247test1 (twice), Continue.";
const FILL_BUSINESS = "Business: Harbor Car Rentals (address fills itself), tick the terms, Continue.";
const TO_CODE = `${FILL_YOU} ${FILL_PASSWORD} ${FILL_BUSINESS}`;
const TO_CARD = `${TO_CODE} Code: 123456.`;
const CARD = "Card 4242 4242 4242 4242, any future expiry (12/34), any CVC (123), any ZIP.";

const GROUPS: Group[] = [
  {
    title: "1 · Plan",
    items: [
      { name: "Pricing cards, before a plan is picked", href: "/?landing=v1&mock=reset#pricing" },
      { name: "Signup opens on a plan (account page 1: You)" },
    ],
  },
  {
    title: "2 · Account",
    intro: "Three short pages: You, Password, Your business.",
    items: [
      { name: "Page 1 · You, with Google / Apple buttons" },
      { name: "Email invalid", steps: "Type jordan@ in email, Continue." },
      { name: "Email disposable (checked in the browser)", steps: "Type jordan@mailinator.com, Continue." },
      { name: "Page 2 · Password", steps: FILL_YOU },
      { name: "Password too weak", steps: `${FILL_YOU} Password: short, Continue.` },
      { name: "Passwords don't match", steps: `${FILL_YOU} Password drive247test1, confirm drive247test2, Continue.` },
      { name: "Page 3 · Your business, address available", steps: `${FILL_YOU} ${FILL_PASSWORD} Type Harbor Car Rentals.` },
      { name: "Web address taken (live check, with suggestions)", steps: `${FILL_YOU} ${FILL_PASSWORD} Web address: northwind.` },
      { name: "Web address reserved", steps: `${FILL_YOU} ${FILL_PASSWORD} Web address: admin.` },
      { name: "Web address invalid", steps: `${FILL_YOU} ${FILL_PASSWORD} Web address: 1rentals.` },
      { name: "Terms not ticked (Continue to payment stays off)", steps: `${FILL_YOU} ${FILL_PASSWORD} Type Harbor Car Rentals, leave the box unticked.` },
      {
        name: "Email already has an account → Sign in panel",
        scenario: "email-exists",
        steps: `${TO_CODE} The sign-in panel appears. A password containing "wrong" shows the wrong-password message; any other password signs in and goes on to the card.`,
      },
      {
        name: "Forgot password (reset panel: ask for a code, then code + new password)",
        scenario: "email-exists",
        steps: `${TO_CODE} On the sign-in panel press Forgot password, Send code. Code 111111 shows "code not valid"; any other 6 digits + a new password updates it.`,
      },
      {
        name: "Email started signing up but never confirmed → straight to the code screen",
        scenario: "email-unverified",
        steps: TO_CODE,
      },
      { name: "Server refuses a disposable email", scenario: "email-disposable", steps: TO_CODE },
      { name: "Web address taken a moment ago (on submit)", scenario: "begin-slug-taken", steps: TO_CODE },
      { name: "Too many attempts (rate limited)", scenario: "begin-rate-limited", steps: TO_CODE },
      { name: "No connection", scenario: "begin-network", steps: TO_CODE },
      {
        name: "Google return → 'One last thing' (business name + address)",
        steps: "Press Continue with Google. It comes straight back signed in and asks for the business.",
      },
    ],
  },
  {
    title: "3 · Email code",
    items: [
      { name: "Code screen", steps: TO_CODE },
      { name: "Wrong code (attempts left)", steps: `${TO_CODE} Code: 111111.` },
      { name: "Expired code", steps: `${TO_CODE} Code: 222222.` },
      { name: "Locked after too many tries", steps: `${TO_CODE} Code: 333333.` },
      { name: "Resend code (countdown)", steps: `${TO_CODE} Press Resend.` },
    ],
  },
  {
    title: "4 · Payment",
    intro: `Test card: ${CARD} The card form is Stripe's real one in test mode; nothing is charged.`,
    items: [
      { name: "Card step, free trial ($0 today, timeline)", steps: TO_CARD, more: [{ label: "jump straight there", at: "payment" }] },
      { name: "Card step, no trial (charged today)", scenario: "pay-today", steps: TO_CARD, more: [{ label: "jump straight there", at: "payment", scenario: "pay-today" }] },
      { name: "Resumed banner (came back to an unfinished signup)", at: "payment" },
      {
        name: "Card field errors: number, expiry date in the past, security code",
        at: "payment",
        steps: "Type 4242 4242 4242 4241 (bad number); expiry 01/20 (past); CVC 1 (too short). Press Start trial to see each message.",
      },
      { name: "Finish later? (closing on the card step asks first)", at: "payment", steps: "Press the X at the top right." },
      { name: "Submitting (spinner on the button)", at: "payment", steps: `${CARD} Press Start trial.` },
      { name: "Card declined", at: "payment", scenario: "card-declined", steps: `${CARD} Press Start trial.` },
      { name: "Bank check (3-D Secure) failed", at: "payment", scenario: "card-auth-failed", steps: `${CARD} Press Start trial.` },
      { name: "Stripe unreachable on submit", at: "payment", scenario: "card-stripe-down", steps: `${CARD} Press Start trial.` },
      { name: "Card form can't be prepared (Stripe unavailable)", at: "payment", scenario: "intent-fail" },
      { name: "Card form can't be prepared (no connection)", at: "payment", scenario: "intent-network" },
      { name: "Session expired on the card step", at: "payment", scenario: "session-lost" },
    ],
  },
  {
    title: "5 · Promo and referral codes",
    intro:
      "All on the card step. Type the code in 'Promo or referral code' and press Apply. Each opens on the free trial; the 'charged today' link shows the discounted first bill instead.",
    items: [
      { name: "Empty code box", at: "payment" },
      { name: "SAVE20 · 20% off for your first 3 months", at: "payment", steps: "Apply SAVE20.", more: [{ label: "charged today", at: "payment", scenario: "pay-today" }] },
      { name: "SAVE15 · 15% off for your first 2 months", at: "payment", steps: "Apply SAVE15.", more: [{ label: "charged today", at: "payment", scenario: "pay-today" }] },
      { name: "HALFOFF · 50% off your first bill", at: "payment", steps: "Apply HALFOFF.", more: [{ label: "charged today", at: "payment", scenario: "pay-today" }] },
      { name: "FLAT50 · $50 off your first bill", at: "payment", steps: "Apply FLAT50.", more: [{ label: "charged today", at: "payment", scenario: "pay-today" }] },
      { name: "FOREVER10 · 10% off every bill", at: "payment", steps: "Apply FOREVER10.", more: [{ label: "charged today", at: "payment", scenario: "pay-today" }] },
      { name: "FREEMONTH · 100% off your first bill", at: "payment", steps: "Apply FREEMONTH.", more: [{ label: "charged today", at: "payment", scenario: "pay-today" }] },
      { name: "REF-SUNSET · referral from Sunset Rentals (named)", at: "payment", steps: "Apply REF-SUNSET." },
      { name: "REF-PRIVATE · referral, referrer not named", at: "payment", steps: "Apply REF-PRIVATE." },
      { name: "Arrived by referral link (code already applied)", at: "payment", carry: "REF-SUNSET", more: [{ label: "charged today", at: "payment", carry: "REF-SUNSET", scenario: "pay-today" }] },
      { name: "Replace one code with another", at: "payment", steps: "Apply SAVE20, then type FLAT50 and Apply: 'SAVE20 was replaced'." },
      { name: "Remove a code", at: "payment", steps: "Apply SAVE20, then Remove." },
      { name: "Arrived with a code that's no longer valid (full-price notice)", at: "payment", carry: "EXPIRED" },
      { name: "Refused: not recognised", at: "payment", steps: "Apply NOSUCHCODE." },
      { name: "Refused: expired", at: "payment", steps: "Apply EXPIRED." },
      { name: "Refused: used up", at: "payment", steps: "Apply MAXEDOUT." },
      { name: "Refused: no longer active", at: "payment", steps: "Apply RETIRED." },
      { name: "Refused: not for this plan", at: "payment", steps: "Apply PLANONLY." },
      { name: "Refused: referrals paused", at: "payment", steps: "Apply REFPAUSED." },
      { name: "Refused: referrer's code switched off", at: "payment", steps: "Apply OWNEROFF." },
      { name: "Refused: your own referral code", at: "payment", steps: "Apply MYOWNCODE." },
      { name: "Refused: new subscriptions only", at: "payment", steps: "Apply NOTNEW." },
      { name: "Refused: already referred", at: "payment", steps: "Apply REFERRED." },
      { name: "Refused: one code per checkout", at: "payment", steps: "Apply ONECODE." },
      { name: "Refused: too many tries", at: "payment", steps: "Apply TOOMANY." },
      { name: "Refused: couldn't check just now", at: "payment", steps: "Apply LOOKUPDOWN." },
    ],
  },
  {
    title: "6 · Building the portal",
    intro: "Stops before the portal itself. The player bar under the build is a localhost-only rehearsal control.",
    items: [
      { name: "Build running (steps ticking)", at: "build", more: [{ label: "after paying", at: "payment" }] },
      { name: "Build failed → Try again", at: "build", scenario: "build-fail", steps: "Wait for the failure, then press Try again: it finishes." },
      { name: "Web address taken during the build → Edit details", at: "build", scenario: "build-slug-taken", steps: "Press Edit details, change the address, Try again." },
      { name: "No confirmed payment → back to the card with a banner", at: "build", scenario: "build-payment-required" },
      { name: "Build stuck ('taking longer than it should', after 90 seconds)", at: "build", scenario: "build-stall", steps: "Leave it open for 90 seconds." },
      { name: "Paid, but the business details were lost → 'One last thing'", at: "recover" },
      { name: "Done: You're live (portal and booking site)", at: "done" },
      { name: "Done, some pages still show default copy", at: "done", scenario: "done-unseeded" },
      { name: "Done, without the one-click sign-in link", at: "done", scenario: "done-no-link" },
    ],
  },
  {
    title: "7 · Pay by link (/subscribe)",
    intro:
      "The page a tenant opens from a payment link the team sends. On the active and trial links, the code SAVE20 applies 20% off and any other code is not recognised.",
    items: [
      ...MOCK_LINK_TOKENS.map((token) => ({
        name: `Link: ${token.replace(/^mock-/, "").replace(/-/g, " ")}`,
        href: `/subscribe/${token}`,
      })),
      ...MOCK_DONE_TOKENS.map((token) => ({
        name: `Done page after paying: ${token.replace(/^mock-/, "").replace(/-/g, " ")}`,
        href: `/subscribe/${token}/done?session_id=mock`,
      })),
    ],
  },
];

function signupHref(plan: string, o: { at?: string; scenario?: string; carry?: string }): string {
  const q = new URLSearchParams({ landing: "v1", mock: "reset", plan });
  if (o.scenario) q.set("scenario", o.scenario);
  if (o.at) q.set("at", o.at);
  if (o.carry) q.set("carry", o.carry);
  return `/?${q.toString()}`;
}

export default async function SignupStatesPage() {
  if (IS_DEV) {
    const plans = await fetchSignupPlans();
    const plan = plans.find((p) => p.highlighted)?.id ?? plans[0]?.id ?? "growth";
    let n = 0;

    return (
      <main className="ss">
        <style>{CSS}</style>
        <h1>Signup states</h1>
        <p className="ss-lead">
          Every screen from <b>Start free trial</b> up to the portal, in mock mode on localhost. Nothing real is
          created. Each link is a fresh start on the <b>{plans.find((p) => p.id === plan)?.name ?? plan}</b> plan
          ({plan}). Record on a phone-sized window too.
        </p>
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2>{g.title}</h2>
            {g.intro && <p className="ss-intro">{g.intro}</p>}
            <ol>
              {g.items.map((item) => {
                n += 1;
                const href = item.href ?? signupHref(plan, item);
                return (
                  <li key={item.name}>
                    <span className="ss-n">{String(n).padStart(2, "0")}</span>
                    <div>
                      <a href={href} target="_blank" rel="noreferrer">
                        {item.name}
                      </a>
                      {item.more?.map((m) => (
                        <a key={m.label} className="ss-more" href={signupHref(plan, m)} target="_blank" rel="noreferrer">
                          {m.label}
                        </a>
                      ))}
                      {item.steps && <p>{item.steps}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        <p className="ss-foot">
          Magic inputs: email code 111111 / 222222 / 333333 = wrong / expired / locked; a password containing
          &quot;wrong&quot; fails to sign in; reset code 111111 is refused. Add <code>&amp;scenario=none</code> to drop a
          scenario, <code>?mock=off</code> to use the real signup (careful: real accounts).
        </p>
      </main>
    );
  }
  notFound();
}

const CSS = `
.ss{max-width:760px;margin:0 auto;padding:40px 20px 80px;font:15px/1.5 system-ui,sans-serif;color:#18181b;background:#fff}
.ss h1{font-size:28px;margin:0 0 8px}
.ss h2{font-size:18px;margin:36px 0 6px;padding-top:16px;border-top:1px solid #e4e4e7}
.ss-lead,.ss-intro,.ss-foot{color:#52525b;margin:0 0 8px}
.ss-foot{margin-top:36px;font-size:13px}
.ss ol{list-style:none;padding:0;margin:8px 0 0}
.ss li{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f4f4f5}
.ss-n{flex:none;width:26px;color:#a1a1aa;font-variant-numeric:tabular-nums}
.ss a{color:#4f46e5;font-weight:500;text-decoration:none}
.ss a:hover{text-decoration:underline}
.ss-more{margin-left:10px;font-size:13px;font-weight:400!important}
.ss-more::before{content:"· ";color:#a1a1aa}
.ss li p{margin:2px 0 0;font-size:13px;color:#71717a}
.ss code{font-size:12px;background:#f4f4f5;padding:1px 4px;border-radius:4px}
`;
