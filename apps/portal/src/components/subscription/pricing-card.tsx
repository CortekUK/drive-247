"use client";

import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PricingCardProps {
  onSubscribe: () => void;
  isLoading?: boolean;
}

const features = [
  "Full vehicle fleet management",
  "Customer management & verification",
  "Online booking & payments",
  "Automated invoicing & reminders",
  "Real-time chat with customers",
  "Reports & P&L dashboard",
  "Website content management",
  "Multi-user access with roles",
  "Stripe payment processing",
  "Insurance integrations",
];

export function PricingCard({ onSubscribe, isLoading }: PricingCardProps) {
  return (
    <div className="max-w-md mx-auto">
      <div className="rounded-xl border-2 border-primary bg-card p-8 shadow-lg">
        <div className="text-center mb-6">
          <h3 className="text-lg font-medium text-muted-foreground">
            Drive247 Pro
          </h3>
          <div className="mt-2 flex items-baseline justify-center gap-1">
            <span className="text-5xl font-bold tracking-tight">$200</span>
            <span className="text-muted-foreground">/month</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Everything you need to run your rental business
          </p>
        </div>

        <ul className="space-y-3 mb-8">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-3">
              <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <span className="text-sm">{feature}</span>
            </li>
          ))}
        </ul>

        <Button
          onClick={onSubscribe}
          disabled={isLoading}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Redirecting...
            </>
          ) : (
            "Subscribe Now"
          )}
        </Button>
      </div>
    </div>
  );
}
