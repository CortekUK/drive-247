"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { PLATFORM_PRIVACY_URL, PLATFORM_TERMS_URL } from "@/lib/legal/urls";

/**
 * Platform Terms of Service + Privacy Policy acceptance gate.
 *
 * ONE component, shared by every surface where a tenant commits money:
 *   · components/subscription/pricing-card.tsx — both the embedded (paywall
 *     modal) and elevated (/subscription, Settings) CTA variants
 *   · app/(dashboard)/credits/page.tsx — buying credits, which is a real charge
 *     on a route explicitly whitelisted past the paywall
 *
 * Those surfaces are near-duplicate JSX maintained separately, and the paywall
 * modal is the one a never-subscribed tenant is actually forced through — so a
 * gate copy-pasted per surface would drift and leave the most-used path
 * ungated. Keeping it here makes that drift impossible rather than unlikely.
 *
 * Both links point at the CANONICAL documents on the marketing site. There is
 * exactly one platform Terms of Service (drive-247.com/terms) and one Privacy
 * Policy (drive-247.com/privacy). The portal used to serve a second,
 * differently-worded copy of the terms at its own /terms; that is retired and
 * 307s to the canonical URL (see apps/portal/next.config.js).
 *
 * The URLs are absolute by necessity — the portal runs on
 * {tenant}.portal.drive-247.com, so a root-relative href resolves against that
 * origin and can never reach the marketing site. Both open in a new tab so the
 * tenant does not lose their place in checkout.
 *
 * NOT a tenant's own rental terms: apps/booking serves those per-tenant from the
 * CMS at {tenant}.drive-247.com/terms. Different parties, different contract,
 * and it is under A2P 10DLC carrier review. Never cross-link them.
 */
export function TermsConsent({
  checked,
  onChange,
  disabled,
  id,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Must be unique per rendered instance — callers pass a useId()-derived value. */
  id: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-md border border-border bg-muted/30 p-3 ${className ?? ""}`}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        className="mt-0.5"
        aria-describedby={`${id}-desc`}
      />
      <label
        htmlFor={id}
        id={`${id}-desc`}
        className="cursor-pointer text-xs leading-relaxed text-muted-foreground"
      >
        I have read and agree to the{" "}
        <a
          href={PLATFORM_TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
          // Stop the click bubbling to the <label>, which would otherwise
          // toggle the checkbox as a side effect of opening the document.
          onClick={(e) => e.stopPropagation()}
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href={PLATFORM_PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
          onClick={(e) => e.stopPropagation()}
        >
          Privacy Policy
        </a>
        .
      </label>
    </div>
  );
}
