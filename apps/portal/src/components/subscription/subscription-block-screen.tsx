"use client";

import { ShieldAlert, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SubscriptionBlockScreenProps {
  onViewPlans: () => void;
}

export function SubscriptionBlockScreen({ onViewPlans }: SubscriptionBlockScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md">
      <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-2xl">
        {/* Colored top bar */}
        <div className="h-1.5 bg-gradient-to-r from-destructive via-destructive/80 to-orange-500" />

        <div className="p-8">
          <div className="flex flex-col items-center text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 ring-4 ring-destructive/5">
              <ShieldAlert className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Your subscription has ended
            </h2>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-xs">
              Your trial or subscription has expired. Subscribe to a plan to
              continue using the platform.
            </p>
            <Button onClick={onViewPlans} className="mt-8 w-full" size="lg">
              View Plans
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Need help?{" "}
              <a
                href="mailto:support@drive-247.com"
                className="text-primary hover:underline"
              >
                Contact support
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
