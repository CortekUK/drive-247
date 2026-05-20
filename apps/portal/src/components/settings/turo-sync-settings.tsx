"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CalendarSync,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface TenantSync {
  id: string;
  turo_ical_url: string | null;
  turo_ical_last_synced_at: string | null;
  turo_ical_last_error: string | null;
}

export function TuroSyncSettings() {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => ["tenant-turo-sync", tenant?.id],
    [tenant?.id],
  );

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!tenant?.id) return null;
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, turo_ical_url, turo_ical_last_synced_at, turo_ical_last_error",
        )
        .eq("id", tenant.id)
        .single();
      if (error) throw error;
      return data as unknown as TenantSync;
    },
    enabled: !!tenant?.id,
  });

  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const currentUrl = draftUrl ?? data?.turo_ical_url ?? "";
  const isDirty = draftUrl !== null && draftUrl !== (data?.turo_ical_url ?? "");

  const saveMutation = useMutation({
    mutationFn: async (url: string) => {
      if (!tenant?.id) throw new Error("No tenant");
      const { error } = await supabase
        .from("tenants")
        .update({ turo_ical_url: url || null } as any)
        .eq("id", tenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDraftUrl(null);
      toast({ title: "Turo link saved" });
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't save",
        description: e.message,
        variant: "destructive",
      }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data: result, error } = await supabase.functions.invoke(
        "sync-external-calendars",
        { body: { tenant_id: tenant?.id } },
      );
      if (error) throw error;
      return result;
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey });
      const t = result?.tenants;
      if (t?.matched > 0 || t?.unmatched > 0) {
        toast({
          title: "Synced from Turo",
          description: `${t.matched} reservation${t.matched === 1 ? "" : "s"} matched${
            t.unmatched
              ? `, ${t.unmatched} couldn't be matched to a vehicle`
              : ""
          }`,
        });
      } else {
        toast({
          title: "Synced from Turo",
          description: "No reservations in the feed",
        });
      }
    },
    onError: (e: any) =>
      toast({
        title: "Sync failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const hasUrl = !!data?.turo_ical_url;
  const hasError = !!data?.turo_ical_last_error;
  const isSynced = !!data?.turo_ical_last_synced_at && !hasError;
  const lastSyncLabel = data?.turo_ical_last_synced_at
    ? formatDistanceToNow(new Date(data.turo_ical_last_synced_at), {
        addSuffix: true,
      })
    : "Never";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarSync className="h-5 w-5 text-primary" />
          Turo Calendar Sync
        </CardTitle>
        <CardDescription>
          Paste your Turo iCal link once and we'll keep your fleet calendar in
          sync — every reservation in Turo will block the matching vehicle here
          automatically.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* The single input — only thing the user has to do */}
        <div className="space-y-2">
          <label
            htmlFor="turo-ical-url"
            className="text-sm font-medium text-foreground"
          >
            Turo iCal link
          </label>
          <div className="flex gap-2">
            <Input
              id="turo-ical-url"
              type="url"
              placeholder="https://turo.com/reservations/subscribe/ical.ics?driverId=…&key=…"
              value={currentUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <Button
              onClick={() => saveMutation.mutate(currentUrl.trim())}
              disabled={!isDirty || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2.5 flex gap-2.5 text-xs text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <div className="space-y-1">
              <p>
                <span className="font-medium text-foreground">
                  Where to find it in Turo:
                </span>{" "}
                Account → Calendar → Subscribe. Copy the full URL and paste it
                here.
              </p>
              <p>
                One link covers all your Turo vehicles. We match each
                reservation to the right car by reading the listing title — so
                make sure your Drive247 vehicle reg, make, or model matches
                what's in the Turo listing.
              </p>
            </div>
          </div>
        </div>

        {/* Status + sync now — only show once a URL is saved */}
        {hasUrl && (
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              {hasError ? (
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400">
                  <AlertCircle className="h-4 w-4" />
                </div>
              ) : isSynced ? (
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
              ) : (
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  <RefreshCw className="h-4 w-4" />
                </div>
              )}
              <div className="space-y-0.5">
                <div className="text-sm font-medium">
                  {hasError
                    ? "Last sync had a problem"
                    : isSynced
                      ? "Synced"
                      : "Awaiting first sync"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Last attempt: {lastSyncLabel}
                </div>
                {hasError && (
                  <div className="text-xs text-red-600 dark:text-red-400 max-w-md">
                    {data!.turo_ical_last_error}
                  </div>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${
                  syncMutation.isPending ? "animate-spin" : ""
                }`}
              />
              {syncMutation.isPending ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
