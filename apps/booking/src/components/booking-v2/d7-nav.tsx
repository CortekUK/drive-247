"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { AuthPromptDialog } from "@/components/booking/AuthPromptDialog";
import { EnquiryModal } from "@/components/enquiry/enquiry-modal";
import { useTenant } from "@/contexts/TenantContext";
import { useHasFaqs } from "@/hooks/useHasFaqs";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useCustomerAuthStore } from "@/stores/customer-auth-store";
import { Icon, Logo } from "./d7-icons";
import { ThemeToggle } from "./d7-theme";
import { Magnetic } from "./d7-ui";

/**
 * booking-v2 header.
 *
 * This is a re-skin of `components/Navigation.tsx`, not a lookalike: it uses
 * the same auth store, the same login and enquiry dialogs, the same
 * FAQ/blog-aware link list and the same site-settings phone number. Anything
 * that works in the legacy header works here, because it is the same wiring
 * with this design's paint on it.
 */
export function D7Nav({ appName, logoUrl, phone, bookCta = "Book Now" }: {
  appName: string; logoUrl: string | null; phone: string | null; bookCta?: string;
}) {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [enquiryOpen, setEnquiryOpen] = useState(false);

  const pathname = usePathname();
  const router = useRouter();
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", v => setStuck(v > 24));

  const { tenant } = useTenant();
  const { settings } = useSiteSettings();
  const hasFaqs = useHasFaqs();
  const { customerUser, session, signOut, loading: authLoading } = useCustomerAuthStore();

  const isAuthenticated = !!customerUser && !!session;
  const blogEnabled = !!tenant?.blog_enabled;
  const enquiriesEnabled = tenant?.enquiries_enabled !== false;

  /* Same list, same conditions as the legacy header. */
  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
    { href: "/fleet", label: "Fleet" },
    { href: "/testimonials", label: "Reviews" },
    { href: "/promotions", label: "Promotions" },
    ...(hasFaqs ? [{ href: "/faq", label: "FAQ" }] : []),
    { href: "/contact", label: "Contact" },
    ...(blogEnabled ? [{ href: "/blog", label: "Blog" }] : []),
  ];

  const isActive = (href: string) => pathname === href;

  /* The booking widget lives on the home page. From anywhere else the CTA has
     to navigate there first — an in-page "#booking" would be a dead link. */
  const onHome = pathname === "/";
  const bookHref = onHome ? "#booking" : "/#booking";
  const goBook = (e: React.MouseEvent) => {
    if (!onHome) return;                       // let the router handle /#booking
    e.preventDefault();
    document.getElementById("booking")?.scrollIntoView({ behavior: "smooth" });
  };

  const telHref = (settings.phone || phone) ? `tel:${(settings.phone || phone || "").replace(/[^\d+]/g, "")}` : null;

  const initials = (customerUser?.customer?.name || "")
    .split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "U";

  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
    router.push("/");
  };

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed inset-x-0 top-0 z-50 transition-[background,box-shadow,backdrop-filter] duration-500
                    ${stuck ? "d7-glass border-b border-[var(--line)] shadow-[0_10px_34px_-26px_rgba(23,16,72,.5)]" : "bg-transparent"}`}>
        <div className="d7-wrap flex h-[74px] items-center justify-between gap-4">
          <Link href="/" aria-label={`${appName} home`} className="shrink-0">
            <Magnetic strength={0.18}><Logo name={appName} logoUrl={logoUrl} /></Magnetic>
          </Link>

          {/* centre links */}
          <nav className="hidden items-center gap-0.5 lg:flex">
            {navLinks.map(item => (
              <Link key={item.href} href={item.href}
                className="relative rounded-full px-3 py-2 text-[13.5px] font-medium text-[var(--body)] transition-colors hover:text-[var(--ink)]">
                {isActive(item.href) && (
                  <motion.span layoutId="d7-nav-pill" aria-hidden
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-[var(--v-lt)]" />
                )}
                <span className={`relative z-10 ${isActive(item.href) ? "font-semibold text-[var(--v)]" : ""}`}>
                  {item.label}
                </span>
              </Link>
            ))}
          </nav>

          {/* right controls */}
          <div className="flex items-center gap-2.5">
            {!authLoading && (isAuthenticated ? (
              <div className="relative hidden sm:block">
                <button onClick={() => setOpen(v => !v)}
                  className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--white)] py-1.5 pl-1.5 pr-3
                             text-[13.5px] font-semibold text-[var(--ink)] shadow-[var(--shadow)]
                             transition hover:-translate-y-0.5 hover:border-[var(--v)]/40">
                  <span className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-extrabold text-white [background:var(--grad)]">
                    {initials}
                  </span>
                  <span className="max-w-[92px] truncate">{customerUser?.customer?.name || "Account"}</span>
                  <Icon name="chev" className="h-4 w-4 text-[var(--mute)]" />
                </button>

                <AnimatePresence>
                  {open && (
                    <>
                      <button aria-hidden tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-0 cursor-default" />
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .97 }}
                        transition={{ duration: .18, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute right-0 z-10 mt-2 w-60 overflow-hidden rounded-[var(--r)] border border-[var(--line)]
                                   bg-[var(--white)] p-1.5 shadow-[var(--shadow-lg)]">
                        <div className="px-3 py-2">
                          <p className="truncate text-[13px] font-bold text-[var(--ink)]">{customerUser?.customer?.name}</p>
                          <p className="truncate text-[12px] text-[var(--mute)]">{customerUser?.customer?.email}</p>
                        </div>
                        <div className="my-1 h-px bg-[var(--line-2)]" />
                        <Link href="/portal" onClick={() => setOpen(false)}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-[var(--ink)] transition hover:bg-[var(--v-lt)]">
                          <Icon name="user" className="h-4 w-4 text-[var(--v)]" /> My Portal
                        </Link>
                        <button onClick={handleSignOut}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-[#c0392b] transition hover:bg-[#c0392b]/8">
                          <Icon name="arrow" className="h-4 w-4" /> Sign Out
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button onClick={() => setShowAuth(true)}
                className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--white)] px-4 py-2.5
                           text-[13.5px] font-semibold text-[var(--ink)] shadow-[var(--shadow)]
                           transition hover:-translate-y-0.5 hover:border-[var(--v)]/40 hover:text-[var(--v)] sm:flex">
                <Icon name="user" className="h-4 w-4" /> Login
              </button>
            ))}

            {enquiriesEnabled && (
              <button onClick={() => setEnquiryOpen(true)}
                className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--white)] px-4 py-2.5
                           text-[13.5px] font-semibold text-[var(--ink)] shadow-[var(--shadow)]
                           transition hover:-translate-y-0.5 hover:border-[var(--v)]/40 hover:text-[var(--v)] md:flex">
                <Icon name="chat" className="h-4 w-4" /> Enquiry
              </button>
            )}

            <ThemeToggle />

            {telHref && (
              <a href={telHref} aria-label={`Call ${appName}`}
                className="d7-btn grid h-11 w-11 place-items-center rounded-[13px] text-white
                           [background:var(--grad)] shadow-[var(--shadow-v)] transition hover:-translate-y-0.5">
                <Icon name="phone" className="h-[18px] w-[18px]" />
              </a>
            )}

            <button onClick={() => setOpen(v => !v)} aria-label="Open menu" aria-expanded={open}
              className="grid h-11 w-11 place-items-center rounded-[13px] border border-[var(--line)]
                         bg-[var(--v-lt)] text-[var(--v)] transition hover:bg-[var(--white)] lg:hidden">
              <Icon name={open ? "close" : "menu"} className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </motion.header>

      {/* mobile sheet */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-[var(--navy)]/35 backdrop-blur-[2px] lg:hidden" />
            <motion.nav
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="fixed right-0 top-0 z-50 flex h-full w-[min(340px,86vw)] flex-col gap-1 overflow-y-auto border-l
                         border-[var(--line)] bg-[var(--bg)] p-6 pt-[86px] shadow-[-30px_0_70px_-40px_rgba(0,0,0,.6)] lg:hidden">
              {navLinks.map((item, i) => (
                <motion.div key={item.href}
                  initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}>
                  <Link href={item.href} onClick={() => setOpen(false)}
                    className={`block border-b border-[var(--line-2)] py-3.5 text-[18px] tracking-[-.02em] transition hover:pl-2
                                d7-dis ${isActive(item.href) ? "text-[var(--v)]" : "text-[var(--ink)] hover:text-[var(--v)]"}`}>
                    {item.label}
                  </Link>
                </motion.div>
              ))}

              <div className="mt-6 grid gap-2.5">
                <a href={bookHref} onClick={e => { goBook(e); setOpen(false); }}
                  className="d7-btn rounded-full px-5 py-3 text-center text-[14px] font-semibold text-white [background:var(--grad)]">
                  {bookCta}
                </a>
                {enquiriesEnabled && (
                  <button onClick={() => { setOpen(false); setEnquiryOpen(true); }}
                    className="rounded-full border border-[var(--line)] px-5 py-3 text-[14px] font-semibold text-[var(--ink)]">
                    Enquiry
                  </button>
                )}
                {isAuthenticated ? (
                  <>
                    <Link href="/portal" onClick={() => setOpen(false)}
                      className="rounded-full border border-[var(--line)] px-5 py-3 text-center text-[14px] font-semibold text-[var(--ink)]">
                      My Portal
                    </Link>
                    <button onClick={handleSignOut}
                      className="rounded-full border border-[#c0392b]/40 px-5 py-3 text-[14px] font-semibold text-[#c0392b]">
                      Sign Out
                    </button>
                  </>
                ) : (
                  <button onClick={() => { setOpen(false); setShowAuth(true); }}
                    className="rounded-full border border-[var(--line)] px-5 py-3 text-[14px] font-semibold text-[var(--ink)]">
                    Login
                  </button>
                )}
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>

      {/* Same dialogs the legacy header uses, so login and enquiry behave
          identically on both designs. */}
      <AuthPromptDialog
        open={showAuth}
        onOpenChange={setShowAuth}
        prefillEmail=""
        onSkip={() => setShowAuth(false)}
        onSuccess={() => { setShowAuth(false); router.push("/portal"); }}
      />
      <EnquiryModal open={enquiryOpen} onOpenChange={setEnquiryOpen} />
    </>
  );
}
