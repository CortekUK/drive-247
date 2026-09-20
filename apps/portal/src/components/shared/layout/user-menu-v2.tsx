"use client";

import { useState } from 'react';
import { useAuth } from '@/stores/auth-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui-v2/dropdown-menu';
import { Button } from '@/components/ui-v2/button';
import { Badge } from '@/components/ui-v2/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui-v2/avatar';
import { User, LogOut, Moon, Sun, ChevronsUpDown, Send, SlidersHorizontal, Compass } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui-v2/switch';
import { useFeedbackStore } from '@/stores/feedback-store';
import { useFeedbackSettings } from '@/hooks/use-feedback-settings';
import {
  replayFirstRentalTour,
  useFirstRentalTourEligible,
} from '@/hooks/use-first-rental-tour';
import { ProfileSheetV2 } from './profile-sheet-v2';

/**
 * v2 user menu. New file beside `user-menu.tsx`, never an edit to it — the v1
 * menu keeps serving every tenant not on the `chrome` gate (V2_PLAN §3).
 *
 * Two shapes: `icon` (the compact avatar button, as v1) and `row` (the full
 * profile row that sits in the v2 sidebar footer).
 */
export const UserMenuV2 = ({ variant = 'icon' }: { variant?: 'icon' | 'row' } = {}) => {
  const { appUser, signOut } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const openFeedback = useFeedbackStore((s) => s.open);
  // Same gate the v1 sidebar puts on its "Send Feedback" row. The entry point
  // moved into this menu; the switch that turns it off must move with it, or a
  // tenant who disabled the form gets it back through the side door.
  const { formEnabled: feedbackEnabled } = useFeedbackSettings();
  // The first-rental tour is replayable from here. Effect-free gate — the hook
  // that owns the tour's autostart and its replay listener is mounted once, in
  // the dashboard layout, and must not be instantiated a second time.
  const tourEligible = useFirstRentalTourEligible();

  // Controlled so the row CONTAINER can carry the open state. The pill now
  // wraps the customise and caret buttons as well as the trigger, and a
  // `data-[state=open]` class only ever reaches the trigger itself.
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * The profile lives in its own component now (`profile-sheet-v2.tsx`) and
   * arrives from the TOP of the window rather than as a centred dialog (team
   * lead, Sep 20 2026). Everything that used to make this file 600 lines —
   * the avatar upload, the name write, the password dialog — went with it,
   * along with the bug where saving a name wrote `tenants.admin_name` and
   * every screen kept reading `app_users.name`.
   */
  const [profileOpen, setProfileOpen] = useState(false);

  // Every hook above this guard runs unconditionally — the early return must
  // stay below them so hook order never changes between renders.
  if (!appUser) return null;

  const userInitials = (appUser.name || appUser.email || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        {variant === 'row' ? (
          // Hover and open states live on the CONTAINER, not the trigger, so
          // the highlight covers the icons too rather than stopping short at
          // the end of the name. Open state comes from `menuOpen` — the
          // trigger's own `data-[state=open]` cannot style its parent.
          //
          // Neutral colours on purpose. These were `bg-sidebar-accent`, which
          // the theme hook drives from the tenant's accent colour, so on a warm
          // brand the whole row turned solid orange the moment the menu opened.
          // A row that is only a trigger should not be the loudest thing on
          // screen.
          <div
            className={`flex w-full items-center rounded-lg transition-colors hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] ${
              menuOpen ? 'bg-primary/10 dark:bg-[hsl(var(--v2-hover,var(--muted)))]' : ''
            }`}
          >
            {/* The customise button is a SIBLING of the trigger, not a child of
                it: nesting a button inside the trigger button is invalid markup,
                and the click would open the menu on its way past. */}
            <DropdownMenuTrigger asChild>
              <button className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none cursor-pointer">
                <Avatar className="h-8 w-8 rounded-full overflow-hidden shrink-0">
                  <AvatarImage src={appUser.avatar_url || undefined} alt={appUser.name || 'User'} className="object-cover" />
                  <AvatarFallback className="bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] text-xs font-medium">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold leading-tight truncate">{appUser.name || 'User'}</span>
                  <span className="block text-[11px] text-muted-foreground leading-tight truncate">{appUser.email}</span>
                </span>
                {appUser.must_change_password && (
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                )}
              </button>
            </DropdownMenuTrigger>
            {/* The customiser dialog needs the nav the sidebar computed, so it
                is mounted there and opened from here by event — the same
                pattern `open-global-search` already uses. */}
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new Event('open-sidebar-customizer'))
              }
              aria-label="Customise sidebar"
              title="Customise sidebar"
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground outline-none transition-colors cursor-pointer hover:bg-primary/10 hover:text-primary dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:hover:text-[hsl(var(--v2-link,var(--primary)))]"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            {/* The caret sits AFTER the customise button, so it can no longer be
                a child of the trigger. It drives the same menu through the
                controlled `open` state instead. `stopPropagation` on pointerdown
                is what makes that work while the menu is open: without it the
                dismissable layer would treat this as an outside click and close
                the menu a beat before the toggle reopened it. */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Open account menu"
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground outline-none transition-colors cursor-pointer hover:bg-primary/10 hover:text-primary dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:hover:text-[hsl(var(--v2-link,var(--primary)))]"
            >
              <ChevronsUpDown className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] transition-colors cursor-pointer">
              <Avatar className="h-8 w-8 rounded-full overflow-hidden">
                <AvatarImage src={appUser.avatar_url || undefined} alt={appUser.name || 'User'} className="object-cover" />
                <AvatarFallback className="bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] text-xs font-medium">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              {appUser.must_change_password && (
                <div className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full" />
              )}
            </Button>
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent align="start" sideOffset={8} className="w-64 p-0 rounded-xl overflow-hidden">
          {/* User info header */}
          <div className="p-2.5 pb-2">
            <div className="flex items-center gap-2.5">
              <Avatar className="h-9 w-9 ring-2 ring-border/50 rounded-full overflow-hidden">
                <AvatarImage src={appUser.avatar_url || undefined} alt={appUser.name || 'User'} className="object-cover" />
                <AvatarFallback className="bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] text-xs font-semibold">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px] truncate leading-tight">{appUser.name || 'User'}</div>
                <div className="text-[11px] text-muted-foreground/70 truncate leading-tight">{appUser.email}</div>
              </div>
            </div>
          </div>

          <DropdownMenuSeparator className="m-0" />

          {/* Menu items — Profile · Dark Mode */}
          <div className="p-1.5">
            {/* Billing and Settings are not here by request. Both belong to
                the organisation rather than the person: Settings is the org
                row at the top of the rail, which is now a plain link to it
                (see org-switcher.tsx), and Billing is its own row in the
                sidebar's top group. Nothing became unreachable. */}
            <DropdownMenuItem onClick={() => setProfileOpen(true)} className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]">
              <User className="mr-2.5 h-4 w-4 text-muted-foreground" />
              <span>Profile</span>
              {appUser.must_change_password && (
                <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">Action</Badge>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setTheme(isDark ? 'light' : 'dark');
              }}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]"
            >
              {isDark ? (
                <Sun className="mr-2.5 h-4 w-4 text-muted-foreground" />
              ) : (
                <Moon className="mr-2.5 h-4 w-4 text-muted-foreground" />
              )}
              <span>Dark Mode</span>
              <Switch checked={isDark} className="ml-auto pointer-events-none" />
            </DropdownMenuItem>
          </div>

          {/* Support is not here: it is a main sidebar item (below Fines) with its
              unread-message badge — see app-sidebar-v2.tsx. Feedback and the tour
              share this group, which is left out entirely when neither applies,
              so no empty section and double divider remain. */}
          {(feedbackEnabled || tourEligible) && (<>
          <DropdownMenuSeparator className="m-0" />

          <div className="p-1.5">
            {/* The in-app dialog, not a mailto — this is the v1 sidebar's
                "Send Feedback" button rehomed here, so the feedback still
                lands in `tenant_feedback` rather than someone's inbox.
                `source` stays "sidebar": the values are persisted behind a
                CHECK constraint, and this menu does live in the sidebar. */}
            {feedbackEnabled && (
              <DropdownMenuItem
                onSelect={() => openFeedback({ source: "sidebar" })}
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]"
              >
                <Send className="mr-2.5 h-4 w-4 text-muted-foreground" />
                <span>Feedback</span>
              </DropdownMenuItem>
            )}
            {/* Replay the three-stop first-rental tour. Canary only — the gate
                is the same slug-keyed one the tour itself uses, so this row and
                the tour can never disagree about who is eligible. Dispatches a
                window event rather than holding state, matching what the v2
                chrome already does for `open-sidebar-customizer`: the menu and
                the tour sit in different subtrees with no shared ancestor. */}
            {tourEligible && (
              <DropdownMenuItem
                onSelect={() => replayFirstRentalTour()}
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]"
              >
                <Compass className="mr-2.5 h-4 w-4 text-muted-foreground" />
                <span>Replay tour</span>
              </DropdownMenuItem>
            )}
          </div>
          </>)}

          <DropdownMenuSeparator className="m-0" />

          <div className="p-1.5">
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px] text-destructive focus:text-destructive focus:bg-destructive/10">
              <LogOut className="mr-2.5 h-4 w-4" />
              <span>Sign Out</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileSheetV2 open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
};
