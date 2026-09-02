"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useCbpActions, useCbpCustomer } from "./actions";
import { Icon, Logo } from "./icons";
import { ThemeToggle, type CbpMode } from "./theme-toggle";
import { useLogoTone } from "./use-logo-tone";
import { CBP, type CbpContent } from "./use-site-content";

/* ========================================================================== */
/* NAV                                                                        */
/* ========================================================================== */

/**
 * The header from the reference: mark on the left, links centred, then Login,
 * Enquiry, a solid phone button and the mobile menu toggle.
 *
 * The mark and "Home" both point at `CBP` — this site's own landing page —
 * never at `/`, which still serves the operator's existing booking site.
 */
export function Nav({ c, mode, onToggleMode }: { c: CbpContent; mode: CbpMode | null; onToggleMode: () => void }) {
  const pathname = usePathname();
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the drawer on navigation, and lock the page behind it while open.
  useEffect(() => { setOpen(false); }, [pathname]);

  const isOn = (href: string) =>
    href === CBP ? pathname === CBP : !!pathname?.startsWith(href);

  const { openLogin, openEnquiry, enquiriesEnabled, signOut } = useCbpActions();
  const { customer } = useCbpCustomer();

  /* Which logo the header shows, and whether it needs a backing plate.

     Operators upload one logo, built for whichever ground their old site
     used — RevTek's is pale line-art that is perfect on a dark header and
     invisible on a white one. So: prefer the version made for the current
     ground, and where only one exists, measure its ink. A light-ink mark on
     the light header gets a dark plate; everything else is left alone. */
  const dark = mode === "dark";
  const headerLogo = (dark ? c.darkLogoUrl : c.logoUrl) || c.logoUrl;
  const tone = useLogoTone(headerLogo);
  // A light-ink mark on the white header, or a dark-ink mark on the dark one.
  const needsPlate: false | "dark" | "light" =
    !dark && tone === "light" ? "dark"
    : dark && tone === "dark" ? "light"
    : false;

  return (
    <header
      className={`sticky top-0 z-50 transition-[background-color,box-shadow,border-color] duration-300 ${
        stuck
          ? "cbp-nav-stuck border-b border-[var(--line)] bg-white/90 shadow-[var(--shadow-xs)] backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="cbp-wrap flex h-[70px] items-center justify-between gap-4">
        <Link href={CBP} aria-label={`${c.name} home`} className="flex min-w-0 shrink-0 items-center">
          <Logo name={c.name} src={headerLogo} showName={c.showLogoName} plate={needsPlate} />
        </Link>

        <nav className="hidden items-center gap-5 lg:flex xl:gap-7">
          {c.nav.map(l => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isOn(l.href) ? "page" : undefined}
              className={`relative text-[14px] font-medium transition-colors after:absolute after:-bottom-1.5
                          after:left-0 after:h-[2px] after:rounded-full after:bg-[var(--brand)]
                          after:transition-[width] after:duration-300 hover:text-[var(--brand)] ${
                            isOn(l.href)
                              ? "text-[var(--brand)] after:w-full"
                              : "text-[var(--ink-2)] after:w-0 hover:after:w-full"
                          }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {/* Sign-in happens here, in this site's own dialog, on the app's
              existing customer session — see actions.tsx. */}
          <AccountControl className="cbp-hide-md" />
          {enquiriesEnabled && (
            <button
              type="button"
              onClick={() => openEnquiry()}
              className="cbp-btn cbp-btn-ghost cbp-hide-sm !py-2.5"
            >
              <Icon name="chat" className="h-4 w-4 shrink-0" />
              Enquiry
            </button>
          )}
          {c.phoneHref && (
            <a
              href={`tel:${c.phoneHref}`}
              aria-label={`Call ${c.name}${c.phoneDisplay ? " on " + c.phoneDisplay : ""}`}
              className="cbp-icon-btn cbp-icon-btn-solid"
            >
              <Icon name="phone" className="h-[18px] w-[18px]" />
            </a>
          )}
          <ThemeToggle mode={mode} onToggle={onToggleMode} />
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="cbp-icon-btn cbp-hide-desktop"
          >
            <Icon name={open ? "close" : "menu"} className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------ mobile drawer */}
      {open && (
        <div className="cbp-rise cbp-hide-desktop border-t border-[var(--line)] bg-[var(--surface)]">
          <nav className="cbp-wrap flex flex-col py-3">
            {c.nav.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-[var(--r-sm)] px-3 py-3 text-[15px] font-semibold transition-colors ${
                  isOn(l.href) ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--ink-2)] hover:bg-[var(--wash)]"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--line)] pt-3">
              {customer ? (
                <>
                  <Link href="/portal" className="cbp-btn cbp-btn-ghost w-full">
                    <Icon name="user" className="h-4 w-4" /> My account
                  </Link>
                  <button type="button" onClick={signOut} className="cbp-btn cbp-btn-ghost w-full">
                    <Icon name="logout" className="h-4 w-4" /> Sign out
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => openLogin()} className="cbp-btn cbp-btn-ghost w-full">
                  <Icon name="user" className="h-4 w-4" /> Login
                </button>
              )}
              {enquiriesEnabled && (
                <button type="button" onClick={() => openEnquiry()} className="cbp-btn cbp-btn-ghost w-full">
                  <Icon name="chat" className="h-4 w-4" /> Enquiry
                </button>
              )}
              <Link href={`${CBP}#booking`} className="cbp-btn cbp-btn-primary w-full">
                {c.hero.bookCta} <Icon name="arrow" className="cbp-arrow h-4 w-4" />
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

/* ========================================================================== */
/* FOOTER                                                                     */
/* ========================================================================== */

export function Footer({ c }: { c: CbpContent }) {
  // The footer ground is always midnight, whatever the page theme, so a
  // dark-ink logo needs a light plate there even in light mode.
  const footerTone = useLogoTone(c.footerLogoUrl);
  const services: { label: string; href: string }[] = [
    { label: "Fleet & Pricing", href: `${CBP}/fleet` },
    { label: "Book a Vehicle", href: `${CBP}#booking` },
    { label: "Promotions", href: `${CBP}/promotions` },
  ];
  const company: { label: string; href: string }[] = [
    { label: "About Us", href: `${CBP}/about` },
    ...(c.reviews.length ? [{ label: "Reviews", href: `${CBP}/reviews` }] : []),
    { label: "Contact", href: `${CBP}/contact` },
    ...(c.faqs.length ? [{ label: "FAQ", href: `${CBP}/faq` }] : []),
    ...(c.blogEnabled ? [{ label: "Blog", href: `${CBP}/blog` }] : []),
  ];

  return (
    <footer className="mt-20 bg-[var(--deep)] text-white/70">
      <div className="cbp-wrap grid gap-10 py-14 lg:grid-cols-[1.6fr_1fr_1fr_1.3fr] lg:gap-12">
        <div>
          <Logo
            name={c.name} src={c.footerLogoUrl} tone="light"
            showName={c.showLogoName}
            plate={footerTone === "dark" ? "light" : false}
          />
          {c.tagline && <p className="mt-4 max-w-[22rem] text-[13.5px] leading-relaxed text-white/60">{c.tagline}</p>}
          {c.social.length > 0 && (
            <nav className="mt-6 flex flex-wrap gap-2.5">
              {c.social.map(s => (
                <a
                  key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
                >
                  <Icon name={s.label.toLowerCase()} className="h-[16px] w-[16px]" />
                </a>
              ))}
            </nav>
          )}
        </div>

        <FooterCol title="Services" links={services} />
        <FooterCol title="Company" links={company} />

        <div>
          <p className="text-[13px] font-bold uppercase tracking-[.1em] text-white">Contact</p>
          <ul className="mt-4 flex flex-col gap-3">
            {c.phoneHref && <FooterContact icon="phone" href={`tel:${c.phoneHref}`}>{c.phoneDisplay}</FooterContact>}
            {c.email && <FooterContact icon="mail" href={`mailto:${c.email}`}>{c.email}</FooterContact>}
            {c.address && <FooterContact icon="pin" href={c.mapsUrl} external>{c.address}</FooterContact>}
            {c.hours && <FooterContact icon="clock" href={null}>{c.hours}</FooterContact>}
          </ul>
        </div>
      </div>

      {/* The legal-entity notation carrier A2P messaging review looks for — a
          public page naming a different company than the registered messaging
          Brand is exactly the mismatch that fails vetting. */}
      {c.legalEntityLine && (
        <div className="cbp-wrap border-t border-white/10 py-5">
          <p className="max-w-[58rem] text-[11px] leading-relaxed text-white/45">{c.legalEntityLine}</p>
        </div>
      )}

      <div className="cbp-wrap flex flex-wrap items-center justify-between gap-4 border-t border-white/10 py-5">
        <p className="text-[12px] text-white/55">{c.copyright}</p>
        <nav className="flex flex-wrap gap-5">
          {c.legalLinks.map(l => (
            <Link key={l.href} href={l.href} className="text-[12px] text-white/55 transition-colors hover:text-white">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  if (!links.length) return null;
  return (
    <div>
      <p className="text-[13px] font-bold uppercase tracking-[.1em] text-white">{title}</p>
      <nav className="mt-4 flex flex-col gap-2.5">
        {links.map(l => (
          <Link key={l.href} href={l.href} className="text-[13px] text-white/65 transition-colors hover:text-white">
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function FooterContact({
  icon, href, external, children,
}: { icon: string; href: string | null; external?: boolean; children: React.ReactNode }) {
  const body = (
    <>
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-white/45" />
      <span className="min-w-0 break-words">{children}</span>
    </>
  );
  return (
    <li className="flex items-start gap-2.5 text-[13px] text-white/65">
      {href ? (
        <a
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          className="flex items-start gap-2.5 transition-colors hover:text-white"
        >
          {body}
        </a>
      ) : (
        <span className="flex items-start gap-2.5">{body}</span>
      )}
    </li>
  );
}

/** Shared page header for the inner pages, in the hero's violet wash. */
export function PageHeader({
  title, subtitle, eyebrow,
}: { title: string; subtitle?: string; eyebrow?: string }) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--line)]">
      <div className="cbp-hero-wash" />
      <div className="cbp-wrap relative py-14 text-center sm:py-16">
        {eyebrow && <p className="cbp-eyebrow cbp-rise justify-center">{eyebrow}</p>}
        <h1 className="cbp-display cbp-rise mt-3 !text-[clamp(1.9rem,4vw,2.9rem)]">{title}</h1>
        {subtitle && (
          <p className="cbp-body cbp-rise mx-auto mt-4 max-w-[38rem]" style={{ animationDelay: "80ms" }}>
            {subtitle}
          </p>
        )}
      </div>
    </section>
  );
}

/* ========================================================================== */
/* ACCOUNT                                                                    */
/* ========================================================================== */

/**
 * One slot in the header carrying both states: a Login button for a visitor,
 * and the customer's own name with a small menu once they are signed in.
 *
 * It renders nothing until the session has been checked. A Login button that
 * flashes up and turns into a name is worse than a beat of nothing, and worse
 * still is the reverse — a signed-in customer being asked to sign in again.
 */
function AccountControl({ className = "" }: { className?: string }) {
  const { openLogin, signOut } = useCbpActions();
  const { customer, ready } = useCbpCustomer();

  if (!ready) return <span className={`${className} w-[92px]`} aria-hidden="true" />;

  if (!customer) {
    return (
      <button
        type="button"
        onClick={() => openLogin()}
        className={`cbp-btn cbp-btn-ghost !py-2.5 ${className}`}
      >
        <Icon name="user" className="h-4 w-4 shrink-0" />
        Login
      </button>
    );
  }

  const name = customer.name || customer.email || "Account";
  const initials = name.trim().split(/s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={`cbp-btn cbp-btn-ghost !py-2 !pl-2 ${className}`}>
          <span className="cbp-avatar" aria-hidden="true">{initials}</span>
          <span className="max-w-[110px] truncate">{name.split(" ")[0]}</span>
          <Icon name="chevron" className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="cbp cbp-menu"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          data-theme={typeof document !== "undefined"
            ? document.querySelector(".cbp-root")?.getAttribute("data-theme") ?? undefined
            : undefined}
        >
          <div className="cbp-menu-head">
            <p className="truncate text-[13px] font-bold text-[var(--ink)]">{name}</p>
            {customer.email && (
              <p className="truncate text-[11.5px] text-[var(--meta)]">{customer.email}</p>
            )}
          </div>
          <Link href="/portal" className="cbp-menu-item">
            <Icon name="user" className="h-4 w-4" /> My account
          </Link>
          <button type="button" onClick={signOut} className="cbp-menu-item cbp-menu-item--danger">
            <Icon name="logout" className="h-4 w-4" /> Sign out
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
