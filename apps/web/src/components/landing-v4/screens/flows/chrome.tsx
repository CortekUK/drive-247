import type { ReactNode } from "react";
import { Bell, LogIn, Megaphone, Menu, PanelLeft, Sun } from "lucide-react";
import { HiwStatus } from "../hiw-status";
import "./legacy.css";

/*
 * Shared pieces for the renter flows: the ORIGINAL booking design (every tenant
 * but northwind — apps/booking/src/lib/booking-design.ts) at a 390px phone, in
 * a new self-serve signup's colours (see legacy.css).
 *
 * <FlowPhone> is the page: the phone's status bar on top, then the content.
 * Its `step` keys the page, so each step mounts fresh and plays .fl-in.
 */
export function FlowPhone({ className, step, light, children }: { className?: string; step?: number; light?: boolean; children: ReactNode }) {
  return (
    <div className={`fl${className ? ` ${className}` : ""}`}>
      <HiwStatus time="10:00" tone={light ? "dark" : "light"} />
      <div className="fl-page" key={step}>
        {children}
      </div>
    </div>
  );
}

/**
 * components/Navigation.tsx below xl (at 390px no sm: classes apply): the text
 * logo (uppercase, font-semibold, a 2px accent/60 rule under it) and, on the
 * right, the icon-only outline Login button (h-8 px-2.5) and the Menu toggle
 * (p-2, w-6 h-6). A signed-in renter sees their avatar (h-8 w-8) instead of Login.
 */
export function SiteNav({ signedIn }: { signedIn?: boolean }) {
  return (
    <header className="fl-nav">
      <span className="fl-logo">
        <span className="nm">Northwind Rentals</span>
        <span className="rule" />
      </span>
      <span className="fl-nav-r">
        {signedIn ? (
          <span className="fl-nav-av">DR</span>
        ) : (
          <span className="fl-nav-login">
            <LogIn />
          </span>
        )}
        <span className="fl-nav-menu">
          <Menu />
        </span>
      </span>
    </header>
  );
}

/**
 * components/customer-portal/CustomerPortalHeader.tsx at 390px: flex h-16
 * items-center gap-2 border-b px-4 — SidebarTrigger, a vertical Separator,
 * then the bell, the "What's New" announcements bell, ThemeToggle and the
 * avatar (name/email are hidden md:block). The sidebar is an off-canvas sheet.
 */
export function PortalHeader() {
  return (
    <header className="fl-phd">
      <span className="fl-trig">
        <PanelLeft />
      </span>
      <span className="fl-sep" />
      <span className="fl-fill" />
      <span className="fl-ib">
        <Bell />
      </span>
      <span className="fl-ib">
        <Megaphone />
      </span>
      <span className="fl-tt">
        <Sun />
      </span>
      <span className="fl-prof">
        <span className="fl-av">DR</span>
      </span>
    </header>
  );
}
