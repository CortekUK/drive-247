"use client";

import { useEffect, useState } from "react";
import { Loader2, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { getApplyUrl } from "@/lib/booking-url";

interface TenantSettings {
  lead_management_enabled: boolean;
  automations_enabled: boolean;
  lead_stale_threshold_hours: number;
  lead_auto_lost_threshold_hours: number;
  communication_tone: "casual" | "friendly" | "professional";
}

export default function LeadManagementSettingsPage() {
  const { tenant, tenantSlug, refetchTenant } = useTenant() as ReturnType<typeof useTenant> & { refetchTenant: () => Promise<void> };
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!tenant?.id) return;
      const { data } = await supabase
        .from("tenants")
        .select("lead_management_enabled, automations_enabled, lead_stale_threshold_hours, lead_auto_lost_threshold_hours, communication_tone")
        .eq("id", tenant.id)
        .maybeSingle();
      if (data) setSettings(data as TenantSettings);
    };
    load();
  }, [tenant?.id]);

  const update = async (patch: Partial<TenantSettings>) => {
    if (!tenant?.id || !settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("admin-toggle-lead-management", {
        body: {
          tenantId: tenant.id,
          leadManagementEnabled: next.lead_management_enabled,
          automationsEnabled: next.automations_enabled,
          leadStaleThresholdHours: next.lead_stale_threshold_hours,
          leadAutoLostThresholdHours: next.lead_auto_lost_threshold_hours,
          communicationTone: next.communication_tone,
        },
      });
      if (error) throw error;
      toast.success("Saved");
      await refetchTenant?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const applyUrl = getApplyUrl(tenantSlug);

  if (!settings) {
    return (
      <main className="container mx-auto px-6 py-16 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#737373]" />
      </main>
    );
  }

  return (
    <main className="container mx-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="text-[30px] font-medium text-[#080812]">Lead Management</h1>
        <p className="mt-1 text-sm text-[#737373]">
          Configure your lead pipeline, automations, and apply form.
        </p>
      </header>

      <div className="space-y-6">
        <Section
          title="Module status"
          description="Turn the lead pipeline and (optionally) the automations engine on for your tenant."
        >
          <Row
            label="Lead Management"
            description="Adds /leads to the sidebar and exposes the apply form on your booking site."
          >
            <Switch
              checked={settings.lead_management_enabled}
              onCheckedChange={(v) => update({ lead_management_enabled: v })}
              disabled={saving}
            />
          </Row>
          <Row
            label="Automations"
            description="Adds /automations to the sidebar. Requires Lead Management."
          >
            <Switch
              checked={settings.automations_enabled}
              onCheckedChange={(v) => update({ automations_enabled: v })}
              disabled={saving || !settings.lead_management_enabled}
            />
          </Row>
        </Section>

        <Section title="Pipeline behaviour" description="Tune when leads go stale or auto-lost.">
          <Row label="Stale reminder threshold (hours)" description="When the second reminder SMS fires.">
            <Input
              type="number"
              min={1}
              max={168}
              value={settings.lead_stale_threshold_hours}
              onChange={(e) => setSettings({ ...settings, lead_stale_threshold_hours: Number(e.target.value) })}
              onBlur={() => update({ lead_stale_threshold_hours: settings.lead_stale_threshold_hours })}
              className="w-28"
              disabled={saving}
            />
          </Row>
          <Row label="Auto-lost threshold (hours)" description="When unresponsive leads are auto-moved to lost.">
            <Input
              type="number"
              min={24}
              max={720}
              value={settings.lead_auto_lost_threshold_hours}
              onChange={(e) => setSettings({ ...settings, lead_auto_lost_threshold_hours: Number(e.target.value) })}
              onBlur={() => update({ lead_auto_lost_threshold_hours: settings.lead_auto_lost_threshold_hours })}
              className="w-28"
              disabled={saving}
            />
          </Row>
        </Section>

        <Section title="Communication" description="How AI-drafted messages should sound.">
          <Row label="Tone">
            <Select
              value={settings.communication_tone}
              onValueChange={(v) => update({ communication_tone: v as TenantSettings["communication_tone"] })}
            >
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="casual">Casual</SelectItem>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </Section>

        <Section title="Apply link" description="Share this with your audiences to collect applications.">
          <Row label="Public URL">
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-[#f1f5f9] px-2 py-1 text-xs">{applyUrl || "—"}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(applyUrl);
                  toast.success("Copied");
                }}
                disabled={!applyUrl}
              >
                <Copy className="h-3 w-3" />
              </Button>
              {applyUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={applyUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              )}
            </div>
          </Row>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#f1f5f9] bg-white">
      <div className="border-b border-[#f1f5f9] px-5 py-3">
        <h2 className="text-base font-medium text-[#080812]">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-[#737373]">{description}</p>}
      </div>
      <div className="divide-y divide-[#f1f5f9]">{children}</div>
    </section>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <Label className="text-sm font-medium text-[#080812]">{label}</Label>
        {description && <p className="mt-0.5 text-xs text-[#737373]">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
