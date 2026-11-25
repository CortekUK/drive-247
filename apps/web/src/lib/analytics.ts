/**
 * PostHog (product analytics), browser side.
 *
 * The key below is PostHog's public project key, made to sit in a page (like
 * the Meta pixel id), so it is not a secret. The project lives on PostHog
 * US Cloud. It runs on the built site only, never on a dev server, so
 * local work does not pollute the numbers. NEXT_PUBLIC_POSTHOG_KEY overrides
 * it (and switches it on in dev, to test).
 *
 * The loader below (app/layout.tsx puts it in the head) records page views and
 * clicks by itself. The functions here add the named signup steps, so the path
 * from "opened signup" to "trial started" can be read as one funnel.
 *
 * `capture_exceptions` sends uncaught errors and promise rejections to PostHog
 * Error tracking. Without it the project only had console lines inside session
 * replays, which cannot be grouped, counted or alerted on.
 *
 * Nothing typed into a field is sent: PostHog never records input values, and
 * the card form is Stripe's own frame, which no script on this page can read.
 * The signup answers sent on purpose are `heard_about` and `fleet_size`,
 * values from fixed lists, and `city_state` ("Houston, TX"), a place rather
 * than a person. A person is known by their account id only, never by email.
 *
 * Browser-only, and never throws: analytics must not be able to break signup.
 */

const PROJECT_KEY = "phc_Awdcd3XPWYYVKWg93Y39435RtvYFxLfNTYaf9r9r5LPi";

export const POSTHOG_KEY =
  process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() || (process.env.NODE_ENV === "production" ? PROJECT_KEY : "");
export const POSTHOG_HOST = "https://us.i.posthog.com";

/** PostHog's standard loader: a queue that fills until their script arrives. */
export const POSTHOG_SCRIPT = POSTHOG_KEY
  ? `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister identify alias set_config reset opt_in_capturing opt_out_capturing has_opted_out_capturing has_opted_in_capturing get_distinct_id group setPersonProperties".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init(${JSON.stringify(POSTHOG_KEY)},{api_host:${JSON.stringify(POSTHOG_HOST)},person_profiles:"identified_only",defaults:"2025-05-24",capture_exceptions:true});`
  : "";

/** The signup steps, in the order a visitor meets them. */
export type SignupEvent =
  | "signup_opened"
  /** The Black Friday bar's "Start free trial" (lib/black-friday.ts). */
  | "bf_banner_clicked"
  | "signup_account_submitted"
  | "signup_account_created"
  | "signup_plan_changed"
  | "signup_trial_started"
  // The card step's one-time "Not ready just yet?" offer.
  | "exit_offer_shown"
  | "exit_offer_accepted"
  | "exit_offer_dismissed"
  // "Email me a link to finish later", and that link being opened.
  | "finish_later_requested"
  | "finish_later_link_opened"
  // The end of every step, and every error a visitor is shown (Neema,
  // 2026-11-22: step 3 broke on a Saturday and the funnel could not show where).
  | "signup_step_completed"
  // Each step as it opens, so the funnel shows where people stop, not only
  // what they finished (Neema, 2026-11-25).
  | "signup_step_viewed"
  | "signup_validation_error";

type PostHog = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (id: string, properties?: Record<string, unknown>) => void;
  register?: (properties: Record<string, unknown>) => void;
};

function posthog(): PostHog | null {
  if (typeof window === "undefined") return null;
  const ph = (window as unknown as { posthog?: PostHog }).posthog;
  return ph && typeof ph.capture === "function" ? ph : null;
}

export function captureSignup(event: SignupEvent, properties?: Record<string, unknown>): void {
  try {
    posthog()?.capture(event, properties);
  } catch {
    /* analytics never gets in the way */
  }
}

/**
 * The signup's steps as the funnel counts them. Step 3 is the business page on
 * the password path and the business-only screen after a Google sign-in.
 */
export const SIGNUP_STEP_NAMES = {
  1: "details",
  2: "password",
  3: "business",
  4: "email_code",
  5: "card",
} as const;
export type SignupStep = keyof typeof SIGNUP_STEP_NAMES;

/** `signup_step_viewed`, when a step opens. */
export function captureStepViewed(step: SignupStep, properties?: Record<string, unknown>): void {
  captureSignup("signup_step_viewed", { step, step_name: SIGNUP_STEP_NAMES[step], ...properties });
}

/**
 * Tie this visitor's events to their signup lead (lib/signup-lead.ts) once the
 * first page is saved: an internal id only, never an email or phone.
 *
 * A super property rather than `identify`: the account is identified by its own
 * id once it exists (identifyAccount), and PostHog cannot merge two identified
 * ids, so identifying the lead first would split each person in two.
 */
export function registerSignupLead(leadId: string): void {
  try {
    posthog()?.register?.({ signup_lead_id: leadId });
  } catch {
    /* analytics never gets in the way */
  }
}

/** `signup_step_completed`, once a step's answers are accepted. */
export function captureStepCompleted(step: SignupStep, properties?: Record<string, unknown>): void {
  captureSignup("signup_step_completed", { step, step_name: SIGNUP_STEP_NAMES[step], ...properties });
}

/**
 * One `signup_validation_error` per field the visitor is shown an error under.
 * The message is our own copy, never anything they typed.
 */
export function captureValidationErrors(
  step: SignupStep,
  errors: Readonly<Record<string, string | undefined>>,
): void {
  for (const [field, message] of Object.entries(errors)) {
    if (!message) continue;
    captureSignup("signup_validation_error", { step, step_name: SIGNUP_STEP_NAMES[step], field, message });
  }
}

/**
 * Tie this browser's earlier page views to the account it just created.
 * `properties` are set on the PostHog person.
 */
export function identifyAccount(userId: string, properties?: Record<string, unknown>): void {
  try {
    posthog()?.identify(userId, properties);
  } catch {
    /* analytics never gets in the way */
  }
}
