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
 * Nothing typed into a field is sent: PostHog never records input values, and
 * the card form is Stripe's own frame, which no script on this page can read.
 * A person is known by their account id only, never by email.
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
posthog.init(${JSON.stringify(POSTHOG_KEY)},{api_host:${JSON.stringify(POSTHOG_HOST)},person_profiles:"identified_only",defaults:"2025-05-24"});`
  : "";

/** The signup steps, in the order a visitor meets them. */
export type SignupEvent =
  | "signup_opened"
  | "signup_account_submitted"
  | "signup_account_created"
  | "signup_trial_started";

type PostHog = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (id: string, properties?: Record<string, unknown>) => void;
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

/** Tie this browser's earlier page views to the account it just created. */
export function identifyAccount(userId: string): void {
  try {
    posthog()?.identify(userId);
  } catch {
    /* analytics never gets in the way */
  }
}
