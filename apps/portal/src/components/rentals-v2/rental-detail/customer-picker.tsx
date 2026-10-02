"use client";

/**
 * Picking who rents — the Customer stage's "cleared" state.
 *
 * "Clear customer" does not open a dialog: the stage goes back to the state a
 * rental is in before it has a customer, in the main pane — a search list on
 * the left, the person you are looking at on the right, and one button to put
 * them on the rental. Nothing is written by clearing; the rental keeps its
 * customer until another one is chosen, so walking away changes nothing.
 *
 * Allowed only while the rental has not moved past its first four stages
 * (Customer, Vehicle, When & where, Extras). The rule lives in ONE place, the
 * `change_rental_customer_v2` database function: the stage asks it with
 * `p_dry_run` to decide whether to offer Clear (and to say why not), and the
 * same function guards the write. So the button and the database cannot
 * disagree about what is allowed.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Star, ShieldCheck, ShieldAlert, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { CustomersEmptyArt } from "@/components/illustrations-v2/empty-scenes";
import { cardCls, fmtDate, initials } from "./_kit";

/** "May this rental change customer?" — the database's answer, never a guess. */
export function useCustomerSwitchable(rentalId: string) {
  return useQuery({
    queryKey: ["rental-customer-switchable-v2", rentalId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("change_rental_customer_v2", {
        p_rental_id: rentalId,
        p_new_customer_id: null,
        p_dry_run: true,
      });
      if (error) throw error;
      return data as { ok: boolean; reason?: string };
    },
    enabled: !!rentalId,
    // Always ask again: the answer changes the moment a payment, an agreement
    // or a policy lands — often from another tab or another person. The app's
    // 60s cache and no-refetch-on-focus would keep showing a stale "no".
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_blocked: boolean | null;
  blocked_reason: string | null;
  created_at: string | null;
  identity_verification_status: string | null;
  license_number: string | null;
  /** PostgREST embedded count — every rental this customer has (they belong to one tenant). */
  rentals: { count: number }[] | null;
  customer_review_summaries: { average_rating: number | null; total_reviews: number | null }[] | null;
};

/** What the operator needs to decide, read straight off the customer row. */
function idStatus(status: string | null) {
  switch (status) {
    case "verified":
      return { label: "Trax ID", tone: "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]", ok: true };
    case "manually_verified":
      return { label: "In person", tone: "text-success", ok: true };
    case "pending":
      return { label: "ID in review", tone: "text-muted-foreground", ok: false };
    case "rejected":
      return { label: "ID failed", tone: "text-destructive", ok: false };
    default:
      return { label: "Not verified", tone: "text-muted-foreground", ok: false };
  }
}

export function CustomerPicker({
  rentalId,
  currentCustomerId,
  onDone,
}: {
  rentalId: string;
  currentCustomerId: string | null;
  /** Leave the picker — after a change lands, or to keep the current customer. */
  onDone: (changed: boolean) => void;
}) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const q = term.trim();

  /* Only once something is typed: an empty search is the illustrated empty
     state, not a roster of everyone. */
  const results = useQuery({
    queryKey: ["rental-customer-picker-v2", tenant?.id, q],
    queryFn: async () => {
      // Commas and brackets would break PostgREST's or() grammar.
      const safe = q.replace(/[,()]/g, " ");
      const { data, error } = await supabase
        .from("customers")
        .select(
          `id, name, email, phone, is_blocked, blocked_reason, created_at,
           identity_verification_status, license_number,
           rentals!rentals_customer_id_fkey(count),
           customer_review_summaries(average_rating, total_reviews)`
        )
        .eq("tenant_id", tenant!.id)
        .or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order("name")
        .limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as CustomerRow[];
    },
    enabled: !!tenant?.id && q.length > 0,
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(
    () => (q ? (results.data ?? []).filter((c) => c.id !== currentCustomerId) : []),
    [results.data, currentCustomerId, q]
  );

  const change = useMutation({
    mutationFn: async (customer: CustomerRow) => {
      const { data, error } = await (supabase as any).rpc("change_rental_customer_v2", {
        p_rental_id: rentalId,
        p_new_customer_id: customer.id,
        p_dry_run: false,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason ?? "The customer was not changed.");
      return customer;
    },
    onSuccess: (customer) => {
      toast({ title: `This rental is now ${customer.name}'s.` });
      void queryClient.invalidateQueries({ queryKey: ["rental-detail-v2", rentalId] });
      void queryClient.invalidateQueries({ queryKey: ["rental-customer-switchable-v2", rentalId] });
      onDone(true);
    },
    onError: (e: Error) => toast({ title: "The customer was not changed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* ── search, across the top ─────────────────────────────────────── */}
      <label className={cn(cardCls, "flex h-14 shrink-0 items-center gap-3 px-5 text-sm focus-within:ring-3 focus-within:ring-ring/30")}>
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setPicked(null);
          }}
          placeholder="Who is renting? Search by name, email or phone"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        {q && results.data && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "match" : "matches"}
          </span>
        )}
      </label>

      {/* ── nothing typed: the illustrated empty state ─────────────────── */}
      {!q ? (
        <div className={cn(cardCls, "flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center")}>
          <CustomersEmptyArt className="w-full max-w-[320px]" />
          <div>
            <p className="font-heading text-base font-semibold">Who is renting this one?</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Start typing a name, email or phone number. Nothing changes until you put someone on the rental.
            </p>
          </div>
        </div>
      ) : (
        /* ── typed: the list, with enough on each row to decide ───────────
           Scrolls inside its own card — the pane itself never does. */
        <div className={cn(cardCls, "min-h-0 flex-1 overflow-hidden p-0")}>
          <div className="h-full overflow-y-auto no-scrollbar p-2">
            {results.isLoading ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Looking…</p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nobody matches “{q}”.</p>
            ) : (
              rows.map((c) => {
                const active = picked === c.id;
                const id = idStatus(c.identity_verification_status);
                const count = c.rentals?.[0]?.count ?? 0;
                const summary = c.customer_review_summaries?.[0];
                const rating = summary?.average_rating != null ? Number(summary.average_rating) / 2 : null;
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={c.is_blocked ? -1 : 0}
                    aria-pressed={active}
                    aria-disabled={!!c.is_blocked}
                    onClick={() => !c.is_blocked && setPicked(c.id)}
                    onKeyDown={(e) => {
                      if (!c.is_blocked && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setPicked(c.id);
                      }
                    }}
                    title={c.is_blocked ? `${c.name} is blocked${c.blocked_reason ? `: ${c.blocked_reason}` : ""}.` : undefined}
                    className={cn(
                      "relative grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-6 rounded-2xl px-4 py-3 outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none",
                      c.is_blocked
                        ? "cursor-not-allowed opacity-50"
                        : active
                          ? "cursor-pointer bg-primary/10"
                          : "cursor-pointer hover:bg-foreground/[0.04]"
                    )}
                  >
                    {/* who */}
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                          active ? "bg-primary text-primary-foreground" : "bg-primary-light text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                        )}
                      >
                        {initials(c.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          {c.name}
                          {c.is_blocked && <Ban className="size-3.5 shrink-0 text-destructive" />}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}
                        </p>
                      </div>
                    </div>

                    {/* identity */}
                    <div className="min-w-0">
                      <p className={cn("flex items-center gap-1.5 truncate text-xs font-medium", id.tone)}>
                        {id.ok ? <ShieldCheck className="size-3.5 shrink-0" /> : <ShieldAlert className="size-3.5 shrink-0" />}
                        {id.label}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {c.license_number ? "Licence on file" : "No licence on file"}
                      </p>
                    </div>

                    {/* staff rating */}
                    <div className="min-w-0">
                      {rating != null ? (
                        <p className="flex items-center gap-1 text-xs font-medium">
                          <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                          {rating.toFixed(1)}
                          <span className="font-normal text-muted-foreground">
                            · {summary?.total_reviews ?? 0} {summary?.total_reviews === 1 ? "review" : "reviews"}
                          </span>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No reviews</p>
                      )}
                    </div>

                    {/* history */}
                    <div className="min-w-0">
                      <p className="text-xs font-medium">
                        {count} {count === 1 ? "rental" : "rentals"}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {c.created_at ? `Since ${fmtDate(c.created_at)}` : "New"}
                      </p>
                    </div>

                    {/* the decision — laid over the row's right end, so the
                        four columns always span the full width and nothing
                        shifts when a row is picked. */}
                    {active && (
                      <div className="absolute inset-y-0 right-0 flex items-center rounded-r-2xl pl-20 pr-3 [background:linear-gradient(to_left,hsl(var(--primary)/0.1)_65%,transparent),linear-gradient(to_left,hsl(var(--card))_65%,transparent)]">
                        <Button
                          size="sm"
                          disabled={change.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            change.mutate(c);
                          }}
                        >
                          {change.isPending ? "Saving…" : `Use ${c.name.split(" ")[0]}`}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
