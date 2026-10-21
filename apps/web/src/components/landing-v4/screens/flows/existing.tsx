import { PhoneVerifyScreen } from "../phone-verify";
import { PhoneSignScreen } from "../phone-sign";
import { PhoneKeysScreen } from "../phone-keys";
import type { Flow } from "./types";
import "./existing.css";

/*
 * The three phone screens the old "How pickup works" played (phone-verify,
 * phone-sign, phone-keys — see their headers for the source files mirrored),
 * as flows. Each screen runs its own timed animation, so the flow mounts it
 * once and lets it play, slowed down (existing.css) so every phase of it gets
 * its own step and caption. The step lengths follow the animation's phases.
 */

// phone-verify phases: front of ID 0–33%, selfie 33–58%, processing 58–77%, verified 77–100%
const VERIFY_T = 9600;
export const FLOW_VERIFY: Flow = {
  id: "verify",
  title: "Verify their ID",
  blurb: "Licence and selfie, checked before the keys",
  steps: [
    { caption: "They scan the front of their licence with the phone's camera.", ms: VERIFY_T * 0.33 },
    { caption: "They take a selfie, so the face can be matched to the ID.", ms: VERIFY_T * 0.25 },
    { caption: "The licence and the selfie are checked against each other.", ms: VERIFY_T * 0.19 },
    { caption: "Verified. Anything unclear comes to you to review instead.", ms: VERIFY_T * 0.23 },
  ],
  Screen: () => (
    <div className="fl-x fl-x-verify">
      <PhoneVerifyScreen on />
    </div>
  ),
};

// phone-sign: the agreement waits for a signature until 55%, then shows as signed
const SIGN_T = 6400;
export const FLOW_SIGN: Flow = {
  id: "sign",
  title: "Sign the agreement",
  blurb: "E-signature on their phone, by BoldSign",
  steps: [
    { caption: "The rental agreement is in their account, waiting for a signature.", ms: SIGN_T * 0.55 },
    { caption: "Once they sign, it's marked Completed and they can download it.", ms: SIGN_T * 0.45 },
  ],
  Screen: () => (
    <div className="fl-x fl-x-sign">
      <PhoneSignScreen on />
    </div>
  ),
};

// phone-keys: the text arrives 4–40%, then sits in the thread
const KEYS_T = 5600;
export const FLOW_KEYS: Flow = {
  id: "keys",
  title: "Get the key code",
  blurb: "By text from your Twilio number",
  note: "If you use a lockbox",
  steps: [
    { caption: "When you hand the car over by lockbox, the code arrives by text.", ms: KEYS_T * 0.4 },
    { caption: "It says which car it is and where. They collect the keys themselves.", ms: KEYS_T * 0.6 },
  ],
  Screen: () => (
    <div className="fl-x fl-x-keys">
      <PhoneKeysScreen on />
    </div>
  ),
};
