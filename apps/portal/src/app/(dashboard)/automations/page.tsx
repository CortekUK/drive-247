"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAutomations, useCreateAutomation } from "@/hooks/use-automations";
import { TRIGGER_OPTIONS, eventLabel } from "@/lib/automation-event-registry";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const STATUS_HUES = {
  draft: "bg-zinc-100 text-zinc-700",
  published: "bg-emerald-50 text-emerald-700",
  archived: "bg-zinc-50 text-zinc-500",
};

export default function AutomationsPage() {
  const router = useRouter();
  const { data: automations = [], isLoading } = useAutomations();
  const create = useCreateAutomation();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<string>("lead.created");

  const handleCreate = async () => {
    if (!name.trim()) return;
    const result = await create.mutateAsync({ name: name.trim(), triggerType: trigger });
    setName("");
    setAddOpen(false);
    router.push(`/automations/${result.id}`);
  };

  return (
    <main className="container mx-auto px-6 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[30px] font-medium text-[#080812]">Automations</h1>
          <p className="mt-1 text-sm text-[#737373]">
            Build workflows that fire on lead events.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New automation
        </Button>
      </header>

      {isLoading ? (
        <div className="text-sm text-[#737373]">Loading…</div>
      ) : automations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white p-12 text-center">
          <Workflow className="mx-auto h-8 w-8 text-[#737373]" />
          <h3 className="mt-3 text-base font-medium text-[#080812]">No automations yet</h3>
          <p className="mt-1 text-sm text-[#737373]">
            Start with a welcome SMS on <code>lead.created</code> or a follow-up 24h after no reply.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {automations.map((a) => (
            <Link
              key={a.id}
              href={`/automations/${a.id}`}
              className="rounded-lg border border-[#f1f5f9] bg-white p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-medium text-[#080812]">{a.name}</h3>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", STATUS_HUES[a.status])}>
                  {a.status}
                </span>
              </div>
              <div className="mt-2 text-xs text-[#737373]">
                Trigger: <span className="font-medium text-[#404040]">{eventLabel(a.trigger_type)}</span>
              </div>
              {a.published_at && (
                <div className="mt-1 text-[10px] text-[#737373]">v{a.version} · {new Date(a.published_at).toLocaleDateString()}</div>
              )}
            </Link>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New automation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome + 2h follow-up" />
            </div>
            <div className="space-y-1.5">
              <Label>Trigger event</Label>
              <Select value={trigger} onValueChange={setTrigger}>
                <SelectTrigger className="h-auto py-2">
                  <SelectValue>
                    {trigger ? (
                      <div className="flex flex-col items-start text-left">
                        <span className="text-sm font-medium">{TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label ?? trigger}</span>
                        <span className="text-[10px] text-[#737373] font-mono">{trigger}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-[#737373]">Pick a trigger…</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="max-h-[320px] w-[var(--radix-select-trigger-width)] overflow-y-auto"
                >
                  {TRIGGER_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="py-2 pr-8">
                      <div className="flex flex-col text-left">
                        <span className="text-sm font-medium">{t.label}</span>
                        <span className="mt-0.5 text-[10px] text-[#737373] leading-tight">
                          <code className="font-mono">{t.rawName}</code> — {t.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={create.isPending || !name.trim()}>
              {create.isPending ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
