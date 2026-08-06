"use client";

import { Checkbox } from "@/components/ui/checkbox";

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
 * Both links resolve on the portal origin ({tenant}.portal.drive-247.com):
 * /terms is served by (auth)/terms/page.tsx and /privacy-policy by
 * (auth)/privacy-policy/page.tsx. Neither sits behind auth — (auth)/layout does
 * no auth check — which matters because they open in a new tab mid-checkout.
 *
 * Do NOT switch these to absolute drive-247.com URLs. The portal is deliberately
 * white-labelled per tenant, and a relative link from the portal can never reach
 * the marketing site anyway (different origin, no rewrites configured).
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
          href="/terms"
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
          href="/privacy-policy"
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
