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

const SNOOZE_MS = 24 * 60 * 60 * 1000;

interface ReminderTask {
  key: string;
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
}

/**
 * Recurring, dismissible nudge shown to a subscribed tenant who still has
 * outstanding setup tasks (logo, Stripe Connect, Bonzah insurance).
 *
 * Self-gates on `isSubscribed`, so it never appears while the hard subscription
 * paywall (SubscriptionGateDialog) is up. Closing it (X / outside-click / escape)
 * snoozes it for 24h; "Don't show me again" dismisses it permanently. Both are
 * stored per-tenant in localStorage.
 */
export function SetupReminderDialog() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { isSubscribed } = useTenantSubscription();
  const { needsLogo, needsStripe, needsBonzah, allDone, isLoading } =
    useSetupReminder();

  // Default both to false so nothing renders before the localStorage read runs
  // in the effect below — avoids an SSR/hydration mismatch and an open flash.
  const [permanentlyDismissed, setPermanentlyDismissed] = useState(false);
  const [dueBySnooze, setDueBySnooze] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !tenant?.id) return;
    const dismissed =
      localStorage.getItem(`setup-reminder-dismissed-${tenant.id}`) === "true";
    setPermanentlyDismissed(dismissed);

    const snoozedAt = localStorage.getItem(`setup-reminder-snoozed-${tenant.id}`);
    setDueBySnooze(!snoozedAt || Date.now() - Number(snoozedAt) > SNOOZE_MS);
  }, [tenant?.id]);

  const open =
    isSubscribed &&
    !allDone &&
    !isLoading &&
    !permanentlyDismissed &&
    dueBySnooze;

  const snoozeAndClose = () => {
    if (typeof window !== "undefined" && tenant?.id) {
      localStorage.setItem(
        `setup-reminder-snoozed-${tenant.id}`,
        Date.now().toString()
      );
    }
    setDueBySnooze(false);
  };

  const dismissForever = () => {
    if (typeof window !== "undefined" && tenant?.id) {
      localStorage.setItem(`setup-reminder-dismissed-${tenant.id}`, "true");
    }
    setPermanentlyDismissed(true);
  };

  const handleSetup = (path: string) => {
    snoozeAndClose();
    router.push(path);
  };

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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // X / outside-click / escape → snooze for 24h.
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
