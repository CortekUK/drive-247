import { ArrowLeft, CheckCircle, Shield, Sparkles, Upload } from "lucide-react";
import { HiwStatus } from "./hiw-status";
import "./phone-verify.css";

/* ===================================================================== *
 * "How it works" step 1 — the renter's ID check, on their phone (390 × 820).
 *
 * The real page is apps/booking/src/app/(legacy)/verify/[token]/page.tsx.
 * The renter reaches it from the booking checkout: MultiStepBookingWidget's
 * "Start Identity Verification" calls create-ai-verification-session, which
 * returns `${BOOKING_APP_URL || https://{slug}.drive-247.com}/verify/{token}`,
 * and AIVerificationQR.tsx shows it as a QR code ("Scan with your phone",
 * plus "Can't scan? Click for manual link"). It is a plain web page in the
 * phone's browser: getUserMedia camera, nothing to install.
 *
 * This page does not use tenant colours: it is black, with the tenant's logo
 * top right or, with no logo uploaded (a new signup), a white/60 Shield.
 * h1/h2 are Playfair Display (app/(legacy)/globals.css: h1–h6 font-display).
 *
 * The animation plays the page's own states in order, ~2.4s in all:
 *   'document-front' (step 1/3, corner brackets + the 2s scan line) → capture
 *   'selfie'         (step 3/3, w-56 h-72 face oval + Sparkles)      → capture
 *   'processing'     ("Verifying Identity", last message "Verifying your identity...")
 *   'success'        ("Verified!", "Verified As" from the OCR'd name)
 * 'document-back' (optional — "Skip this step") and the per-shot
 * Retake / Continue preview are passed over to keep it short.
 * The licence and the face are drawn shapes, not a real document or person.
 * ===================================================================== */

/** Length of the in-screen animation, ms. Handover holds the step this long. */
export const VERIFY_MS = 2400;

function Capture({ step }: { step: "front" | "selfie" }) {
  const front = step === "front";
  return (
    <div className={`hv-scene hv-${step}`}>
      <div className={`hv-feed${front ? "" : " hv-feed-self"}`}>
        {front ? (
          <span className="hv-lic">
            <span className="hv-lic-top">DRIVER LICENSE</span>
            <span className="hv-lic-ph" />
            <span className="hv-lic-ln">
              <i />
              <i />
              <i />
              <i />
            </span>
          </span>
        ) : (
          <span className="hv-face" />
        )}
      </div>

      {/* Overlay guides */}
      {front ? (
        <>
          <div className="hv-corners">
            <i className="hv-c hv-tl" />
            <i className="hv-c hv-tr" />
            <i className="hv-c hv-bl" />
            <i className="hv-c hv-br" />
          </div>
          <div className="hv-scanbox">
            <i className="hv-scan" />
          </div>
        </>
      ) : (
        <div className="hv-oval-wrap">
          <span className="hv-oval" />
          <Sparkles className="hv-spark" />
        </div>
      )}

      {/* Header: back (not on the first step), step indicator, tenant branding */}
      <div className="hv-top">
        {front ? (
          <span className="hv-w10" />
        ) : (
          <span className="hv-back">
            <ArrowLeft />
          </span>
        )}
        <span className="hv-bars">
          {front ? (
            <>
              <i className="hv-cur" />
              <i />
              <i />
            </>
          ) : (
            <>
              <i className="hv-done" />
              <i className="hv-done" />
              <i className="hv-cur" />
            </>
          )}
        </span>
        <span className="hv-brand">
          <Shield />
        </span>
      </div>

      {/* Bottom controls */}
      <div className="hv-bot">
        <div className="hv-info">
          <h2>{front ? "Front of ID" : "Take a Selfie"}</h2>
          <span>{front ? "Position your ID document in the frame" : "Position your face in the circle"}</span>
        </div>
        <span className="hv-shutter">
          <i />
        </span>
        <span className="hv-gal">
          <Upload />
          Upload from gallery
        </span>
      </div>

      <span className="hv-flash" />
    </div>
  );
}

export function PhoneVerifyScreen({ on }: { on: boolean }) {
  return (
    <div className={`hiw-v${on ? " is-on" : ""}`} aria-hidden={!on}>
      <HiwStatus />
      <div className="hv-page">
        <Capture step="front" />
        <Capture step="selfie" />

        {/* Processing state */}
        <div className="hv-scene hv-proc">
          <div className="hv-mid">
            <div className="hv-ring">
              <i />
              <i className="hv-spin" />
              <Shield />
            </div>
            <h1>Verifying Identity</h1>
            <p>Verifying your identity...</p>
          </div>
        </div>

        {/* Success state */}
        <div className="hv-scene hv-ok">
          <div className="hv-mid">
            {/* text-center max-w-sm: shrink-to-fit, so the card is as wide as the widest line */}
            <div className="hv-max">
            <div className="hv-okc">
              <CheckCircle />
            </div>
            <h1 className="hv-big">Verified!</h1>
            <p className="hv-okp">Your identity has been successfully verified.</p>
            <div className="hv-as">
              <small>Verified As</small>
              <b>Daniel Reyes</b>
            </div>
            <p className="hv-close">You can close this window now.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
