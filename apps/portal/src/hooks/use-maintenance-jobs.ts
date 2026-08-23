import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseUntyped as supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { invalidateFleetHealth } from "@/hooks/use-fleet-health";
import type { MaintenanceJob, JobStatus, JobPriority } from "@/types/fleet-health";

/**
 * Postgres error codes raised by the Fleet Health RPCs. Mapping them to plain
 * sentences matters: without this the operator sees a raw Postgres string and has
 * no idea whether the car is double-booked or on a ramp.
 */
const RPC_ERRORS: Record<string, string> = {
  "23P02": "That vehicle is already off the road for maintenance during those dates.",
  "23P03":
    "This vehicle has an active rental in that window. Swap the customer to another vehicle first.",
  "23P04":
    "That window clashes with existing bookings. Resolve them below, or confirm to override.",
};

function friendlyError(e: any, fallback: string): string {
  const code = e?.code ?? e?.details?.code;
  if (code && RPC_ERRORS[code]) return RPC_ERRORS[code];
  return e?.message ?? fallback;
}

export interface JobFilters {
  status?: JobStatus | "open" | "all";
  vehicleId?: string;
}

export function useMaintenanceJobs(filters: JobFilters = {}) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["maintenance-jobs", tenant?.id, filters.status, filters.vehicleId],
    queryFn: async (): Promise<MaintenanceJob[]> => {
      if (!tenant?.id) throw new Error("No tenant context available");

      let q = supabase
        .from("vehicle_maintenance_jobs")
        .select("*, vehicles(reg, make, model)")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });

      if (filters.vehicleId) q = q.eq("vehicle_id", filters.vehicleId);

      if (filters.status === "open") {
        q = q.not("status", "in", "(completed,cancelled)");
      } else if (filters.status && filters.status !== "all") {
        q = q.eq("status", filters.status);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MaintenanceJob[];
    },
    enabled: !!tenant?.id,
  });
}

export interface ScheduleMaintenanceInput {
  vehicleId: string;
  title: string;
  start: string;
  end: string;
  reasonCode?: string;
  priority?: JobPriority;
  category?: string | null;
  serviceType?: string | null;
  vendor?: string | null;
  notes?: string | null;
  ruleId?: string | null;
  /** Only ever set after the operator has seen and accepted the conflicts. */
  force?: boolean;
}

/**
 * Schedules a hold. The RPC writes the job, the blocked_dates row and the status
 * transition in ONE transaction — a partial write here would leave a vehicle either
 * invisibly bookable or permanently stuck off the road.
 */
export function useScheduleMaintenance() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: ScheduleMaintenanceInput) => {
      const { data, error } = await supabase.rpc("schedule_vehicle_maintenance", {
        p_vehicle_id: input.vehicleId,
        p_title: input.title,
        p_start: input.start,
        p_end: input.end,
        p_reason_code: input.reasonCode ?? "scheduled_service",
        p_priority: input.priority ?? "medium",
        p_category: input.category ?? null,
        p_service_type: input.serviceType ?? null,
        p_vendor: input.vendor ?? null,
        p_notes: input.notes ?? null,
        p_rule_id: input.ruleId ?? null,
        p_force: input.force ?? false,
      });
      if (error) throw error;
      return data as { job_id: string; blocked_date_id: string; conflicts: number };
    },
    onSuccess: () => {
      invalidateFleetHealth(qc);
      toast({
        title: "Maintenance scheduled",
        description: "The vehicle is now blocked for the selected window.",
      });
    },
    onError: (e: any) =>
      toast({
        title: "Could not schedule maintenance",
        description: friendlyError(e, "Failed to schedule maintenance"),
        variant: "destructive",
      }),
  });
}

export interface CompleteJobInput {
  jobId: string;
  serviceDate?: string;
  mileage?: number | null;
  cost?: number;
  description?: string | null;
}

/**
 * Completing a job writes exactly ONE service_records row. That row is what posts
 * to pnl_entries (reference 'service:<id>', idempotent) and re-derives the vehicle's
 * last-service fields — both via triggers that already existed.
 *
 * Deliberately does NOT also write a vehicle_expenses row: both tables post Cost
 * rows in the same 'Service' bucket under different reference namespaces with no
 * FK between them, so writing both would double the vehicle's service cost across
 * every P&L surface, invisibly.
 */
export function useCompleteMaintenanceJob() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CompleteJobInput) => {
      const { data, error } = await supabase.rpc("complete_vehicle_maintenance_job", {
        p_job_id: input.jobId,
        p_service_date: input.serviceDate ?? null,
        p_mileage: input.mileage ?? null,
        p_cost: input.cost ?? 0,
        p_description: input.description ?? null,
      });
      if (error) throw error;
      return data as {
        job_id: string;
        service_record_id: string;
        still_blocked?: boolean;
      };
    },
    onSuccess: (res) => {
      invalidateFleetHealth(qc);
      qc.invalidateQueries({ queryKey: ["serviceRecords"] });
      qc.invalidateQueries({ queryKey: ["plEntries"] });
      toast({
        title: "Job completed",
        description: res?.still_blocked
          ? "Logged to service history. The vehicle is still off the road — another block or job is open."
          : "Logged to service history and the vehicle is back on the road.",
      });
    },
    onError: (e: any) =>
      toast({
        title: "Could not complete job",
        description: friendlyError(e, "Failed to complete job"),
        variant: "destructive",
      }),
  });
}

/** Report a defect with no schedule — the "something is wrong with this car" path. */
export function useReportMaintenanceIssue() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      vehicleId: string;
      title: string;
      priority?: JobPriority;
      category?: string | null;
      notes?: string | null;
      rentalId?: string | null;
    }) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("vehicle_maintenance_jobs")
        .insert({
          tenant_id: tenant.id,
          vehicle_id: input.vehicleId,
          title: input.title,
          priority: input.priority ?? "medium",
          category: input.category ?? null,
          notes: input.notes ?? null,
          rental_id: input.rentalId ?? null,
          reported_by: appUser?.id ?? null,
          status: "reported",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateFleetHealth(qc);
      toast({ title: "Issue reported", description: "Added to the maintenance list." });
    },
    onError: (e: any) =>
      toast({
        title: "Could not report issue",
        description: e.message ?? "Failed to report issue",
        variant: "destructive",
      }),
  });
}

/**
 * Update a job's status, stamping who touched it.
 *
 * There is no assignment system, and deliberately so: 17 of 23 vehicle-owning
 * tenants have exactly one staff login. For the handful with 2-4 staff, showing
 * "acknowledged by X" is enough to stop two people both booking the same garage,
 * and costs almost nothing.
 */
export function useUpdateMaintenanceJob() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      status?: JobStatus;
      priority?: JobPriority;
      vendor_name?: string | null;
      notes?: string | null;
    }) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const patch: Record<string, unknown> = {};
      if (input.status) patch.status = input.status;
      if (input.priority) patch.priority = input.priority;
      if (input.vendor_name !== undefined) patch.vendor_name = input.vendor_name;
      if (input.notes !== undefined) patch.notes = input.notes;

      if (appUser?.id) {
        patch.acknowledged_by = appUser.id;
        patch.acknowledged_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("vehicle_maintenance_jobs")
        .update(patch)
        .eq("id", input.id)
        .eq("tenant_id", tenant.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateFleetHealth(qc);
      toast({ title: "Job updated" });
    },
    onError: (e: any) =>
      toast({
        title: "Could not update job",
        description: e.message ?? "Failed to update job",
        variant: "destructive",
      }),
  });
}
