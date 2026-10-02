"use client";

/**
 * Draft rentals — "New Rental" without a form (v2, northwind).
 *
 * New Rental creates the rental straight away and opens it: the operator fills
 * it in stage by stage on the rental's own page instead of in a create form.
 *
 * The database has no Draft status (`rentals_status_check` allows Pending,
 * Active, Closed, Rejected, Cancelled), so a draft is stored as **Pending with
 * no customer yet** — the status the old create flow already wrote — and the
 * v2 screens call it a Draft. Verified on prod before shipping, in a rolled-
 * back insert: the row passes every insert trigger; with no end date the
 * charge generator creates nothing; with no car the overlap check and the
 * car-status trigger do nothing; the platform alert skips test tenants. The
 * one side effect is the usual "New Booking Pending" staff notification.
 *
 * Drafts stay out of the rentals list, its counts and the calendar on their
 * own: `use-enhanced-rentals` drops rows with no customer or car, and the
 * timeline drops rows with neither. This strip is where they are found again.
 */

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { FilePen, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { tenantToday } from "@/components/timeline-v2/model";

type DraftRow = { id: string; rental_number: string | null; created_at: string | null };

const draftsKey = (tenantId?: string) => ["rental-drafts", tenantId] as const;

/** Pending rentals with nobody on them yet — this tenant only. */
export function useRentalDrafts() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: draftsKey(tenant?.id),
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select("id, rental_number, created_at")
        .eq("tenant_id", tenant!.id)
        .eq("status", "Pending")
        .is("customer_id", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as DraftRow[];
    },
  });
}

/**
 * Create an empty rental and open it on its Customer stage. `replace` when the
 * caller is a page that should not stay in history (`/rentals/new`), so Back
 * does not land on it and start another draft.
 */
export function useCreateDraftRental({ replace = false }: { replace?: boolean } = {}) {
  const { tenant } = useTenant();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("rentals")
        .insert({
          tenant_id: tenant.id,
          start_date: tenantToday(tenant.timezone),
          monthly_amount: 0,
          status: "Pending",
          document_status: "pending",
          source: "portal",
          rental_period_type: "Daily",
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: draftsKey(tenant?.id) });
      const to = `/rentals/${id}?stage=customer`;
      if (replace) router.replace(to);
      else router.push(to);
    },
    onError: (e) =>
      toast({
        title: "The rental could not be started",
        description: e instanceof Error ? e.message : "Try again in a moment.",
        variant: "destructive",
      }),
  });
}

/** The drafts, as one quiet row above the list. Nothing when there are none. */
export function RentalDrafts() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { data: drafts = [] } = useRentalDrafts();

  // Only an untouched draft is removed here: still Pending, still nobody on it.
  const discard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("rentals")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenant!.id)
        .eq("status", "Pending")
        .is("customer_id", null);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: draftsKey(tenant?.id) }),
  });

  if (!drafts.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <FilePen className="size-3.5" />
        Drafts
      </span>
      {drafts.map((d) => (
        <span
          key={d.id}
          className="group inline-flex items-center gap-1 rounded-full bg-primary/[0.07] py-1 pl-3 pr-1 text-[12px] text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
        >
          <Link href={`/rentals/${d.id}?stage=customer`} className="font-medium hover:underline">
            {d.rental_number ?? "Draft"}
          </Link>
          {d.created_at && (
            <span className="text-primary/60 dark:text-[hsl(var(--v2-link,var(--primary))/0.6)]">
              · {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
            </span>
          )}
          <button
            type="button"
            aria-label={`Discard draft ${d.rental_number ?? ""}`}
            title="Discard this draft"
            disabled={discard.isPending}
            onClick={() => discard.mutate(d.id)}
            className="ml-0.5 rounded-full p-1 hover:bg-primary/10"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * `/rentals/new` for v2: every link that still points at the create form
 * (search, featured cards, tours, the dashboard) lands here, which starts a
 * draft and steps straight into it. Started once — the ref survives React's
 * double-invoked effects in development.
 */
export function StartDraftRental() {
  const { tenant } = useTenant();
  const create = useCreateDraftRental({ replace: true });
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !tenant?.id) return;
    started.current = true;
    create.mutate();
  }, [tenant?.id, create]);
  return (
    <div className="flex h-[60svh] flex-col items-center justify-center gap-2 text-center">
      <FilePen className="size-6 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
      <p className="text-[14px] font-medium">{create.isError ? "The rental could not be started" : "Starting a new rental…"}</p>
      {create.isError && (
        <Link href="/rentals" className="text-[13px] text-primary hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]">
          Back to rentals
        </Link>
      )}
    </div>
  );
}
