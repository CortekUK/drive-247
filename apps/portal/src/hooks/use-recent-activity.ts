import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";

export interface ActivityItem {
  id: string;
  type: "payment" | "rental" | "vehicle" | "system";
  description: string;
  amount?: number;
  customer?: string;
  time: string;
  status: "success" | "pending" | "warning";
  created_at: string;
}

export const useRecentActivity = () => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["recent-activity", tenant?.id],
    queryFn: async () => {
      const activities: ActivityItem[] = [];

      // Fetch recent payments
      let paymentsQuery = supabase
        .from("payments")
        .select(`
          id,
          amount,
          payment_date,
          status,
          payment_type,
          created_at,
          customers(name)
        `)
        .order("created_at", { ascending: false })
        .limit(5);

      if (tenant?.id) {
        paymentsQuery = paymentsQuery.eq("tenant_id", tenant.id);
      }

      const { data: payments } = await paymentsQuery;

      if (payments) {
        payments
          .filter(payment => payment.customers)
          .forEach((payment) => {
            activities.push({
              id: payment.id,
              type: "payment",
              description: `${payment.payment_type} received`,
              amount: Number(payment.amount),
              customer: (payment.customers as any)?.name,
              time: formatDistanceToNow(new Date(payment.created_at), { addSuffix: true }),
              status: payment.status === "Applied" ? "success" : payment.status === "Credit" ? "pending" : "warning",
              created_at: payment.created_at
            });
          });
      }

      // Fetch recent rentals
      let rentalsQuery = supabase
        .from("rentals")
        .select(`
          id,
          status,
          created_at,
          customers(name),
          vehicles(reg)
        `)
        .order("created_at", { ascending: false })
        .limit(5);

      if (tenant?.id) {
        rentalsQuery = rentalsQuery.eq("tenant_id", tenant.id);
      }

      const { data: rentals } = await rentalsQuery;

      if (rentals) {
        rentals
          .filter(rental => rental.customers && rental.vehicles)
          .forEach((rental) => {
            activities.push({
              id: rental.id,
              type: "rental",
              description: `New rental agreement signed`,
              customer: (rental.customers as any)?.name,
              time: formatDistanceToNow(new Date(rental.created_at), { addSuffix: true }),
              status: rental.status === "Active" ? "success" : "pending",
              created_at: rental.created_at
            });
          });
      }

      // Fetch recent vehicles
      let vehiclesQuery = supabase
        .from("vehicles")
        .select("id, reg, make, model, status, created_at")
        .order("created_at", { ascending: false })
        .limit(3);

      if (tenant?.id) {
        vehiclesQuery = vehiclesQuery.eq("tenant_id", tenant.id);
      }

      const { data: vehicles } = await vehiclesQuery;

      if (vehicles) {
        vehicles.forEach((vehicle) => {
          activities.push({
            id: vehicle.id,
            type: "vehicle",
            description: `${vehicle.make} ${vehicle.model} added to fleet`,
            time: formatDistanceToNow(new Date(vehicle.created_at), { addSuffix: true }),
            status: vehicle.status === "Available" ? "success" : "pending",
            created_at: vehicle.created_at
          });
        });
      }

      // Fetch recent audit logs
      let auditLogsQuery = supabase
        .from("audit_logs")
        .select("id, action, created_at, details")
        .order("created_at", { ascending: false })
        .limit(3);

      if (tenant?.id) {
        auditLogsQuery = auditLogsQuery.eq("tenant_id", tenant.id);
      }

      const { data: auditLogs } = await auditLogsQuery;

      if (auditLogs) {
        auditLogs.forEach((log) => {
          activities.push({
            id: log.id,
            type: "system",
            description: log.action.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
            time: formatDistanceToNow(new Date(log.created_at), { addSuffix: true }),
            status: "success",
            created_at: log.created_at
          });
        });
      }

      // Sort all activities by created_at and return top 10
      return activities
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10);
    },
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
};