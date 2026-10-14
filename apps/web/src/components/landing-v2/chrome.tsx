import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ThemeSwitch } from "./theme-switch";

export const PILL_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--lv-accent)] px-6 text-[14px] font-semibold text-[var(--lv-on-accent)] transition-opacity duration-200 ease-out hover:opacity-90 motion-reduce:transition-none";

export const PILL_OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[var(--lv-line-2)] px-6 text-[14px] font-semibold text-[var(--lv-ink)] transition-colors duration-200 ease-out hover:bg-[var(--lv-tint)] motion-reduce:transition-none";

const NAV = [
  { label: "Product", href: "#product" },
  { label: "Trax", href: "#trax" },
  { label: "How it works", href: "#launch" },
  { label: "FAQ", href: "#faq" },
];

function Logo() {
  return (
    <Link href="/" aria-label="Drive247 home" className="shrink-0">
      <Image src="/logo-light.png" alt="Drive247" width={855} height={195} className="h-6 w-auto dark:hidden" priority />
      <Image src="/logo-dark.png" alt="Drive247" width={855} height={195} className="hidden h-6 w-auto dark:block" priority />
    </Link>
  );
}

/** Transparent bar on the page wash, as the portal's top bar sits on it. */
export function HeaderV2({ showPricing }: { showPricing: boolean }) {
  const links = showPricing ? [...NAV.slice(0, 3), { label: "Pricing", href: "#pricing" }, NAV[3]] : NAV;
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--lv-line)] bg-[color-mix(in_srgb,var(--lv-bg)_78%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[var(--lv-ink-3)] transition-colors duration-200 ease-out hover:bg-[var(--lv-tint)] hover:text-[var(--lv-ink)] motion-reduce:transition-none"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <a href="/strategy-call" className={`${PILL_PRIMARY} h-9 px-4 text-[13px]`}>
            Book a call
            <ArrowRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </header>
  );
}

export function FooterV2() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[var(--lv-line)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-[13px] leading-relaxed text-[var(--lv-ink-3)]">
            Your own booking site, operator portal and renter portal, for independent car rental operators.
          </p>
        </div>
        <div className="flex gap-16 text-[13px]">
          <ul className="space-y-2.5">
            <li className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lv-ink-3)]">Product</li>
            {NAV.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-[var(--lv-ink-2)] transition-colors duration-200 hover:text-[var(--lv-accent-ink)]">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <ul className="space-y-2.5">
            <li className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lv-ink-3)]">Company</li>
            {[
              { label: "Book a call", href: "/strategy-call" },
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
              { label: "Security", href: "/security" },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-[var(--lv-ink-2)] transition-colors duration-200 hover:text-[var(--lv-accent-ink)]">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 border-t border-[var(--lv-line)] px-4 py-6 text-[12px] text-[var(--lv-ink-3)] sm:flex-row sm:px-6">
        <p>&copy; {year} Cortek. All rights reserved.</p>
        <p>
          Built by{" "}
          <a href="https://cortek.co" target="_blank" rel="noopener noreferrer" className="text-[var(--lv-ink-2)] underline-offset-2 hover:underline">
            Cortek
          </a>
        </p>
      </div>
    </footer>
  );
}
