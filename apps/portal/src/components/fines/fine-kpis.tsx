import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, PoundSterling, Calendar } from "lucide-react";

export const FineKPIs = () => {
  const { data: kpiData, isLoading } = useQuery({
    queryKey: ["fines-kpis"],
    queryFn: async () => {
      // Get all fines with basic info
      const { data: allFines, error: finesError } = await supabase
        .from("fines")
        .select("id, status, amount, due_date, liability")
        .order("created_at", { ascending: false });

      if (finesError) throw finesError;

      // Get outstanding amounts from ledger entries for charged customer fines
      const { data: ledgerData, error: ledgerError } = await supabase
        .from("ledger_entries")
        .select("remaining_amount")
        .eq("category", "Fine")
        .eq("type", "Charge")
        .gt("remaining_amount", 0);

      if (ledgerError) throw ledgerError;

      const openFines = allFines.filter(fine => fine.status === 'Open').length;
      const outstandingAmount = ledgerData.reduce((sum, entry) => sum + Number(entry.remaining_amount), 0);

      const today = new Date();
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

      const dueThisWeek = allFines.filter(fine => {
        const dueDate = new Date(fine.due_date);
        return dueDate >= today && 
               dueDate <= nextWeek && 
               (fine.status === 'Open' || fine.status === 'Charged');
      }).length;

      const overdue = allFines.filter(fine => {
        const dueDate = new Date(fine.due_date);
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
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Loading...</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20 hover:border-warning/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Open Fines</CardTitle>
          <AlertTriangle className="h-4 w-4 text-warning" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{kpiData?.openFines || 0}</div>
          <p className="text-xs text-muted-foreground">
            Awaiting action
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/20 hover:border-destructive/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Outstanding Amount</CardTitle>
          <PoundSterling className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">£{kpiData?.outstandingAmount?.toLocaleString() || 0}</div>
          <p className="text-xs text-muted-foreground">
            To collect from customers
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20 hover:border-warning/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Due This Week</CardTitle>
          <Calendar className="h-4 w-4 text-warning" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{kpiData?.dueThisWeek || 0}</div>
          <p className="text-xs text-muted-foreground">
            Next 7 days
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/20 hover:border-destructive/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Overdue</CardTitle>
          <Clock className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive">{kpiData?.overdue || 0}</div>
          <p className="text-xs text-muted-foreground">
            Past due date
          </p>
        </CardContent>
      </Card>
    </div>
  );
};