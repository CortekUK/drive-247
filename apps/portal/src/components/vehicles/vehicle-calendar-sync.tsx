"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarSync,
  Copy,
  RefreshCw,
  Check,
  ExternalLink,
  Link2,
  AlertCircle,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  vehicleId: string;
  vehicleReg: string;
}

interface SyncState {
  external_ical_enabled: boolean;
  external_ical_source: string;
  external_ical_url: string;
  external_ical_last_synced_at: string | null;
  external_ical_last_error: string | null;
}

const SOURCES: Record<
  string,
  { label: string; color: string; glow: string }
> = {
  turo:    { label: "Turo",        color: "#8B5CF6", glow: "139, 92, 246" },
  airbnb:  { label: "Airbnb",      color: "#FF385C", glow: "255, 56, 92" },
  vrbo:    { label: "Vrbo",        color: "#3B82F6", glow: "59, 130, 246" },
  booking: { label: "Booking.com", color: "#60A5FA", glow: "96, 165, 250" },
  other:   { label: "Other",       color: "#94A3B8", glow: "148, 163, 184" },
};

export function VehicleCalendarSync({ vehicleId, vehicleReg }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data } = useQuery({
    queryKey: ["vehicle-calendar-sync", vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select(
          "external_ical_enabled, external_ical_source, external_ical_url, external_ical_last_synced_at, external_ical_last_error",
        )
        .eq("id", vehicleId)
        .single();
      if (error) throw error;
      return data as unknown as SyncState;
    },
  });

  const { data: bookings } = useQuery({
    queryKey: ["external-bookings", vehicleId],
    queryFn: async () => {
      const { data } = await supabase
        .from("external_bookings")
        .select("id, start_date, end_date, summary, source")
        .eq("vehicle_id", vehicleId)
        .gte("end_date", new Date().toISOString().slice(0, 10))
        .order("start_date", { ascending: true })
        .limit(5);
      return (data || []) as any[];
    },
    refetchInterval: 30000,
  });

  const [draft, setDraft] = useState<SyncState | null>(null);
  const current = draft ?? data ?? {
    external_ical_enabled: false,
    external_ical_source: "turo",
    external_ical_url: "",
    external_ical_last_synced_at: null,
    external_ical_last_error: null,
  };

  const source = SOURCES[current.external_ical_source || "turo"] ?? SOURCES.turo;

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<SyncState>) => {
      const { error } = await supabase
        .from("vehicles")
        .update({
          external_ical_enabled: patch.external_ical_enabled,
          external_ical_source: patch.external_ical_source || null,
          external_ical_url: patch.external_ical_url || null,
        } as any)
        .eq("id", vehicleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-calendar-sync", vehicleId] });
      setDraft(null);
      toast({ title: "Sync settings saved" });
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const syncNowMutation = useMutation({
    mutationFn: async () => {
      const { data: result, error } = await supabase.functions.invoke(
        "sync-external-calendars",
        { body: { vehicle_id: vehicleId } },
      );
      if (error) throw error;
      return result;
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-calendar-sync", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["external-bookings", vehicleId] });
      toast({
        title: "Calendar synced",
        description: `Pulled ${result?.events ?? 0} bookings from ${source.label}`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    },
  });

  const exportUrl = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    return `${base}/functions/v1/vehicle-ical-export?vehicle_id=${vehicleId}&token=${vehicleId}`;
  }, [vehicleId]);

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportUrl);
      setCopied(true);
      toast({ title: "Copied", description: "Export URL copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const hasError = !!current.external_ical_last_error;
  const isSynced = !!current.external_ical_last_synced_at && !hasError;
  const lastSyncLabel = current.external_ical_last_synced_at
    ? formatDistanceToNow(new Date(current.external_ical_last_synced_at), { addSuffix: true })
    : "Never";

  const patch = (next: Partial<SyncState>) => setDraft({ ...current, ...next });
  const canSave = draft !== null;

  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #0B0B14 0%, #0A0A10 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.03) inset, 0 30px 60px -30px rgba(0,0,0,0.8)",
      }}
    >
      {/* Ambient glow from brand color */}
      <div
        aria-hidden
        className="absolute -top-40 -left-40 h-96 w-96 rounded-full blur-3xl pointer-events-none"
        style={{
          background: `radial-gradient(circle, rgba(${source.glow}, 0.25) 0%, transparent 70%)`,
        }}
      />
      <div
        aria-hidden
        className="absolute -top-40 right-0 h-80 w-80 rounded-full blur-3xl pointer-events-none"
        style={{
          background: `radial-gradient(circle, rgba(${source.glow}, 0.15) 0%, transparent 70%)`,
        }}
      />

      {/* Hero */}
      <div className="relative px-6 pt-6 pb-5 border-b border-white/5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className="relative h-12 w-12 rounded-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, rgba(${source.glow}, 0.25), rgba(${source.glow}, 0.05))`,
                border: `1px solid rgba(${source.glow}, 0.35)`,
                boxShadow: `0 0 24px rgba(${source.glow}, 0.25)`,
              }}
            >
              <CalendarSync className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base font-semibold text-white tracking-tight">
                  External Calendar Sync
                </h3>
                {current.external_ical_enabled && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                    style={{
                      background: `rgba(${source.glow}, 0.15)`,
                      color: source.color,
                      border: `1px solid rgba(${source.glow}, 0.3)`,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full animate-pulse"
                      style={{ background: source.color, boxShadow: `0 0 8px ${source.color}` }}
                    />
                    Live
                  </span>
                )}
              </div>
              <p className="text-sm text-white/50 max-w-lg leading-relaxed">
                Prevent double-bookings when{" "}
                <span className="text-white/80 font-medium">{vehicleReg}</span>{" "}
                is listed on Turo, Airbnb, or other platforms.
              </p>
            </div>
          </div>
          <Switch
            checked={current.external_ical_enabled}
            onCheckedChange={(v) => {
              patch({ external_ical_enabled: v });
              saveMutation.mutate({ ...current, external_ical_enabled: v });
            }}
          />
        </div>
      </div>

      <div className="relative px-6 py-6 space-y-6">
        {/* Status strip */}
        {current.external_ical_enabled && (
          <div
            className="flex items-center justify-between rounded-xl px-4 py-3"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div className="flex items-center gap-3">
              {hasError ? (
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                  }}
                >
                  <AlertCircle className="h-4 w-4 text-red-400" />
                </div>
              ) : isSynced ? (
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: "rgba(34, 197, 94, 0.12)",
                    border: "1px solid rgba(34, 197, 94, 0.3)",
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
              ) : (
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: "rgba(251, 191, 36, 0.12)",
                    border: "1px solid rgba(251, 191, 36, 0.3)",
                  }}
                >
                  <RefreshCw className="h-4 w-4 text-amber-400" />
                </div>
              )}
              <div>
                <div className="text-sm font-medium text-white">
                  {hasError ? "Sync failed" : isSynced ? "Synced" : "Awaiting first sync"}
                </div>
                <div className="text-xs text-white/50">
                  Last sync: <span className="text-white/70">{lastSyncLabel}</span>
                  {hasError && current.external_ical_last_error && (
                    <span className="text-red-400"> · {current.external_ical_last_error}</span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => syncNowMutation.mutate()}
              disabled={syncNowMutation.isPending || !current.external_ical_url}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/80 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncNowMutation.isPending ? "animate-spin" : ""}`}
              />
              Sync now
            </button>
          </div>
        )}

        {/* Import config */}
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div
              className="h-7 w-7 rounded-lg flex items-center justify-center"
              style={{
                background: `rgba(${source.glow}, 0.12)`,
                border: `1px solid rgba(${source.glow}, 0.25)`,
              }}
            >
              <Link2 className="h-3.5 w-3.5" style={{ color: source.color }} />
            </div>
            <h4 className="text-sm font-semibold text-white">
              Import from external platform
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/50 uppercase tracking-wider">
                Source
              </label>
              <Select
                value={current.external_ical_source || "turo"}
                onValueChange={(v) => patch({ external_ical_source: v })}
              >
                <SelectTrigger
                  className="h-11 bg-black/40 border-white/10 text-white hover:bg-black/60 hover:border-white/20 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: source.color,
                        boxShadow: `0 0 10px ${source.color}`,
                      }}
                    />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-[#0B0B14] border-white/10 text-white">
                  {Object.entries(SOURCES).map(([key, s]) => (
                    <SelectItem
                      key={key}
                      value={key}
                      className="text-white/80 focus:bg-white/5 focus:text-white"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            background: s.color,
                            boxShadow: `0 0 8px ${s.color}`,
                          }}
                        />
                        {s.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[11px] font-medium text-white/50 uppercase tracking-wider">
                iCal URL
              </label>
              <Input
                placeholder={
                  current.external_ical_source === "turo"
                    ? "https://turo.com/calendars/..."
                    : "https://..."
                }
                value={current.external_ical_url || ""}
                onChange={(e) => patch({ external_ical_url: e.target.value })}
                className="h-11 bg-black/40 border-white/10 text-white placeholder:text-white/30 font-mono text-xs focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:border-white/20"
              />
            </div>
          </div>

          {current.external_ical_source === "turo" && (
            <div
              className="rounded-xl p-4 text-xs"
              style={{
                background: `linear-gradient(135deg, rgba(${source.glow}, 0.08), rgba(${source.glow}, 0.02))`,
                border: `1px solid rgba(${source.glow}, 0.2)`,
              }}
            >
              <div
                className="font-semibold mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider"
                style={{ color: source.color }}
              >
                <Zap className="h-3 w-3" />
                How to get your Turo iCal link
              </div>
              <ol className="space-y-1 text-white/60">
                <li className="flex gap-2">
                  <span className="text-white/30 font-mono">01</span>
                  Open your vehicle on Turo
                </li>
                <li className="flex gap-2">
                  <span className="text-white/30 font-mono">02</span>
                  Click <span className="text-white/80 font-medium">Availability</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-white/30 font-mono">03</span>
                  Click <span className="text-white/80 font-medium">Export Calendar</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-white/30 font-mono">04</span>
                  Copy the link and paste it above
                </li>
              </ol>
            </div>
          )}

          {canSave && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate(current)}
                disabled={saveMutation.isPending}
                className="bg-white text-black hover:bg-white/90"
              >
                {saveMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDraft(null)}
                className="text-white/60 hover:text-white hover:bg-white/5"
              >
                Discard
              </Button>
            </div>
          )}
        </div>

        {/* Upcoming external bookings */}
        {current.external_ical_enabled && bookings && bookings.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <h4 className="text-sm font-semibold text-white pt-3">
              Upcoming external bookings
            </h4>
            <div className="space-y-1.5">
              {bookings.map((b) => {
                const s = SOURCES[b.source] ?? SOURCES.other;
                return (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-all hover:bg-white/[0.04]"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="h-6 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center"
                        style={{
                          color: s.color,
                          background: `rgba(${s.glow}, 0.12)`,
                          border: `1px solid rgba(${s.glow}, 0.25)`,
                        }}
                      >
                        {s.label}
                      </span>
                      <span className="text-sm text-white/80 truncate">
                        {b.summary || "Reserved"}
                      </span>
                    </div>
                    <span className="text-xs text-white/50 tabular-nums font-mono">
                      {b.start_date} → {b.end_date}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Export back */}
        <div className="space-y-3 pt-2 border-t border-white/5">
          <div className="flex items-center gap-2.5 pt-3">
            <div
              className="h-7 w-7 rounded-lg flex items-center justify-center"
              style={{
                background: "rgba(34, 197, 94, 0.12)",
                border: "1px solid rgba(34, 197, 94, 0.25)",
              }}
            >
              <ExternalLink className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <h4 className="text-sm font-semibold text-white">
              Export Drive247 bookings → paste into Turo
            </h4>
          </div>
          <p className="text-xs text-white/50 leading-relaxed">
            Paste this URL into Turo's calendar import so your Drive247 bookings block out the
            vehicle on Turo too. This creates full two-way sync.
          </p>
          <div className="flex gap-2">
            <code
              className="flex-1 text-xs rounded-lg px-3 py-2.5 font-mono truncate text-white/70"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {exportUrl}
            </code>
            <button
              onClick={copyExport}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium shrink-0 transition-all"
              style={{
                background: copied
                  ? "rgba(34, 197, 94, 0.15)"
                  : "rgba(255,255,255,0.03)",
                border: copied
                  ? "1px solid rgba(34, 197, 94, 0.3)"
                  : "1px solid rgba(255,255,255,0.08)",
                color: copied ? "#4ADE80" : "rgba(255,255,255,0.8)",
              }}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
