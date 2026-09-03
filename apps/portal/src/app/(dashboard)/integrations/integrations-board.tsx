"use client";

// ── Integrations board — official logos via logo.dev (Bonzah uses local SVG) ──
//
// UI only, deliberately. Nothing here reads or writes real integration state,
// and it issues no Supabase query of any kind — so there is no `tenant_id`
// filter to get wrong and no path by which one operator could see another's
// data. If this page ever grows a query, every one of them must carry
// `.eq('tenant_id', tenant.id)`: RLS is off on the core tables (V2_PLAN §5).
//
// Co-located with the route rather than living under `components/`, because
// `page.tsx` must stay a Server Component to resolve the v2 gate — see the
// comment there.

import { type ComponentType, useState } from "react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
// The branch drew these two from `@phosphor-icons/react`, which is not a
// dependency of this app. lucide-react — already the icon set everywhere else
// in the portal — carries both, and takes the same `size` / `color` props.
import { Globe, IdCard } from "lucide-react";

// logo.dev — publishable key (safe for client-side img.logo.dev)
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const logoSrc = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=128&format=png`;

type Integration = {
  name: string;
  category: string;
  description: string;
  /**
   * Hardcoded sample state. This page reads no real integration state, so this
   * is not the tenant's actual connection and the switches change nothing —
   * worth knowing before anyone reads a status here as fact.
   */
  connected: boolean;
  domain?: string; // logo.dev brand logo
  localLogo?: boolean; // Bonzah — official SVG in /public
  fallbackGlobe?: boolean; // no brand (Branded Domain)
  Icon?: ComponentType<{ size?: number; color?: string }>; // bare glyph (no box)
  iconColor?: string;
};

// WhatsApp, Tesla, Xero and Zoho are brand logos via logo.dev rather than
// `react-icons/si` glyphs, as the original drew them. react-icons is not a
// declared dependency of this app — it only resolved by walking up to the
// root node_modules, which would break the moment that tree changed. These
// four already have brand logos on the CDN the page uses for Stripe, Twilio
// and BoldSign, so this removes the implicit dependency without touching
// package.json or the lockfile, and renders the same real brand marks.
const integrations: Integration[] = [
  { name: "Stripe Connect", category: "Payments", description: "Accept booking payments, deposits & payouts.", connected: true, domain: "stripe.com" },
  { name: "Bonzah", category: "Insurance", description: "Per-rental insurance coverage at checkout.", connected: true, localLogo: true },
  { name: "BoldSign", category: "Documents", description: "E-signature for rental agreements.", connected: true, domain: "boldsign.com" },
  { name: "CheckMyDriver", category: "Verification", description: "Verify driver's licenses & identity.", connected: false, Icon: IdCard, iconColor: "#0EA5E9" },
  { name: "Twilio Messages", category: "Messaging", description: "SMS notifications, reminders & 2-way chat.", connected: true, domain: "twilio.com" },
  { name: "Twilio Calling", category: "Calling", description: "Call forwarding, voicemail & recordings.", connected: false, domain: "twilio.com" },
  { name: "WhatsApp", category: "Messaging", description: "Collection & signing details via WhatsApp.", connected: false, domain: "whatsapp.com" },
  { name: "Tesla", category: "Fleet", description: "Supercharging & vehicle data via the Fleet API.", connected: false, domain: "tesla.com" },
  { name: "Branded Domain", category: "Website", description: "Use your own domain for booking & portal.", connected: true, fallbackGlobe: true },
  { name: "Xero", category: "Accounting", description: "Sync invoices & payments to Xero.", connected: false, domain: "xero.com" },
  { name: "Zoho", category: "Accounting", description: "Sync books & CRM with Zoho.", connected: false, domain: "zoho.com" },
];

function IntegrationLogo({ it, size }: { it: Integration; size: number }) {
  if (it.Icon) return <it.Icon size={size} color={it.iconColor} />;
  if (it.localLogo)
    return (
      <>
        <img src="/bonzah-logo.svg" alt={it.name} className="w-auto dark:hidden" style={{ height: size * 0.62 }} />
        <img src="/bonzah-logo-dark.svg" alt={it.name} className="hidden w-auto dark:block" style={{ height: size * 0.62 }} />
      </>
    );
  if (it.fallbackGlobe) return <Globe size={size} className="text-muted-foreground" />;
  return <img src={logoSrc(it.domain!)} alt={it.name} className="object-contain" style={{ height: size, width: size }} />;
}

export function IntegrationsBoard() {
  const [selected, setSelected] = useState<Integration | null>(null);
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(integrations.map((i) => [i.name, i.connected]))
  );
  const toggle = (name: string, value: boolean) =>
    setConnectedMap((m) => ({ ...m, [name]: value }));

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-1 pb-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">Integrations</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Connect the tools that power payments, documents, messaging and more.
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {integrations.map((it) => (
          <Card
            key={it.name}
            onClick={() => setSelected(it)}
            className="group relative flex cursor-pointer flex-col items-center gap-2 border bg-transparent py-6 text-center shadow-none transition-all duration-200 hover:border-primary/30 hover:bg-gradient-to-br hover:from-primary/15 hover:via-primary/5 hover:to-transparent"
          >
            {/* Connect / disconnect switch (doesn't open the dialog) */}
            <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={connectedMap[it.name]}
                onCheckedChange={(v) => toggle(it.name, v)}
                // Just the name. Radix announces the switch role and on/off state
                // from `checked`, so this stays accurate without the original's
                // "Disconnect", which told a screen reader the control acts on a
                // live integration when it acts on nothing.
                aria-label={it.name}
              />
            </div>

            {/* Big logo */}
            <div className="flex h-20 items-center justify-center px-6">
              <IntegrationLogo it={it} size={72} />
            </div>

            {/* Text */}
            <CardContent className="flex-1 space-y-1 px-6 pt-1">
              {!it.localLogo && <CardTitle className="text-base">{it.name}</CardTitle>}
              <p className="text-sm text-muted-foreground">{it.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Integration detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <div className="mb-2 flex h-16 items-center">
                  <IntegrationLogo it={selected} size={48} />
                </div>
                <DialogTitle className="flex items-center gap-2">
                  {selected.name}
                  {connectedMap[selected.name] ? (
                    <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success">
                      <span className="size-1.5 rounded-full bg-success" /> Connected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Not connected</Badge>
                  )}
                </DialogTitle>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>

              <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                {selected.category} integration · configuration coming soon.
              </div>

              <DialogFooter>
                {connectedMap[selected.name] ? (
                  <Button variant="outline" onClick={() => toggle(selected.name, false)}>Disconnect</Button>
                ) : (
                  <Button onClick={() => toggle(selected.name, true)}>Connect</Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
