import {
  Bell,
  Car,
  CheckCircle,
  Clock,
  Download,
  Eye,
  FileCheck,
  FileText,
  Megaphone,
  MessageCircle,
  PanelLeft,
  PenLine,
  RefreshCw,
  Sun,
} from "lucide-react";
import { HiwStatus } from "./hiw-status";
import "./phone-sign.css";

/* ===================================================================== *
 * "How it works" step 2 — the agreement, on the renter's phone (390 × 820).
 *
 * How a renter really signs (every tenant but northwind):
 *   - At checkout, the invoice dialog's "Continue to Sign Agreement"
 *     (components/InvoiceDialog.tsx) runs BookingCheckoutStep's
 *     handleSendDocuSign → POST /api/esign (app/api/esign/route.ts), which
 *     creates the BoldSign document with DisableEmails, fetches BoldSign's
 *     embedded sign link and calls the send-signing-email edge function: our
 *     own email "Rental Agreement Ready to Sign" with a "Review and Sign"
 *     button to that link. (Enquiry tenants: the operator sends it later.)
 *   - The signing page itself is BoldSign's — a third party's UI, so it is
 *     NOT drawn here. The portal's "Sign" button opens the same BoldSign page
 *     in a dialog iframe.
 *   - boldsign-webhook maps BoldSign's events onto document_status
 *     (Completed → 'completed'), and stores the signed PDF.
 * So what our product shows the renter is the ORIGINAL customer portal's
 * Agreements page — app/(legacy)/(customer-portal)/portal/agreements/page.tsx
 * — going from "Awaiting Signature" to "Completed" when it refetches
 * (Refresh, or useCustomerAgreements' poll while one is unsigned), with
 * Signed Document, the Signed: date, and View / Download.
 *
 * Mobile layout at 390px (no sm:/md: classes apply):
 *   layout.tsx SidebarInset → CustomerPortalHeader (h-16 border-b px-4;
 *   sidebar is an off-canvas sheet on mobile; state stays 'expanded' so the
 *   company name is not repeated; name/email hidden md) → <main p-4>;
 *   page space-y-4; header flex-col gap-3, h1 text-xl, Refresh w-full;
 *   stats grid-cols-2 gap-3, "Total Agreements" col-span-2, cards p-3,
 *   CardTitle text-xs, value text-xl; AgreementCard p-3 gap-3, icon tile
 *   w-10 h-10, h3 text-sm, details text-xs grid-cols-2 gap-x-3.
 *   TraxChatButton fixed bottom-6 right-6 h-14 w-14.
 * Tokens: the new-signup palette through useDynamicTheme's dark branch
 * (see renter-portal.css) — --primary #6366F1, page #0B1120; --secondary is
 * dark_secondary_color #334155 (buildTenantPalette). Dates use the page's
 * 'MMM d, yyyy'. Demo renter, cars and refs match renter-portal.tsx.
 * ===================================================================== */

/** Length of the in-screen animation, ms. Handover holds the step this long. */
export const SIGN_MS = 2000;

function Stat({ title, Icon, from, to, desc, wide }: {
  title: string;
  Icon: typeof FileText;
  from: string;
  to: string;
  desc?: string;
  wide?: boolean;
}) {
  return (
    <div className={`hs-card hs-stat${wide ? " hs-wide" : ""}`}>
      <div className="hs-sh">
        <h3>{title}</h3>
        <Icon />
      </div>
      <div className="hs-sc">
        <div className="hs-v hs-swap">
          {from === to ? (
            <span>{to}</span>
          ) : (
            <>
              <span className="hs-was">{from}</span>
              <span className="hs-now">{to}</span>
            </>
          )}
        </div>
        {desc ? <p>{desc}</p> : null}
      </div>
    </div>
  );
}

export function PhoneSignScreen({ on }: { on: boolean }) {
  return (
    <div className={`hiw-s${on ? " is-on" : ""}`} aria-hidden={!on}>
      <HiwStatus />
      <div className="hs-page">
        {/* CustomerPortalHeader */}
        <header className="hs-hd">
          <span className="hs-trig">
            <PanelLeft />
          </span>
          <span className="hs-sep" />
          <span className="hs-fill" />
          <span className="hs-ib">
            <Bell />
          </span>
          <span className="hs-ib">
            <Megaphone />
          </span>
          <span className="hs-tt">
            <Sun />
          </span>
          <span className="hs-prof">
            <span className="hs-av">DR</span>
          </span>
        </header>

        <main className="hs-main">
          <div className="hs-ph">
            <div>
              <h1>My Agreements</h1>
              <p>View and download your rental agreements</p>
            </div>
            <span className="hs-refresh">
              <RefreshCw />
              Refresh
            </span>
          </div>

          <div className="hs-stats">
            <Stat title="Total Agreements" Icon={FileText} from="4" to="4" wide />
            <Stat title="Signed" Icon={CheckCircle} from="3" to="4" desc="Completed agreements" />
            <Stat title="Pending" Icon={Clock} from="1" to="0" desc="Awaiting your signature" />
          </div>

          <div>
            <h2 className="hs-h2">Rental Agreements</h2>
            <div className="hs-list">
              {/* the new booking: Awaiting Signature → Completed */}
              <div className="hs-card hs-agr">
                <span className="hs-tile">
                  <FileText />
                </span>
                <div className="hs-body">
                  <div className="hs-titles">
                    <div className="hs-min">
                      <h3>
                        <span>Rental Agreement</span>
                        <span className="hs-num">#R-3fa0d2</span>
                      </h3>
                      <p className="hs-veh">
                        <Car />
                        <span>Hyundai Sonata (9LMV284)</span>
                      </p>
                    </div>
                    <span className="hs-swap hs-self">
                      <span className="hs-badge hs-sec hs-was">
                        <Clock />
                        Awaiting Signature
                      </span>
                      <span className="hs-badge hs-def hs-now">
                        <CheckCircle />
                        Completed
                      </span>
                    </span>
                  </div>
                  <div className="hs-dl">
                    <div>
                      <span>Start Date:</span> Nov 7, 2026
                    </div>
                    <div>
                      <span>End Date:</span> Nov 10, 2026
                    </div>
                    <div>
                      <span>Sent:</span> Oct 19, 2026
                    </div>
                    <div className="hs-now">
                      <span>Signed:</span> Oct 20, 2026
                    </div>
                  </div>
                  <div className="hs-foot">
                    <span className="hs-swap">
                      <span className="hs-badge hs-out hs-yel hs-was">
                        <Clock />
                        Awaiting Signature
                      </span>
                      <span className="hs-badge hs-out hs-grn hs-now">
                        <FileCheck />
                        Signed Document
                      </span>
                    </span>
                    <span className="hs-acts">
                      <span className="hs-signbtn hs-was">
                        <PenLine />
                        Sign
                      </span>
                      <span className="hs-gh">
                        <Eye />
                      </span>
                      <span className="hs-gh">
                        <Download />
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* the current rental, signed a week ago */}
              <div className="hs-card hs-agr">
                <span className="hs-tile">
                  <FileText />
                </span>
                <div className="hs-body">
                  <div className="hs-titles">
                    <div className="hs-min">
                      <h3>
                        <span>Rental Agreement</span>
                        <span className="hs-num">#R-7c41e9</span>
                      </h3>
                      <p className="hs-veh">
                        <Car />
                        <span>Genesis GV80 (8KTR512)</span>
                      </p>
                    </div>
                    <span className="hs-badge hs-def hs-self">
                      <CheckCircle />
                      Completed
                    </span>
                  </div>
                  <div className="hs-dl">
                    <div>
                      <span>Start Date:</span> Oct 18, 2026
                    </div>
                    <div>
                      <span>End Date:</span> Oct 25, 2026
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* TraxChatWidget → TraxChatButton */}
        <span className="hs-trax">
          <MessageCircle />
        </span>
      </div>
    </div>
  );
}
