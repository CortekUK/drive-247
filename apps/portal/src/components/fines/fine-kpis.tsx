import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { KpiTile, KpiTileSkeletonRow } from "@/components/bento";
import { AlertTriangle, Coins, CalendarClock, Clock } from "lucide-react";

export const FineKPIs = () => {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  const { data: kpiData, isLoading } = useQuery({
    queryKey: ["fines-kpis", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      // Get all fines for this tenant
      const { data: allFines, error: finesError } = await supabase
        .from("fines")
        .select("id, status, amount, due_date")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });

      if (finesError) throw finesError;

      const openFines = allFines.filter(fine => fine.status === 'Open').length;

      // Outstanding = total amount of all Open + Charged fines (not Waived/Paid)
      const outstandingAmount = allFines
        .filter(fine => fine.status === 'Open' || fine.status === 'Charged')
        .reduce((sum, fine) => sum + Number(fine.amount), 0);

      const today = new Date();
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

      const dueThisWeek = allFines.filter(fine => {
        const dueDate = new Date(fine.due_date + 'T00:00:00');
        return dueDate >= today &&
               dueDate <= nextWeek &&
               (fine.status === 'Open' || fine.status === 'Charged');
      }).length;

      const overdue = allFines.filter(fine => {
        const dueDate = new Date(fine.due_date + 'T00:00:00');
        return dueDate < today &&
               (fine.status === 'Open' || fine.status === 'Charged');
      }).length;

      return {
        openFines,
        outstandingAmount,
        dueThisWeek,
        overdue
      };
    },
    enabled: !!tenant,
  });

  if (isLoading) {
    return <KpiTileSkeletonRow count={4} />;
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiTile
        label="Open Fines"
        value={kpiData?.openFines || 0}
        sub="Awaiting action"
        icon={<AlertTriangle className="h-4 w-4" />}
      />
      <KpiTile
        label="Outstanding Amount"
        variant="feature"
        value={kpiData?.outstandingAmount || 0}
        noCountUp
        format={(v) => (
          <span className="font-mono tabular-nums">
            {formatCurrency(v, currencyCode)}
          </span>
        )}
        sub="To collect from customers"
        icon={<Coins className="h-4 w-4" />}
      />
      <KpiTile
        label="Due This Week"
        value={kpiData?.dueThisWeek || 0}
        sub="Next 7 days"
        icon={<CalendarClock className="h-4 w-4" />}
      />
      <KpiTile
        label="Overdue"
        variant={(kpiData?.overdue || 0) > 0 ? "warn" : "default"}
        value={kpiData?.overdue || 0}
        sub="Past due date"
        icon={<Clock className="h-4 w-4" />}
      />
    </div>
  );
};
