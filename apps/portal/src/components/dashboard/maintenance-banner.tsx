"use client";

import { AlertTriangle, Info, AlertOctagon } from "lucide-react";
import { useMaintenanceBanner } from "@/hooks/use-maintenance-banner";

export function MaintenanceBanner() {
  const { global: globalBanner, tenant: tenantBanner, hasBanner } = useMaintenanceBanner();

  if (!hasBanner) return null;

  return (
    <div className="w-full">
      {globalBanner && (
        <BannerStrip message={globalBanner.message} type={globalBanner.type} />
      )}
      {tenantBanner && (
        <BannerStrip message={tenantBanner.message} type="warning" />
      )}
    </div>
  );
}

function BannerStrip({
  message,
  type,
}: {
  message: string;
  type: "info" | "warning" | "critical";
}) {
  const config = {
    info: {
      bg: "bg-blue-50 dark:bg-blue-950/40",
      border: "border-blue-200 dark:border-blue-800",
      text: "text-blue-800 dark:text-blue-200",
      icon: Info,
      iconColor: "text-blue-500 dark:text-blue-400",
    },
    warning: {
      bg: "bg-amber-50 dark:bg-amber-950/40",
      border: "border-amber-200 dark:border-amber-800",
      text: "text-amber-800 dark:text-amber-200",
      icon: AlertTriangle,
      iconColor: "text-amber-500 dark:text-amber-400",
    },
    critical: {
      bg: "bg-red-50 dark:bg-red-950/40",
      border: "border-red-200 dark:border-red-800",
      text: "text-red-800 dark:text-red-200",
      icon: AlertOctagon,
      iconColor: "text-red-500 dark:text-red-400",
    },
  };

  const c = config[type];
  const Icon = c.icon;

  return (
    <div className={`${c.bg} px-4 py-2.5 flex items-center justify-center gap-2`}>
      <Icon className={`h-4 w-4 shrink-0 ${c.iconColor}`} />
      <p className={`text-sm font-medium ${c.text} text-center`}>{message}</p>
    </div>
  );
}
