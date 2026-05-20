"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

export function OwnerPayoutsExportCard() {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const today = new Date();
  const [from, setFrom] = useState(format(subDays(today, 90), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(today, "yyyy-MM-dd"));
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!tenant?.id) return;
    setDownloading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("owner_payouts")
        .select("*, vehicle_owners!inner(full_name, email, phone)")
        .eq("tenant_id", tenant.id)
        .gte("period_end", from)
        .lte("period_start", to)
        .order("period_end", { ascending: false });
      if (error) throw error;

      const rows = (data || []).map((p: any) => ({
        owner_name: p.vehicle_owners?.full_name ?? "",
        owner_email: p.vehicle_owners?.email ?? "",
        owner_phone: p.vehicle_owners?.phone ?? "",
        period_start: p.period_start,
        period_end: p.period_end,
        gross_revenue: Number(p.gross_revenue),
        commission_amount: Number(p.commission_amount),
        refund_adjustments: Number(p.refund_adjustments),
        net_owed: Number(p.net_owed),
        amount_paid: Number(p.amount_paid),
        outstanding: Number(p.net_owed) - Number(p.amount_paid),
        status: p.status,
        payment_method: p.payment_method ?? "",
        payment_reference: p.payment_reference ?? "",
        paid_at: p.paid_at ?? "",
        created_at: p.created_at,
      }));

      if (rows.length === 0) {
        toast({ title: "No payouts in that range", description: "Try a different date range." });
        return;
      }

      const headers = Object.keys(rows[0]);
      const csv = [
        headers.join(","),
        ...rows.map((r: any) =>
          headers.map((h) => {
            const v = r[h];
            const s = v === null || v === undefined ? "" : String(v);
            return s.includes(",") || s.includes('"') || s.includes("\n")
              ? `"${s.replace(/"/g, '""')}"`
              : s;
          }).join(",")
        ),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `owner-payouts_${from}_to_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: `${rows.length} payout${rows.length === 1 ? "" : "s"} exported.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Export failed", description: msg, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-indigo-600" />
          <CardTitle>Owner Payouts Report</CardTitle>
        </div>
        <CardDescription>Export payouts to third-party vehicle owners as CSV.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="op-from">From</Label>
            <Input id="op-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="op-to">To</Label>
            <Input id="op-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <Button onClick={handleDownload} disabled={downloading} className="w-full">
          <Download className="h-4 w-4 mr-2" />
          {downloading ? "Preparing..." : "Download CSV"}
        </Button>
      </CardContent>
    </Card>
  );
}
