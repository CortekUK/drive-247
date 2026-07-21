"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSetupReminder } from "@/hooks/use-setup-reminder";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, CreditCard, ImageIcon, ShieldCheck } from "lucide-react";

/**
 * "Don't show me again" — permanent, so it must OUTLIVE the browser session.
 * localStorage.
 */
const dismissedKey = (tenantId: string) => `setup-reminder-dismissed-${tenantId}`;

/**
 * Closing the dialog only silences it for the CURRENT portal session, so it
 * comes back every time the tenant opens the portal until the tasks are
 * actually done. Deliberately sessionStorage, not a localStorage timestamp: a
 * 24h clock let a tenant close it once and then not see it again for the rest
 * of the day, including across several fresh logins.
 */
const snoozedKey = (tenantId: string) => `setup-reminder-snoozed-${tenantId}`;

interface ReminderTask {
  key: string;
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
}

interface ReminderFlags {
  /** Which tenant these flags were read for — guards against a stale render after a tenant switch. */
  tenantId: string;
  permanentlyDismissed: boolean;
  dueBySnooze: boolean;
}

/**
 * Recurring, dismissible nudge shown to a subscribed tenant who still has
 * outstanding setup tasks (logo, Stripe Connect, Bonzah insurance).
 *
 * It can never fight the subscription paywall: it requires a *resolved*,
 * currently-active subscription (`isResolved && isSubscribed`) and explicitly
 * bails when `hasExpiredSubscription` is set — the two states the dashboard
 * layout uses to raise the non-dismissible SubscriptionGateDialog are exactly
 * the states in which this dialog stays closed.
 *
 * Closing it (X / outside-click / escape) silences it for the CURRENT portal
 * session only (sessionStorage), so it reappears every time the tenant opens
 * the portal until Bonzah / logo / Stripe Connect are actually done. "Don't
 * show me again" dismisses it permanently (localStorage). Both keys are
 * per-tenant, so switching tenants re-evaluates from that tenant's own state.
 */
export function SetupReminderDialog() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { isSubscribed, hasExpiredSubscription, isResolved } =
    useTenantSubscription();
  const { needsLogo, needsStripe, needsBonzah, allDone, isReady } =
    useSetupReminder();

  const tenantId = tenant?.id ?? null;

  // Null until the localStorage read for the *current* tenant has run, so
  // nothing renders before then — avoids an SSR/hydration mismatch, an open
  // flash, and showing tenant B the dialog using tenant A's flags.
  const [flags, setFlags] = useState<ReminderFlags | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !tenantId) {
      setFlags(null);
      return;
    }
    // sessionStorage: cleared when the tab/session ends, so opening the portal
    // again re-shows the reminder. Only "Don't show me again" (localStorage)
    // and actually completing the tasks stop it for good.
    setFlags({
      tenantId,
      permanentlyDismissed:
        localStorage.getItem(dismissedKey(tenantId)) === "true",
      dueBySnooze: sessionStorage.getItem(snoozedKey(tenantId)) !== "true",
    });
  }, [tenantId]);

  // Only surface the tasks that are still outstanding.
  const tasks: ReminderTask[] = [];
  if (needsBonzah) {
    tasks.push({
      key: "bonzah",
      label: "Bonzah insurance",
      description: "Offer collision & liability cover to your customers.",
      path: "/settings?tab=insurance",
      icon: (
        <>
          <img
            src="/bonzah-logo.svg"
            alt="Bonzah"
            className="h-5 w-auto dark:hidden"
          />
          <img
            src="/bonzah-logo-dark.svg"
            alt="Bonzah"
            className="hidden h-5 w-auto dark:block"
          />
        </>
      ),
    });
  }
  if (needsLogo) {
    tasks.push({
      key: "logo",
      label: "Upload your logo",
      description: "Brand your booking site and customer emails.",
      path: "/settings?tab=branding",
      icon: <ImageIcon className="h-5 w-5 text-muted-foreground" />,
    });
  }
  if (needsStripe) {
    tasks.push({
      key: "stripe",
      label: "Connect Stripe",
      description: "Accept live payments from your customers.",
      path: "/settings?tab=payments",
      icon: <CreditCard className="h-5 w-5 text-muted-foreground" />,
    });
  }

  const open =
    // Paywall interlock — never render alongside SubscriptionGateDialog.
    isResolved &&
    isSubscribed &&
    !hasExpiredSubscription &&
    // Setup state must be positively known; an errored query must not nag.
    isReady &&
    !allDone &&
    tasks.length > 0 &&
    !!flags &&
    flags.tenantId === tenantId &&
    !flags.permanentlyDismissed &&
    flags.dueBySnooze;

  // sessionStorage, so it silences the reminder for THIS portal session only —
  // next time the tenant opens the portal it shows again, until the tasks are
  // done or they explicitly pick "Don't show me again".
  const snoozeAndClose = () => {
    if (typeof window !== "undefined" && tenantId) {
      sessionStorage.setItem(snoozedKey(tenantId), "true");
    }
    setFlags((prev) => (prev ? { ...prev, dueBySnooze: false } : prev));
  };

  const dismissForever = () => {
    if (typeof window !== "undefined" && tenantId) {
      localStorage.setItem(dismissedKey(tenantId), "true");
    }
    setFlags((prev) => (prev ? { ...prev, permanentlyDismissed: true } : prev));
  };

  const handleSetup = (path: string) => {
    snoozeAndClose();
    router.push(path);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // X / outside-click / escape → silence for this session only.
        if (!next) snoozeAndClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <DialogTitle>Finish setting up your portal</DialogTitle>
          <DialogDescription>
            A few quick steps to get you fully live. Pick up where you left off.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {tasks.map((task) => (
            <div
              key={task.key}
              className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background">
                {task.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{task.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {task.description}
                </p>
              </div>
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => handleSetup(task.path)}
              >
                Set up
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter className="sm:justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground opacity-60 hover:opacity-100"
            onClick={dismissForever}
          >
            Don&apos;t show me again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
