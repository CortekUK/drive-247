'use client';

/**
 * Template 2 ("Glass") — the frame for sign in, create an account and reset
 * your password (/template-2/login, /signup, /forgot-password).
 *
 * The screens are site-v2's (`auth-v2/`): the same forms, rules, Google
 * sign-in, `?next=` and redirect for someone already signed in. They draw
 * whatever frame `AuthFrameContext` gives them; this is Template 2's — one
 * pane of glass, what an account is for on the left (from lg), the form on
 * the right in a lighter well — and the links between the pages stay on the
 * Template 2 addresses.
 */

import Link from 'next/link';
import { CalendarCheck, FileText, MessageCircle, Receipt } from 'lucide-react-nw';

import { AuthFrameContext } from '@nw/auth-v2/auth-split-shell';
import { useTenant } from '@nw/contexts/TenantContext';
import { cn } from '@nw/lib/utils';
import { T2_HOME, t2Href } from '@nw/template-2/links';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

/** What the customer portal behind these screens actually does. */
const ACCOUNT = [
  { Icon: CalendarCheck, text: 'See your bookings and change your dates' },
  { Icon: FileText, text: 'Upload your licence and sign your agreement' },
  { Icon: Receipt, text: 'Pay online and keep every receipt' },
  { Icon: MessageCircle, text: 'Message us about a rental' },
];

function GlassAuthShell({ children }: { children: React.ReactNode }) {
  const { tenant } = useTenant();
  const name = tenant?.company_name?.trim() || tenant?.app_name?.trim() || null;
  return (
    <div className="pb-3">
      <section className="mx-auto w-full max-w-[1320px] px-3 pt-[84px] sm:px-5 sm:pt-[96px]">
        <div className="g2-glass grid gap-3 rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:rounded-[40px]">
          <aside className="hidden flex-col justify-between rounded-[28px] px-8 py-10 lg:flex xl:px-12">
            <div>
              <h2 className="max-w-[14ch] text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] [text-wrap:balance] xl:text-[52px]">
                One account for every booking.
              </h2>
              <p className="mt-4 max-w-[30rem] text-[17px] leading-relaxed text-[var(--g2-ink-soft)]">
                {name ? `Everything about your rentals with ${name}, in one place.` : 'Everything about your rentals, in one place.'}
              </p>
            </div>
            <ul className="mt-10 space-y-2.5">
              {ACCOUNT.map(({ Icon, text }) => (
                <li key={text} className="g2-well g2-tray flex items-center gap-3.5 rounded-[20px] px-4 py-3.5">
                  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-[var(--g2-accent-ink)] shadow-[inset_0_1px_0_#fff]">
                    <Icon className="size-[18px]" strokeWidth={2} />
                  </span>
                  <span className="text-[15px] font-medium text-[var(--g2-ink)]">{text}</span>
                </li>
              ))}
            </ul>
          </aside>

          <div className="g2-skin rounded-[28px] bg-white/70 px-5 py-8 shadow-[inset_0_1px_0_#fff,0_18px_40px_-30px_rgb(13_12_29/0.45)] sm:px-10 sm:py-12">
            <div className="mx-auto w-full max-w-[440px]">
              {children}
              <p className="mt-4 text-center text-[13px] text-[var(--g2-ink-soft)]">
                <Link href={T2_HOME} className={cn('-my-3 inline-flex min-h-11 items-center rounded transition-colors hover:text-[var(--g2-ink)]', FOCUS)}>
                  Back to the website
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const FRAME = { Shell: GlassAuthShell, href: t2Href };

export function Template2AuthFrame({ children }: { children: React.ReactNode }) {
  return <AuthFrameContext.Provider value={FRAME}>{children}</AuthFrameContext.Provider>;
}
