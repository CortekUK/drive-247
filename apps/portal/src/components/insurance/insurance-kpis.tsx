import { Shield, CheckCircle, AlertTriangle, XCircle, Pause } from "lucide-react";
import { type InsuranceStats } from "@/hooks/use-insurance-data";
import { KpiTile } from "@/components/bento";

interface InsuranceKPIsProps {
  stats: InsuranceStats;
  isFiltered?: boolean;
}

export function InsuranceKPIs({ stats, isFiltered = false }: InsuranceKPIsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      <KpiTile
        variant="hero"
        label={`${isFiltered ? "Filtered" : "Total"} Policies`}
        value={stats.total}
        sub={isFiltered ? "in current view" : "all policies"}
        icon={<Shield className="h-4 w-4" />}
      />
      <KpiTile
        label="Active"
        value={stats.active}
        sub="policies active"
        icon={<CheckCircle className="h-4 w-4 text-[color:var(--bento-success)]" />}
      />
      <KpiTile
        label="Expiring Soon"
        value={stats.expiringSoon}
        sub="next 30 days"
        icon={<AlertTriangle className="h-4 w-4 text-[color:var(--bento-warn-accent)]" />}
      />
      <KpiTile
        label="Expired"
        value={stats.expired}
        sub="need renewal"
        icon={<XCircle className="h-4 w-4 text-[color:var(--bento-danger-fg)]" />}
      />
      <KpiTile
        label="Inactive"
        value={stats.inactive}
        sub="disabled"
        icon={<Pause className="h-4 w-4 text-[color:var(--bento-text-3)]" />}
      />
    </div>
  );
}
