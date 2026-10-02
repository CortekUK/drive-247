"use client";

/**
 * Blocked customers — the dialog behind the Customers featured card
 * (Ghulam, Oct 2 2026: "a list of blocked customers… a blacklist as well… I
 * should be able to unblock a customer from this list").
 *
 * Two lists, as the full /blocked-customers page has them:
 *   Customers   people on your list with `is_blocked`, each with Unblock
 *               (`unblock_customer` RPC, via useCustomerBlockingActions).
 *   Blacklist   the identities you refuse — licence, ID, passport and email
 *               numbers in `blocked_identities` — each with Remove.
 *
 * Every write goes through the existing shared hook, so audit logging, cache
 * invalidation and the global-blacklist recount happen exactly as on the full
 * page. Both reads are filtered by tenant_id. A confirmation stands in front of
 * each unblock: it lets that person book again.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, CreditCard, Fingerprint, Loader2, Mail, Search, ShieldOff, UserX } from "lucide-react";
import Link from "next/link";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useBlockedIdentities, useCustomerBlockingActions } from "@/hooks/use-customer-blocking";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";
import { BlockedCustomersEmptyArt } from "@/components/illustrations-v2/scenes/blocked-customers";

type BlockedCustomer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
};

const ID_LABEL: Record<string, string> = {
  license: "License",
  id_card: "ID card",
  passport: "Passport",
  email: "Email",
  other: "Other",
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : null);

export function BlockedCustomersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const canManage = canEdit("blocked_customers");
  const [tab, setTab] = useState<"customers" | "blacklist">("customers");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<
    { kind: "customer"; id: string; name: string } | { kind: "identity"; id: string; name: string } | null
  >(null);

  const { unblockCustomer, removeBlockedIdentity } = useCustomerBlockingActions();
  const identities = useBlockedIdentities();
  const customers = useQuery({
    queryKey: ["blocked-customers", tenant?.id],
    queryFn: async (): Promise<BlockedCustomer[]> => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, email, phone, blocked_at, blocked_reason")
        .eq("tenant_id", tenant!.id) // ⚠️ isolation
        .eq("is_blocked", true)
        .order("blocked_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BlockedCustomer[];
    },
    enabled: open && !!tenant?.id,
  });

  const q = query.trim().toLowerCase();
  const customerRows = useMemo(
    () =>
      (customers.data ?? []).filter(
        (c) => !q || [c.name, c.email, c.phone, c.blocked_reason].some((v) => v?.toLowerCase().includes(q)),
      ),
    [customers.data, q],
  );
  const identityRows = useMemo(
    () =>
      (identities.data ?? []).filter(
        (i) => !q || [i.identity_number, i.customer_name, i.reason].some((v) => v?.toLowerCase().includes(q)),
      ),
    [identities.data, q],
  );

  const loading = tab === "customers" ? customers.isLoading : identities.isLoading;
  const rows = tab === "customers" ? customerRows : identityRows;
  const total = tab === "customers" ? customers.data?.length ?? 0 : identities.data?.length ?? 0;
  const pendingId =
    (unblockCustomer.isPending && unblockCustomer.variables) || (removeBlockedIdentity.isPending && removeBlockedIdentity.variables) || null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[86vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="space-y-1 px-6 pb-4 pt-6">
            <DialogTitle className="text-xl font-medium">Blocked customers</DialogTitle>
            <DialogDescription>People and IDs you won&rsquo;t rent to. Unblock anyone to let them book again.</DialogDescription>
          </DialogHeader>

          {/* Tabs + search */}
          <div className="flex flex-wrap items-center gap-2 border-b px-6 pb-3">
            <div className="inline-flex rounded-full bg-muted/60 p-1">
              {(
                [
                  ["customers", "Customers", customers.data?.length],
                  ["blacklist", "Blacklist", identities.data?.length],
                ] as const
              ).map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors duration-200 motion-reduce:transition-none",
                    tab === key
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {typeof n === "number" && <span className="text-xs tabular-nums text-muted-foreground">{n}</span>}
                </button>
              ))}
            </div>
            <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-full border bg-background px-3.5 focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/30 sm:w-56">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "customers" ? "Search people" : "Search IDs"}
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              />
            </label>
          </div>

          {/* The list */}
          <div className="no-scrollbar min-h-[280px] flex-1 overflow-y-auto px-3 py-2">
            {loading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="size-9 animate-pulse rounded-full bg-muted" />
                    <div className="h-3 w-40 animate-pulse rounded-full bg-muted" />
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-6 text-center">
                <BlockedCustomersEmptyArt className="max-w-[240px]" />
                <p className="mt-3 text-sm font-medium text-foreground">
                  {total === 0
                    ? tab === "customers"
                      ? "Nobody is blocked."
                      : "Your blacklist is empty."
                    : "Nothing matches that search."}
                </p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  {total === 0
                    ? tab === "customers"
                      ? "Block someone from their customer page and they'll show here."
                      : "IDs and emails you refuse land here — from a blocked customer, or added by hand."
                    : "Try a name, email, phone or ID number."}
                </p>
              </div>
            ) : tab === "customers" ? (
              <ul className="divide-y">
                {customerRows.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-xs font-semibold text-destructive">
                      {initials(c.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/customers/${c.id}`}
                        onClick={() => onOpenChange(false)}
                        className="block truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.blocked_reason || "No reason given"}
                        {ago(c.blocked_at) ? ` · blocked ${ago(c.blocked_at)}` : ""}
                      </p>
                    </div>
                    {canManage && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-full"
                        disabled={pendingId === c.id}
                        onClick={() => setConfirm({ kind: "customer", id: c.id, name: c.name })}
                      >
                        {pendingId === c.id ? <Loader2 className="animate-spin" /> : <ShieldOff />}
                        Unblock
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="divide-y">
                {identityRows.map((i) => {
                  const Icon = i.identity_type === "email" ? Mail : i.identity_type === "license" ? CreditCard : Fingerprint;
                  return (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                          <span className="truncate font-mono text-[13px]">{i.identity_number}</span>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] font-medium text-muted-foreground">
                            {ID_LABEL[i.identity_type] ?? i.identity_type}
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[i.customer_name, i.reason].filter(Boolean).join(" · ") || "No reason given"}
                        </p>
                      </div>
                      {canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 rounded-full"
                          disabled={pendingId === i.id}
                          onClick={() =>
                            setConfirm({ kind: "identity", id: i.id, name: `${ID_LABEL[i.identity_type] ?? "ID"} ${i.identity_number}` })
                          }
                        >
                          {pendingId === i.id ? <Loader2 className="animate-spin" /> : <ShieldOff />}
                          Remove
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between border-t px-6 py-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserX className="size-3.5" />
              {total} {tab === "customers" ? `blocked ${total === 1 ? "person" : "people"}` : `blacklisted ${total === 1 ? "ID" : "IDs"}`}
            </span>
            <Link
              href="/blocked-customers"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
            >
              Manage the full list
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "customer" ? `Unblock ${confirm.name}?` : `Remove ${confirm?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "customer"
                ? "They'll be able to book with you again, and their IDs come off your blacklist."
                : "This ID won't be refused any more — anyone using it can book again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep blocked</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "customer") {
                  unblockCustomer.mutate(confirm.id, { onSuccess: () => void customers.refetch() });
                } else {
                  removeBlockedIdentity.mutate(confirm.id);
                }
                setConfirm(null);
              }}
            >
              {confirm?.kind === "customer" ? "Unblock" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
