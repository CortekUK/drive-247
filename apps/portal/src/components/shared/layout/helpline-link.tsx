import { Phone } from "lucide-react";

/** Drive247's support line, shown to every tenant in both portal headers. */
export const HELPLINE_DISPLAY = "+1 315 444 0085";
export const HELPLINE_TEL = "tel:+13154440085";

/**
 * The helpline as a `tel:` link: tapping it on a phone starts the call, and on
 * a desktop it hands the number to whatever handles calls (FaceTime, Teams,
 * Skype...), the same as a phone number in a Google result.
 *
 * One component for both headers (v1 `<header>` in (dashboard)/layout.tsx and
 * TopBarV2) so the number lives in exactly one place. On a phone the digits
 * collapse to the icon, which keeps the bar from wrapping; the link still
 * calls and still announces the number.
 */
export function HelplineLink({ className = "" }: { className?: string }) {
  return (
    <a
      href={HELPLINE_TEL}
      aria-label={`Call Drive247 support on ${HELPLINE_DISPLAY}`}
      title="Call Drive247 support"
      className={
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-[13px] font-medium text-primary transition-colors " +
        "hover:bg-primary/10 dark:text-[hsl(var(--v2-link,var(--primary)))] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] " +
        className
      }
    >
      <Phone className="size-4 shrink-0" aria-hidden />
      <span className="hidden tabular-nums md:inline">{HELPLINE_DISPLAY}</span>
    </a>
  );
}
