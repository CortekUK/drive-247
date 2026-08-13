/**
 * ZohoRegionSelector — Sprint 5, Spec §10.3.
 *
 * Zoho hosts each customer's data in one of six regional data centres, and
 * the OAuth authorize URL is region-specific. We can't auto-detect the right
 * region from a Drive247 tenant's locale (a UK operator might still keep
 * their books on `.com`), so we ask.
 *
 * Modal opens when operator clicks "Connect Zoho" on Settings → Accounting.
 * Pick → "Continue" hands off to useConnectZoho({ region }) which redirects
 * to the right Zoho login page.
 */
"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConnectZoho, type ZohoRegion } from "@/hooks/use-accounting-connection";

interface RegionOption {
  region: ZohoRegion;
  label: string;
  description: string;
}

const REGIONS: RegionOption[] = [
  { region: "com",     label: "Global (.com)",      description: "United States" },
  { region: "eu",      label: "Europe (.eu)",       description: "UK / EU" },
  { region: "in",      label: "India (.in)",        description: "India" },
  { region: "com.au",  label: "Australia (.com.au)", description: "Australia" },
  { region: "jp",      label: "Japan (.jp)",        description: "Japan" },
  { region: "sa",      label: "Saudi Arabia (.sa)", description: "Middle East" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ZohoRegionSelector({ open, onClose }: Props) {
  const [selected, setSelected] = useState<ZohoRegion>("eu");
  const connect = useConnectZoho();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Which Zoho region is your account in?</DialogTitle>
          <DialogDescription className="text-xs">
            Zoho hosts each account in one regional data centre. Pick the one your
            Zoho Books org lives in — you can find this in your Zoho URL (e.g.
            `books.zoho.eu` = Europe).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {REGIONS.map((r) => {
            const isSelected = selected === r.region;
            return (
              <button
                key={r.region}
                type="button"
                onClick={() => setSelected(r.region)}
                className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors
                  ${isSelected ? "border-indigo-300 bg-indigo-50/50" : "border-border bg-background hover:border-indigo-200"}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isSelected ? "border-indigo-600 bg-indigo-600" : "border-muted-foreground/30"}`}>
                    {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{r.label}</div>
                    <div className="text-[11px] text-muted-foreground">{r.description}</div>
                  </div>
                </div>
                {isSelected && <ChevronRight className="h-3.5 w-3.5 text-indigo-600" />}
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={connect.isPending}>Cancel</Button>
          <Button
            onClick={() => {
              const redirectBack = typeof window !== "undefined"
                ? `${window.location.origin}/settings?tab=accounting`
                : undefined;
              connect.mutate({ region: selected, redirectBack });
            }}
            disabled={connect.isPending}
            className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
          >
            {connect.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Continue <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
