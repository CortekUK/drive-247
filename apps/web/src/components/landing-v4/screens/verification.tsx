import type { ComponentType, ReactNode } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Car,
  Clock,
  CreditCard,
  FileText,
  Gavel,
  IdCard,
  LayoutDashboard,
  MessageSquare,
  ShieldCheck,
  Star,
  User,
  UserCog,
} from "lucide-react";
import "./verification.css";

/* ===================================================================== *
 * Customer record → Verification, as a v2 tenant sees it in a 1280 × 800
 * window. Mirrors, file for file (apps/portal/src/...):
 *
 *   components/customers-v2/customer-detail/customer-detail-v2.tsx
 *       Frame (100svh − main's p-4), middle column with DOCK_CLEARANCE, and
 *       the overview column only from 1400px — so at 1280 it is absent and
 *       its "At a glance" view rides the RecordDock instead.
 *   components/shared/layout/app-sidebar-v2.tsx  (Customer Record Mode)
 *       the section rail REPLACES the app sidebar: h-16 "All customers"
 *       back link, name + email, three grouped section lists, empty footer
 *       for a customer in good standing.
 *   app/(dashboard)/layout.tsx
 *       TopBarV2 is dropped at md+ on this route (`isCustomerDetailV2`), so
 *       there is no top bar and <main> starts at its own 16px padding.
 *   components/customers-v2/customer-detail/sections.ts       groups, labels, icons
 *   components/customers-v2/customer-detail/section-verification.tsx
 *   components/customers-v2/customer-detail/kit.tsx            Panel, Section,
 *       Timeline, Segmented, Pill, Thumb, fmtDate
 *   components/ui-v2/record-dock.tsx       RecordDock (back + promoted centre)
 *   components/ui-v2/sidebar.tsx, badge.tsx; styles/v2-theme.css tokens
 *
 * The customer is the portal's own demo record
 * (app/playground/customer-detail-fake/_data.ts → demoCustomer): passed
 * 3 Mar 2026 at a 94% face match, all four images captured, CheckMyDriver
 * valid — so the provider switch shows and every timeline step is done.
 * Photos are stock (landing-v2/people); the licence images are drawn.
 * ===================================================================== */

type Icon = ComponentType<{ className?: string }>;

/** sections.ts → SECTION_GROUPS, verbatim. */
const GROUPS: [string, [string, Icon][]][] = [
  ["The person", [["Identity", User], ["Licence & driving", IdCard], ["Documents", FileText]]],
  ["Standing", [["Verification", ShieldCheck], ["Account", UserCog], ["Consent", MessageSquare]]],
  [
    "History",
    [["Rentals", Car], ["Money", CreditCard], ["Fines", Gavel], ["Reviews", Star], ["Activity", Clock]],
  ],
];

function CustomerRail() {
  return (
    <aside className="vr-rail">
      <div className="vr-rh">
        <span className="vr-back">
          <ArrowLeft />
          <span>All customers</span>
        </span>
      </div>
      <div className="vr-who">
        <h2>Marcus Adeyemi</h2>
        <p>marcus.adeyemi@gmail.com</p>
      </div>
      <div className="vr-groups">
        {GROUPS.map(([label, items], gi) => (
          <div key={label} className="vr-grp">
            {gi > 0 && <i className="vr-rule" />}
            <p className="vr-gl">{label}</p>
            <ul>
              {items.map(([l, I]) => (
                <li key={l} className={l === "Verification" ? "vr-on" : undefined}>
                  <I />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** A photo of the licence, front or back, as the provider's capture would show it. */
function LicencePhoto({ back }: { back?: boolean }) {
  return (
    <span className={`vr-lic${back ? " vr-back" : ""}`}>
      <span className="vr-card">
        {back ? (
          <>
            <span className="vr-strip" />
            <span className="vr-bars" />
            <span className="vr-ln vr-w1" />
            <span className="vr-ln vr-w2" />
          </>
        ) : (
          <>
            <span className="vr-top">
              <b>FLORIDA</b>
              <small>DRIVER LICENSE</small>
            </span>
            <span className="vr-body">
              <span className="vr-ph" />
              <span className="vr-txt">
                <span className="vr-ln vr-w1" />
                <span className="vr-ln vr-w2" />
                <span className="vr-ln vr-w3" />
                <span className="vr-ln vr-w2" />
              </span>
            </span>
          </>
        )}
      </span>
    </span>
  );
}

function Thumb({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="vr-thumb">
      <div className="vr-tb">{children}</div>
      <p>{caption}</p>
    </div>
  );
}

export function VerificationScreen() {
  const steps: [string, string | null][] = [
    ["Documents captured", "4 of 4 images"],
    ["Sent to the provider", null],
    ["Verdict issued", "Mar 3, 2026"],
    ["Licence checked with the issuing state", "Mar 3, 2026"],
  ];
  return (
    <div className="scr-ver wash">
      <CustomerRail />

      <div className="vr-main">
        <div className="vr-frame">
          <div className="vr-mid">
            <div className="vr-panel">
              <div className="vr-ph-head">
                <h2>Verification</h2>
                <p>Whether this person is who they say they are. Produced from the record — never typed in here.</p>
              </div>

              <div className="vr-pb">
                <p className="vr-chk">
                  <ShieldCheck />
                  Checked against
                  <em>Identity</em>
                  <span>and</span>
                  <em>Licence &amp; driving</em>
                </p>

                <section className="vr-surf">
                  <div className="vr-verdict">
                    <span className="vr-vt">
                      <BadgeCheck />
                    </span>
                    <div className="vr-vx">
                      <p className="vr-w">Verified</p>
                      <p className="vr-s">Passed Mar 3, 2026 against licence A412-9930-XX.</p>
                    </div>
                    <div className="vr-fm">
                      <p>94%</p>
                      <small>face match</small>
                    </div>
                  </div>
                  <ol className="vr-tl">
                    {steps.map(([l, at]) => (
                      <li key={l}>
                        <span className="vr-dot" />
                        <p>{l}</p>
                        {at && <small>{at}</small>}
                      </li>
                    ))}
                  </ol>
                </section>

                <div className="vr-prov">
                  <div className="vr-seg">
                    <span className="vr-on">
                      Document &amp; selfie<i className="vr-pill">Passed</i>
                    </span>
                    <span>
                      CheckMyDriver<i className="vr-pill">Valid</i>
                    </span>
                  </div>
                  <p>Two checks, two verdicts.</p>
                </div>

                <section className="vr-surf">
                  <div className="vr-sh">
                    <h3>What the provider captured</h3>
                    <p>Its own evidence, at the moment it decided. These cannot be replaced from the Documents panel.</p>
                  </div>
                  <div className="vr-thumbs">
                    <Thumb caption="Face">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="vr-face" src="/landing-v3/avatars/a2.webp" alt="" />
                    </Thumb>
                    <Thumb caption="Selfie">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/landing-v2/people/person-1.jpg" alt="" />
                    </Thumb>
                    <Thumb caption="Licence front">
                      <LicencePhoto />
                    </Thumb>
                    <Thumb caption="Licence back">
                      <LicencePhoto back />
                    </Thumb>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RecordDock at 1280: the rail fits, so no `primary`; the overview does
          not, so its one view ("At a glance") is promoted into the circle. */}
      <div className="vr-dock">
        <nav>
          <div className="vr-fl vr-l">
            <span className="vr-ib">
              <ArrowLeft />
            </span>
          </div>
          <span className="vr-ctr">
            <LayoutDashboard />
          </span>
          <div className="vr-fl vr-r" />
        </nav>
      </div>
    </div>
  );
}
