"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

const STEPS = [
  { key: "about", label: "About you", required: true, fields: ["fullName", "dateOfBirth", "email", "phone", "addressLine1", "city", "state", "postalCode"] },
  { key: "driver", label: "Driver details", required: true, fields: ["licenceNumber", "licenceState", "licenceExpiry", "yearsDriving"] },
  { key: "intent", label: "Rental intent", required: true, fields: ["purpose", "neededByDate", "rentalLengthTarget", "vehicleInterestType", "startDate", "endDate"] },
  { key: "financial", label: "Financial readiness", required: false, fields: ["canPayDeposit", "depositComfortAmount", "weeklyBudget"] },
  { key: "history", label: "Rental history", required: false, fields: ["rentedBefore", "rentedFromUsBefore", "rideshareAccountActive"] },
  { key: "documents", label: "Documents", required: false, fields: ["licencePhotoUrl", "selfieUrl", "rideshareProofUrl"] },
  { key: "review", label: "Review & submit", required: true, fields: [] },
];

interface FormConfig {
  hidden_steps: string[];
  required_overrides: Record<string, string[]>;
  welcome_message: string | null;
}

export default function ApplyFormSettingsPage() {
  const { tenant } = useTenant();
  const [config, setConfig] = useState<FormConfig>({
    hidden_steps: [],
    required_overrides: {},
    welcome_message: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant?.id) return;
    const load = async () => {
      const { data } = await supabase
        .from("apply_form_config")
        .select("hidden_steps, required_overrides, welcome_message")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (data) {
        setConfig({
          hidden_steps: data.hidden_steps ?? [],
          required_overrides: (data.required_overrides as Record<string, string[]>) ?? {},
          welcome_message: data.welcome_message ?? "",
        });
      }
    };
    load();
  }, [tenant?.id]);

  const save = async (next: FormConfig) => {
    if (!tenant?.id) return;
    setConfig(next);
    setSaving(true);
    try {
      const { error } = await supabase
        .from("apply_form_config")
        .upsert({
          tenant_id: tenant.id,
          hidden_steps: next.hidden_steps,
          required_overrides: next.required_overrides,
          welcome_message: next.welcome_message,
        });
      if (error) throw error;
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleStep = (stepKey: string, hidden: boolean) => {
    const set = new Set(config.hidden_steps);
    if (hidden) set.add(stepKey);
    else set.delete(stepKey);
    save({ ...config, hidden_steps: Array.from(set) });
  };

  const toggleFieldRequired = (stepKey: string, field: string, makeRequired: boolean) => {
    const next = { ...config.required_overrides };
    const list = new Set(next[stepKey] ?? []);
    if (makeRequired) list.add(field);
    else list.delete(field);
    next[stepKey] = Array.from(list);
    save({ ...config, required_overrides: next });
  };

  return (
    <main className="container mx-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="text-[30px] font-medium text-[#080812]">Apply form</h1>
        <p className="mt-1 text-sm text-[#737373]">
          Tailor the public apply form to your tenant. Toggle steps + extra required fields.
          Phase 4 will add custom fields, conditional logic, and drag-drop reorder.
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-[#f1f5f9] bg-white p-5">
        <Label className="mb-2 block text-sm font-medium">Welcome message (optional)</Label>
        <Textarea
          rows={3}
          value={config.welcome_message ?? ""}
          onChange={(e) => setConfig({ ...config, welcome_message: e.target.value })}
          onBlur={() => save(config)}
          placeholder="Hi there — thanks for considering us. Tell us a bit about you and we'll be in touch."
        />
      </section>

      <section className="rounded-lg border border-[#f1f5f9] bg-white">
        <div className="border-b border-[#f1f5f9] px-5 py-3">
          <h2 className="text-base font-medium text-[#080812]">Steps</h2>
          <p className="text-xs text-[#737373]">Hide optional steps you don't need. Required steps cannot be hidden.</p>
        </div>
        <div className="divide-y divide-[#f1f5f9]">
          {STEPS.map((step) => {
            const isHidden = config.hidden_steps.includes(step.key);
            const overrides = config.required_overrides[step.key] ?? [];
            return (
              <div key={step.key} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-sm font-medium">{step.label}</Label>
                    <p className="text-xs text-[#737373]">
                      {step.required ? "Required step" : "Optional — can be hidden"}
                    </p>
                  </div>
                  <Switch
                    checked={!isHidden}
                    onCheckedChange={(v) => toggleStep(step.key, !v)}
                    disabled={step.required || saving}
                    aria-label={`${step.label} visibility`}
                  />
                </div>
                {step.fields.length > 0 && !isHidden && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {step.fields.map((f) => {
                      const required = overrides.includes(f);
                      return (
                        <button
                          type="button"
                          key={f}
                          onClick={() => toggleFieldRequired(step.key, f, !required)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                            required
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                              : "border-[#f1f5f9] text-[#737373] hover:bg-[#f8fafc]"
                          }`}
                          title={required ? "Required (operator override) — click to make optional" : "Optional — click to require"}
                        >
                          {f} {required ? "✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-4 text-xs text-[#737373]">
        Changes take effect immediately on{" "}
        <code className="rounded bg-[#f1f5f9] px-1 py-0.5">/apply</code>.
      </p>
      <div className="mt-4">
        <Button size="sm" variant="outline" onClick={() => save(config)} disabled={saving}>
          Save now
        </Button>
      </div>
    </main>
  );
}
