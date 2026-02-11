"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";

const DISMISSED_KEY = "subscription-gate-dismissed";

interface SubscriptionGateDialogProps {
  isSubscribed: boolean;
  isLoading: boolean;
}

export function SubscriptionGateDialog({
  isSubscribed,
  isLoading,
}: SubscriptionGateDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Don't show for subscribed tenants or while loading
    if (isSubscribed || isLoading) return;

    // Check if already dismissed this session
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    // Show after 4-second delay
    const timer = setTimeout(() => {
      setOpen(true);
    }, 4000);

    return () => clearTimeout(timer);
  }, [isSubscribed, isLoading]);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, "true");
    setOpen(false);
  };

  const handleUpgrade = () => {
    sessionStorage.setItem(DISMISSED_KEY, "true");
    setOpen(false);
    router.push("/settings?tab=subscription");
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Crown className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">
            Upgrade to Drive247 Pro
          </DialogTitle>
          <DialogDescription className="text-center">
            Subscribe to unlock the full platform and keep your rental business
            running smoothly. Just $200/month for everything you need.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={handleUpgrade} className="w-full">
            View Plans
          </Button>
          <Button
            variant="ghost"
            onClick={handleDismiss}
            className="w-full"
          >
            Maybe Later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
