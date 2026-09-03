"use client";

import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STRIPE_CONNECT_SETTINGS_PATH } from "@/lib/stripe-connect-status";

interface ConnectStripeRequiredDialogProps {
  open: boolean;
  /**
   * Omit on the /rentals/new route itself, where the dialog IS the page and
   * there is nothing behind it to dismiss back to. Provide it when the dialog
   * is raised from a button, so the operator can return to what they were on.
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Shown to a lean tenant who clicked New Rental without a usable Stripe Connect
 * account. It is a dead end by design — the rental form cannot produce anything
 * chargeable without Connect — so the only forward action is to go and set it up.
 *
 * Raised from every rental-creation entry point AND from the /rentals/new route
 * itself, so typing the URL cannot bypass it.
 */
export function ConnectStripeRequiredDialog({
  open,
  onOpenChange,
}: ConnectStripeRequiredDialogProps) {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // On the route itself there is no page behind the dialog, so closing it
        // would leave a blank screen. Suppress the escape hatches there only.
        onEscapeKeyDown={(e) => {
          if (!onOpenChange) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!onOpenChange) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!onOpenChange) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Connect Stripe to create rentals
          </DialogTitle>
          <DialogDescription>
            You need a connected Stripe account before you can take payments.
            Once Stripe is connected, you can create rentals as normal.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => router.push("/rentals")}>
            Back to rentals
          </Button>
          <Button onClick={() => router.push(STRIPE_CONNECT_SETTINGS_PATH)}>
            Set up Stripe Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConnectStripeRequiredDialog;
