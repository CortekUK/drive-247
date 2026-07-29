import { FileSignature, type LucideIcon } from "lucide-react";

export interface UsageCategoryConfig {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  unitLabel: string;
  unitLabelPlural: string;
}

export interface UsageCategoryData {
  currentCount: number;
  currentCost: number;
  unitCost: number;
  events: UsageEvent[];
  monthlyAggregates: MonthlyAggregate[];
  isLoading: boolean;
  isLoadingHistory: boolean;
}

export interface UsageEvent {
  id: string;
  category: string;
  ref: string | null;
  customerName: string | null;
  unitCost: number;
  currency: string;
  createdAt: string;
  /**
   * Whether this event was accepted by Stripe's metered-billing endpoint, i.e.
   * whether it can actually reach an invoice. Recording usage locally and
   * reporting it for billing are two separate steps, and the second one can
   * fail on its own — so the panel must never state "recorded" as "billed".
   */
  reported: boolean;
}

export interface MonthlyAggregate {
  month: string; // YYYY-MM
  count: number;
  totalCost: number;
}

// Single registry — add new categories here
export const USAGE_CATEGORIES: UsageCategoryConfig[] = [
  {
    key: "esign",
    label: "E-Sign",
    icon: FileSignature,
    color: "#6366f1",
    unitLabel: "agreement",
    unitLabelPlural: "agreements",
  },
  // Future: { key: "sms", label: "SMS", icon: MessageSquare, color: "#2563eb", unitLabel: "message", unitLabelPlural: "messages" },
];

export function getCategoryConfig(key: string): UsageCategoryConfig | undefined {
  return USAGE_CATEGORIES.find((c) => c.key === key);
}
