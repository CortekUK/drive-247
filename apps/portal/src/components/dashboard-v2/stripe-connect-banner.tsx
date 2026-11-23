"use client";

/**
 * The one-line Stripe reminder on the v2 home (23 Nov 2026).
 *
 * Connecting Stripe is the ONE thing a new company must do before a real
 * rental, so the home says so until it is done: one quiet line in the style of
 * Stripe's own dashboard notices (Stripe's mark, sentence, text link), rather
 * than a card that pushes the bands down.
 *
 * The words make the point that matters to an operator: it is THEIR Stripe
 * account, and their customers pay straight into it.
 *
 * Shown to the owner while `useFirstSteps` says Stripe is not usable, and it
 * CANNOT be closed (Ghulam, 23 Nov): it goes away when Stripe is connected,
 * not before. On a /fake-quick-tour run it shows the pretend company.
 */
import { useRouter } from "next/navigation";
import { useAuth } from "@/stores/auth-store";
import { CONNECT_STRIPE_HREF, useFirstSteps } from "@/hooks/use-first-steps";

export function StripeConnectBanner() {
  const router = useRouter();
  const { appUser } = useAuth();
  const first = useFirstSteps();

  // The owner's decision, not every staff login's.
  const isOwner = appUser?.role === "head_admin" || appUser?.role === "admin";
  if (!first.ready || first.stripeConnected || (!isOwner && !first.fake)) return null;

  return (
    <div
      role="status"
      // md:mt-3.5 cancels the layout's pull-up on the page's first child
      // (`md:[header+&>*:first-child]:-mt-3.5` on <main>, there to line the
      // first band up with the sidebar switch): without it the banner's top
      // 14px sat above main's scroll edge and was cut off. md:mb-[39px] keeps
      // a 24px gap, since the first band pulls itself up 15px too.
      className="mb-6 flex shrink-0 items-start gap-3 rounded-xl md:mb-[39px] md:mt-3.5 bg-foreground/[0.04] px-5 py-3.5 text-[14px] text-[var(--pv-ink-2)] dark:bg-foreground/[0.07] sm:items-center"
    >
      <StripeMark className="mt-px sm:mt-0" />
      <p className="min-w-0 flex-1 leading-snug">
        Connect your Stripe account to receive payments from your customers directly. Setup takes about 30 seconds.
      </p>
      <button
        type="button"
        onClick={() => router.push(CONNECT_STRIPE_HREF)}
        className="shrink-0 font-medium text-[var(--pv-accent-ink)] underline-offset-4 hover:underline"
      >
        Connect Stripe
      </button>
    </div>
  );
}

/**
 * Stripe's own mark: the white "S" on its purple tile, so the line reads as
 * Stripe at a glance (Ghulam, 23 Nov: "use stripe icon here"). Inline rather
 * than the Integrations board's logo.dev image, so the home makes no extra
 * request for it. Path: Simple Icons' Stripe glyph (CC0).
 */
function StripeMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-[22px] shrink-0 items-center justify-center rounded-[6px] bg-[#635BFF] ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-[13px]" fill="#ffffff">
        <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" />
      </svg>
    </span>
  );
}
