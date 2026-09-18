"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw, Save } from "lucide-react";

/**
 * The accent colour for the custom booking site.
 *
 * That site ships one approved palette for every operator — deliberately, so
 * the template stays consistent — and this is the single sanctioned exception.
 * It is kept apart from the brand colours above because those drive this portal
 * and the existing booking site; pointing the custom site at them would drag a
 * whole brand into a layout that is not built for it.
 *
 * Empty means "use the approved default", which is what every tenant gets until
 * they set something here.
 *
 * It saves on its own rather than joining the branding form: that form carries a
 * light/dark sync step which does not apply to a single accent, and keeping this
 * separate means a save here can never disturb the colours above.
 */
const APPROVED_DEFAULT = "#5E3BFF";
const HEX = /^#[0-9a-f]{6}$/i;

export function CustomSiteAccentField() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: saved = null, isLoading } = useQuery({
    queryKey: ["custom-site-accent", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("custom_site_accent_color")
        .eq("id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.custom_site_accent_color ?? null;
    },
  });

  useEffect(() => {
    setValue(saved ?? "");
  }, [saved]);

  const effective = HEX.test(value) ? value : APPROVED_DEFAULT;
  const dirty = (saved ?? "") !== value;
  const invalid = value !== "" && !HEX.test(value);

  const save = async (next: string | null) => {
    if (!tenant?.id) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("tenants")
        .update({ custom_site_accent_color: next })
        .eq("id", tenant.id);
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ["custom-site-accent", tenant.id] });
      setValue(next ?? "");
      toast({
        title: "Custom site accent saved",
        description: next
          ? "Your custom booking site now uses this colour."
          : "Your custom booking site is back on the default accent.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to save the accent colour",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pt-6 border-t">
      <div>
        <h3 className="font-medium">Custom Site Accent</h3>
        <p className="text-sm text-muted-foreground mt-1">
          The accent used across your custom booking site — buttons, links, highlights and the
          light/dark theme derived from it. Leave it empty to use the default.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="custom-site-accent">Accent colour</Label>
          <div className="flex items-center gap-2">
            <input
              id="custom-site-accent-swatch"
              type="color"
              aria-label="Pick the custom site accent colour"
              value={effective}
              onChange={e => setValue(e.target.value.toUpperCase())}
              disabled={isLoading || saving}
              className="h-10 w-14 cursor-pointer rounded-md border bg-background p-1"
            />
            <Input
              id="custom-site-accent"
              value={value}
              onChange={e => setValue(e.target.value.trim())}
              placeholder={`${APPROVED_DEFAULT} (default)`}
              disabled={isLoading || saving}
              aria-invalid={invalid}
              className="w-[190px] font-mono"
            />
          </div>
          {invalid && (
            <p className="text-xs text-destructive">Use a 6-digit hex colour, e.g. {APPROVED_DEFAULT}</p>
          )}
        </div>

        <Button onClick={() => save(value === "" ? null : value)} disabled={saving || invalid || !dirty}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save accent
        </Button>

        <Button
          variant="outline"
          onClick={() => save(null)}
          disabled={saving || (saved === null && value === "")}
          title="Go back to the approved default accent"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Use default
        </Button>
      </div>

      <div className="flex items-center gap-3 rounded-md border p-3">
        <span
          className="h-9 w-9 shrink-0 rounded-md border"
          style={{ backgroundColor: effective }}
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">
          Preview — {saved ? "your accent" : "the default accent"} is{" "}
          <span className="font-mono text-foreground">{effective.toUpperCase()}</span>. Light and dark
          shades are derived from it automatically.
        </p>
      </div>
    </div>
  );
}
