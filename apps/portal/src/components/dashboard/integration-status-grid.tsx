"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  Shield,
  FileSignature,
  CircleDollarSign,
  ScanFace,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import type { ChecklistItem, IntegrationStatus } from "@/hooks/use-platform-status";

interface IntegrationCard {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  statusLabel: string;
  mode?: "test" | "live" | null;
  actionPath?: string;
  actionLabel?: string;
  metric?: { label: string; value: string; warning?: string; warningUrl?: string };
  secondaryMetric?: { label: string; value: string; warning?: string; warningUrl?: string };
}

const iconMap: Record<string, React.ElementType> = {
  stripe: CreditCard,
  bonzah: Shield,
  boldsign: FileSignature,
  credits: CircleDollarSign,
  veriff: ScanFace,
  notifications: MessageSquare,
};

const statusConfig: Record<
  IntegrationStatus,
  { dot: string; text: string; iconBg: string; iconText: string }
> = {
  live: {
    dot: "bg-green-500",
    text: "text-green-600 dark:text-green-400",
    iconBg: "bg-green-500/10",
    iconText: "text-green-600 dark:text-green-400",
  },
  test: {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  configured: {
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-600 dark:text-blue-400",
  },
  not_configured: {
    dot: "bg-muted-foreground/30",
    text: "text-muted-foreground",
    iconBg: "bg-muted",
    iconText: "text-muted-foreground",
  },
  coming_soon: {
    dot: "bg-muted-foreground/30",
    text: "text-muted-foreground",
    iconBg: "bg-muted",
    iconText: "text-muted-foreground",
  },
};

interface IntegrationStatusGridProps {
  integrations: IntegrationCard[];
}

function IntegrationStatusCardItem({
  integration,
}: {
  integration: IntegrationCard;
}) {
  const router = useRouter();
  const Icon = iconMap[integration.id] || CreditCard;
  const config = statusConfig[integration.status];

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 flex flex-col justify-between gap-4">
      <div className="space-y-3">
        {/* Icon + Name */}
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${config.iconBg}`}
          >
            <Icon className={`h-4 w-4 ${config.iconText}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {integration.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {integration.description}
            </p>
          </div>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
            <span className={`text-xs font-medium ${config.text}`}>
              {integration.statusLabel}
            </span>
          </div>
          {integration.mode && (
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0 h-4 font-semibold ${
                integration.mode === "live"
                  ? "bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/10"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              }`}
            >
              {integration.mode === "live" ? "LIVE" : "TEST"}
            </Badge>
          )}
          {integration.status === "coming_soon" && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4 font-medium"
            >
              COMING SOON
            </Badge>
          )}
        </div>

        {/* Metrics */}
        {(integration.metric || integration.secondaryMetric) && (
          <div className="flex items-center gap-4 pt-1">
            {integration.metric && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {integration.metric.label}
                </p>
                <p className="text-lg font-bold tabular-nums">
                  {integration.metric.value}
                </p>
              </div>
            )}
            {integration.secondaryMetric && (
              <div className="border-l border-border pl-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {integration.secondaryMetric.label}
                </p>
                <p className="text-lg font-bold tabular-nums">
                  {integration.secondaryMetric.value}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action */}
      {integration.actionPath && integration.status !== "coming_soon" && (
        <Button
          variant="secondary"
          size="sm"
          className="w-full text-xs h-8"
          onClick={() => router.push(integration.actionPath!)}
        >
          {integration.actionLabel}
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      )}
    </div>
  );
}

export function IntegrationStatusGrid({
  integrations,
}: IntegrationStatusGridProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">
        Integrations
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {integrations.map((integration) => (
          <IntegrationStatusCardItem
            key={integration.id}
            integration={integration}
          />
        ))}
      </div>
    </div>
  );
}
