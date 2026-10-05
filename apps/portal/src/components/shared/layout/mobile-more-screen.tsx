"use client";

/**
 * The phone's "More" screen — Option 1 of the mobile navigation (Oct 6 2026).
 *
 * On a phone the portal is a PWA opened from the Home Screen, so the rest of
 * the app should not arrive as a squeezed desktop sidebar sliding in from the
 * left. It arrives as its own SCREEN: a large title, the account at the top,
 * the Portal / Website switch, and everything else as grouped cards with
 * 52px rows — the way the Settings app on a phone lays out a long list.
 *
 * It sits under the bottom tab bar (which stays visible, with "More" lit), and
 * opens and closes with the Trax motion: 200ms, fade plus a 12px lift, ease-out
 * in and ease-in out, kept painted until it has left (V2_PLAN §12).
 *
 * Chosen from four options compared on the canary (page, bottom drawer, menu
 * behind the tenant mark, the old side sheet) on Oct 6 2026.
 *
 * The rows are NOT computed here. The v2 sidebar publishes the nav it already
 * resolved (grants, lean gates, arrangement, badges) into `mobile-nav-store`,
 * so this screen can never offer a page the sidebar would not.
 *
 * Phone only (`md:hidden`); mounted by MobileTabBar, which is itself v2-only.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ChevronRight,
  Crown,
  ExternalLink,
  LayoutGrid,
  LogOut,
  MessageSquareText,
  Moon,
  Plug,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui-v2/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { OrgMark } from "@/components/shared/layout/org-switcher";
import { useMobileNavStore, type MobileNavItem } from "@/stores/mobile-nav-store";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useFeedbackStore } from "@/stores/feedback-store";
import { useFeedbackSettings } from "@/hooks/use-feedback-settings";
import { bookingOriginFor } from "@/lib/booking-origin";
import { runThroughLeaveGuard } from "@/lib/leave-guard";

const MOTION_IN =
  "visible translate-y-0 opacity-100 [transition:transform_200ms_ease-out,opacity_200ms_ease-out,visibility_0s]";
const MOTION_OUT =
  "invisible pointer-events-none translate-y-3 opacity-0 [transition:transform_200ms_ease-in,opacity_200ms_ease-in,visibility_0s_linear_200ms]";

const CARD = "overflow-hidden rounded-2xl border border-border bg-card";
const ROW =
  "flex h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium transition-colors duration-200 active:bg-primary/[0.06] dark:active:bg-[hsl(var(--v2-hover,var(--muted)))]";
/** Inset hairline between rows, starting under the label rather than the icon. */
const DIVIDED = "[&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:left-12 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-border";

const BADGE_TONE: Record<NonNullable<MobileNavItem["badgeTone"]>, string> = {
  destructive: "bg-destructive text-destructive-foreground",
  amber: "bg-amber-600 text-white",
};

export function MobileMoreScreen() {
  const open = useMobileNavStore((s) => s.open);
  const setOpen = useMobileNavStore((s) => s.setOpen);
  const pathname = usePathname() ?? "/";

  // Any navigation closes it — a row tap, a tab tap, a link elsewhere.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  return <MoreScreen open={open} />;
}

/** A full-screen page under the tab bar. */
function MoreScreen({ open }: { open: boolean }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="More"
      aria-hidden={!open}
      data-mobile-more=""
      className={cn(
        "fixed inset-0 z-[39] flex flex-col bg-background md:hidden motion-reduce:transition-none",
        open ? MOTION_IN : MOTION_OUT
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]">
        <div className="mx-auto flex max-w-lg flex-col gap-5 px-4">
          <h1 className="pt-4 text-[30px] font-medium leading-tight tracking-[-0.01em] text-foreground">More</h1>
          <MoreBody open={open} />
        </div>
      </div>
    </div>
  );
}

/** The menu itself. */
function MoreBody({ open }: { open: boolean }) {
  const setOpen = useMobileNavStore((s) => s.setOpen);
  const { more, groups, cmsPages, canSeeCms } = useMobileNavStore((s) => s.model);
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  const [view, setView] = useState<"admin" | "cms">(pathname.startsWith("/cms") ? "cms" : "admin");

  // Each fresh open starts on the half of the product you are in.
  useEffect(() => {
    if (open) setView(pathname.startsWith("/cms") ? "cms" : "admin");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => setOpen(false);
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/finances") return ["/finances", "/payments", "/invoices", "/fines"].some((p) => pathname.startsWith(p));
    if (href === "/cms") return pathname === "/cms";
    return pathname.startsWith(href);
  };

  const goWebsite = () => {
    runThroughLeaveGuard("/cms", () => {
      close();
      router.push("/cms");
    });
  };

  return (
    <>
      <AccountCard onNavigate={close} />

      {canSeeCms && (
        <div className="grid grid-cols-2 rounded-full border border-border bg-card p-1" role="tablist">
          {([
            { key: "admin", label: "Portal" },
            { key: "cms", label: "Website" },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={view === tab.key}
              onClick={() => setView(tab.key)}
              className={cn(
                "h-10 rounded-full text-[14px] font-medium transition-colors duration-200",
                view === tab.key
                  ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                  : "text-muted-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {view === "admin" || !canSeeCms ? (
        <>
          {more.length > 0 && (
            <Section>
              {more.map((item) => (
                <NavRow key={item.href} item={item} active={isActive(item.href)} onNavigate={close} />
              ))}
            </Section>
          )}

          {groups.map((group) => (
            <Section key={group.label} label={group.label}>
              {group.items.map((item) => (
                <NavRow key={item.href} item={item} active={isActive(item.href)} onNavigate={close} />
              ))}
            </Section>
          ))}

          <Section label="Account">
            <NavRow item={{ name: "Integrations", href: "/integrations", icon: Plug }} active={isActive("/integrations")} onNavigate={close} />
            <NavRow item={{ name: "Billing", href: "/subscription", icon: Crown }} active={isActive("/subscription")} onNavigate={close} />
            <NavRow item={{ name: "Settings", href: "/settings", icon: Settings }} active={isActive("/settings")} onNavigate={close} />
          </Section>
        </>
      ) : (
        <>
          <Section>
            <button type="button" onClick={goWebsite} className={ROW}>
              <LayoutGrid className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Website overview</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
            </button>
          </Section>
          {cmsPages.length > 0 && (
            <Section label="Pages">
              {cmsPages.map((page) => (
                <NavRow
                  key={page.id}
                  item={{ name: page.name, href: page.href, icon: page.icon }}
                  active={isActive(page.href)}
                  onNavigate={close}
                  trailing={
                    <span className={cn("text-[13px]", page.published ? "text-green-600 dark:text-green-500" : "text-muted-foreground")}>
                      {page.published ? "Live" : "Draft"}
                    </span>
                  }
                />
              ))}
            </Section>
          )}
          <Section>
            <NavRow item={{ name: "Site settings", href: "/cms/site-settings", icon: SlidersHorizontal }} active={isActive("/cms/site-settings")} onNavigate={close} />
          </Section>
        </>
      )}

      <PreferencesSection />

      <SignOutRow />
    </>
  );
}

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {label && <h2 className="px-4 text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{label}</h2>}
      <div className={cn(CARD, DIVIDED)}>{children}</div>
    </section>
  );
}

function NavRow({
  item,
  active,
  onNavigate,
  trailing,
}: {
  item: MobileNavItem;
  active: boolean;
  onNavigate: () => void;
  trailing?: React.ReactNode;
}) {
  const Icon = item.icon;
  const badge = item.badge ?? 0;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(ROW, active ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-foreground")}
    >
      <Icon className={cn("size-5 shrink-0", active ? "" : "text-muted-foreground")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {trailing}
      {badge > 0 && (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-[Inter] text-[11px] font-semibold",
            BADGE_TONE[item.badgeTone ?? "destructive"]
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </Link>
  );
}

/** Who is signed in, and the business they are signed in to. */
function AccountCard({ onNavigate }: { onNavigate: () => void }) {
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const { branding } = useTenantBranding();
  const { isManager, canView } = useManagerPermissions();
  const orgName = branding?.app_name || "Organization";
  const bookingUrl = tenant?.slug ? bookingOriginFor(tenant.slug) : null;
  const canOpenSettings = !isManager || canView("settings");

  const initials = (appUser?.name || appUser?.email || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className={cn(CARD, DIVIDED)}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <OrgMark className="size-10 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-medium text-foreground">{orgName}</div>
          {bookingUrl && (
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${orgName} booking site (opens in a new tab)`}
              className="inline-flex items-center gap-1 text-[13px] text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
            >
              View booking site
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
      {appUser && (
        <Link
          href={canOpenSettings ? "/settings" : "#"}
          onClick={canOpenSettings ? onNavigate : (e) => e.preventDefault()}
          className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 active:bg-primary/[0.06]"
        >
          <Avatar className="size-8 shrink-0 overflow-hidden rounded-full">
            <AvatarImage src={appUser.avatar_url || undefined} alt={appUser.name || "User"} className="object-cover" />
            <AvatarFallback className="bg-primary/10 text-[12px] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium text-foreground">{appUser.name || "User"}</div>
            <div className="truncate text-[12px] text-muted-foreground">{appUser.email}</div>
          </div>
          {canOpenSettings && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />}
        </Link>
      )}
    </div>
  );
}

function PreferencesSection() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const openFeedback = useFeedbackStore((s) => s.open);
  const { formEnabled: feedbackEnabled } = useFeedbackSettings();
  return (
    <Section label="Preferences">
      <label className={cn(ROW, "text-foreground")}>
        <Moon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">Dark mode</span>
        <Switch checked={isDark} onCheckedChange={(on) => setTheme(on ? "dark" : "light")} aria-label="Dark mode" />
      </label>
      {feedbackEnabled && (
        <button type="button" onClick={() => openFeedback({ source: "sidebar" })} className={cn(ROW, "text-foreground")}>
          <MessageSquareText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">Send feedback</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
        </button>
      )}
    </Section>
  );
}

function SignOutRow() {
  const { signOut } = useAuth();
  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={async () => {
          try {
            await signOut();
          } catch (error) {
            console.error("Sign out error:", error);
          }
        }}
        className={cn(ROW, "justify-center text-destructive")}
      >
        <LogOut className="size-5 shrink-0" aria-hidden />
        Sign out
      </button>
    </div>
  );
}

