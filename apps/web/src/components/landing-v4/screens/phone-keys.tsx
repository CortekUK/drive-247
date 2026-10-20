import { ArrowUp, ChevronLeft, MessageCircle, Plus, User } from "lucide-react";
import { HiwStatus } from "./hiw-status";
import "./phone-keys.css";

/* ===================================================================== *
 * "How it works" step 3 — the lockbox code arriving by text (390 × 820).
 *
 * The text is supabase/functions/notify-lockbox-code's built-in SMS, used
 * whenever the tenant has not saved its own SMS wording in lockbox_templates:
 *   `${tenantName}: Your lockbox code is ${lockboxCode}. Vehicle: ${vehicleName}
 *    (${vehicleReg}). Address: ${deliveryAddress}. Do not share this code.`
 * (tenantName = app_name || company_name; the "(reg)" part is dropped when
 * the tenant hides plates, "Address: …" when there is no delivery address.)
 * It goes out through the TENANT's own Twilio SMS number
 * (_shared/twilio-sms-client.ts, integration_twilio_sms), so the thread shows
 * a phone number, not a brand. It is sent when staff confirm the handover
 * with "Lockbox" in the portal (components/rentals/key-handover-section.tsx)
 * or by send-lockbox-scheduled at approved_at + lockbox_send_offset_minutes,
 * and only when the tenant's lockbox_notification_methods include "sms"
 * (the column default is ["email"]).
 *
 * The messaging app around it is the phone's own, kept plain and unbranded:
 * it is not our product, only where our text lands. The renter portal never
 * shows the code — this message is the only place the renter gets it.
 * Demo values match renter-portal.tsx (the Hyundai Sonata booking).
 * ===================================================================== */

/** Length of the in-screen animation, ms. Handover holds the step this long. */
export const KEYS_MS = 2000;

const FROM = "+1 (555) 010-0147";
const SMS =
  "Northwind Rentals: Your lockbox code is 4827. Vehicle: Hyundai Sonata (9LMV284). Address: 1200 Harbor Way, Long Beach, CA 90802. Do not share this code.";

export function PhoneKeysScreen({ on }: { on: boolean }) {
  return (
    <div className={`hiw-k${on ? " is-on" : ""}`} aria-hidden={!on}>
      <HiwStatus />
      <div className="hk-page">
        <div className="hk-head">
          <span className="hk-back">
            <ChevronLeft />
          </span>
          <span className="hk-who">
            <span className="hk-av">
              <User />
            </span>
            <b>{FROM}</b>
          </span>
        </div>

        <div className="hk-thread">
          <small className="hk-when">Text Message · Today 10:00</small>
          <div className="hk-bub">{SMS}</div>
        </div>

        <div className="hk-inp">
          <span className="hk-plus">
            <Plus />
          </span>
          <span className="hk-field">
            <span>Text Message</span>
            <span className="hk-send">
              <ArrowUp />
            </span>
          </span>
        </div>
      </div>

      {/* the arrival banner */}
      <div className="hk-note">
        <span className="hk-app">
          <MessageCircle />
        </span>
        <span className="hk-nt">
          <span className="hk-nh">
            <b>{FROM}</b>
            <small>now</small>
          </span>
          <span className="hk-nb">{SMS}</span>
        </span>
      </div>
    </div>
  );
}
