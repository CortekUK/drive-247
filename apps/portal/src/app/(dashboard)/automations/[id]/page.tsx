"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Trash2, Send, Play, Plus, GripVertical, FlaskConical, Loader2, List, Workflow } from "lucide-react";
import { AutomationFlowCanvas } from "@/components/automations/automation-flow-canvas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useAutomation,
  useAutomationSteps,
  useUpdateAutomation,
  useUpsertAutomationSteps,
  usePublishAutomation,
  useDeleteAutomation,
  useAutomationRuns,
  type AutomationStep,
} from "@/hooks/use-automations";
import { TRIGGER_OPTIONS } from "@/lib/automation-event-registry";
import { ALL_STAGES, stageLabel } from "@/lib/lead-stage-machine";

type StepType =
  | "sms"
  | "email"
  | "wait"
  | "condition"
  | "stop"
  | "whatsapp"
  | "move_stage"
  | "assign_staff"
  | "create_task"
  | "webhook"
  | "generate_doc";

interface DraftStep {
  clientKey: string;
  step_type: StepType;
  config: Record<string, unknown>;
  branch: "true" | "false" | null;
}

const STEP_LABELS: Record<StepType, string> = {
  sms: "Send SMS",
  email: "Send Email",
  whatsapp: "Send WhatsApp",
  wait: "Wait",
  condition: "Condition",
  stop: "Stop",
  move_stage: "Move stage",
  assign_staff: "Assign staff",
  create_task: "Create task",
  webhook: "Webhook",
  generate_doc: "Generate document",
};

function genKey() {
  return Math.random().toString(36).slice(2, 10);
}

function stepToDraft(s: AutomationStep): DraftStep {
  return {
    clientKey: s.id,
    step_type: s.step_type,
    config: (s.config as Record<string, unknown>) ?? {},
    branch: s.branch,
  };
}

export default function AutomationBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data: automation, isLoading } = useAutomation(id);
  const { data: steps = [] } = useAutomationSteps(id);
  const { data: runs = [] } = useAutomationRuns(id);

  const updateMut = useUpdateAutomation();
  const upsertMut = useUpsertAutomationSteps();
  const publishMut = usePublishAutomation();
  const deleteMut = useDeleteAutomation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<string>("");
  const [draft, setDraft] = useState<DraftStep[]>([]);

  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  // Per spec §13, only admin / head_admin / super-admin can publish automations.
  // Surface this in the UI so the operator doesn't waste a network round-trip
  // discovering they're not allowed.
  const canUserPublish =
    appUser?.is_super_admin === true ||
    appUser?.role === "head_admin" ||
    appUser?.role === "admin";
  const [view, setView] = useState<"list" | "canvas">("list");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testLeads, setTestLeads] = useState<Array<{ id: string; full_name: string; stage: string }>>([]);
  const [testLeadId, setTestLeadId] = useState<string>("");
  const [testRunning, setTestRunning] = useState(false);
  const [testTimeline, setTestTimeline] = useState<Array<{ stepIndex: number; stepType: string; action: string; preview: string; waitMs?: number; branch?: string }>>([]);

  const openTest = async () => {
    setTestOpen(true);
    setTestTimeline([]);
    if (!tenant?.id) return;
    const { data } = await supabase
      .from("leads")
      .select("id, full_name, stage")
      .eq("tenant_id", tenant.id)
      .order("last_activity_at", { ascending: false })
      .limit(50);
    setTestLeads(data ?? []);
    if (data && data.length > 0) setTestLeadId(data[0].id);
  };

  const runTest = async () => {
    if (!testLeadId) {
      toast.error("Pick a lead first.");
      return;
    }
    setTestRunning(true);
    try {
      await saveSteps();
      const { data, error } = await supabase.functions.invoke<{ timeline: typeof testTimeline }>(
        "automation-test-run",
        { body: { automationId: id, leadId: testLeadId } },
      );
      if (error) throw error;
      setTestTimeline(data?.timeline ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test run failed");
    } finally {
      setTestRunning(false);
    }
  };

  useEffect(() => {
    if (automation) {
      setName(automation.name);
      setDescription(automation.description ?? "");
      setTrigger(automation.trigger_type);
    }
  }, [automation]);

  // Sync draft from server only when the underlying step set actually changes.
  // The previous `[steps]` dep caused an infinite render loop because the
  // `useAutomationSteps` default `= []` produced a new array reference on every
  // render. It also wiped any unsaved local edits every time React Query refetched.
  // Compare by step ids + updated_at — if neither moved, the operator's in-flight
  // edits in `draft` stay intact.
  const stepsSignature = useMemo(
    () => steps.map((s) => `${s.id}:${s.updated_at ?? ""}`).join("|"),
    [steps],
  );
  const lastSyncedSignatureRef = useRef<string>("");
  useEffect(() => {
    if (stepsSignature !== lastSyncedSignatureRef.current) {
      lastSyncedSignatureRef.current = stepsSignature;
      setDraft(steps.map(stepToDraft));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsSignature]);

  const saveMeta = async () => {
    if (!automation) return;
    await updateMut.mutateAsync({
      id: automation.id,
      patch: { name, description, trigger_type: trigger },
    });
  };

  const saveSteps = async () => {
    if (!automation) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = draft.map((d, idx) => ({
      id: crypto.randomUUID(),
      automation_id: automation.id,
      parent_step_id: null,
      order_index: idx,
      step_type: d.step_type,
      config: d.config,
      branch: d.branch,
    }));
    await upsertMut.mutateAsync({
      automationId: automation.id,
      steps: rows,
    });
    toast.success("Steps saved");
  };

  const addStep = (type: StepType) => {
    setDraft((prev) => [
      ...prev,
      {
        clientKey: genKey(),
        step_type: type,
        config: type === "wait" ? { duration: { value: 2, unit: "hours" } } : {},
        branch: null,
      },
    ]);
  };

  const removeStep = (key: string) => {
    setDraft((prev) => prev.filter((s) => s.clientKey !== key));
  };

  const updateStepConfig = (key: string, patch: Record<string, unknown>) => {
    setDraft((prev) => prev.map((s) => (s.clientKey === key ? { ...s, config: { ...s.config, ...patch } } : s)));
  };

  const publish = async () => {
    if (!automation) return;
    await saveSteps();
    await publishMut.mutateAsync(automation.id);
  };

  const remove = async () => {
    if (!automation) return;
    if (!confirm("Delete this automation?")) return;
    await deleteMut.mutateAsync(automation.id);
    router.push("/automations");
  };

  if (isLoading || !automation) {
    return <main className="mx-auto w-full max-w-[1160px] px-6 py-8 text-sm text-[#737373]">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-[1160px] px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex items-center gap-1 text-sm text-[#737373] hover:text-indigo-600"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Automations
        </button>
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${automation.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-700"}`}>
            {automation.status}
          </span>
          {automation.status === "published" && (
            <span className="text-xs text-[#737373]">v{automation.version}</span>
          )}
          <Button size="sm" variant="outline" onClick={openTest}>
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Test
          </Button>
          <Button size="sm" variant="outline" onClick={remove} disabled={deleteMut.isPending}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
          </Button>
          <Button
            size="sm"
            onClick={publish}
            disabled={publishMut.isPending || !canUserPublish}
            title={
              canUserPublish
                ? "Snapshot the current draft and make it live"
                : "Only admin or head_admin can publish automations (your role: " + (appUser?.role ?? "—") + "). Ask a tenant admin to publish, or switch to an admin account."
            }
          >
            <Send className="mr-1.5 h-3.5 w-3.5" /> Publish
          </Button>
        </div>
      </header>

      <section className="rounded-lg border border-[#f1f5f9] bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#737373]">Basics</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveMeta} />
          </div>
          <div className="space-y-1.5">
            <Label>Trigger</Label>
            <Select value={trigger} onValueChange={(v) => { setTrigger(v); }} >
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
        <div className="mt-3 space-y-1.5">
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveMeta}
            rows={2}
          />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-[#f1f5f9] bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#737373]">Steps</h2>
            <div className="flex items-center rounded-md border border-[#f1f5f9] bg-[#f8fafc] p-0.5">
              <button
                type="button"
                onClick={() => setView("list")}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${view === "list" ? "bg-white text-indigo-700 shadow-sm" : "text-[#737373]"}`}
              >
                <List className="h-3 w-3" /> List
              </button>
              <button
                type="button"
                onClick={() => setView("canvas")}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${view === "canvas" ? "bg-white text-indigo-700 shadow-sm" : "text-[#737373]"}`}
              >
                <Workflow className="h-3 w-3" /> Canvas
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["sms", "email", "whatsapp", "wait", "condition", "move_stage", "assign_staff", "create_task", "webhook", "generate_doc", "stop"] as StepType[]).map((t) => (
              <Button key={t} size="sm" variant="outline" onClick={() => addStep(t)}>
                <Plus className="mr-1 h-3 w-3" /> {STEP_LABELS[t]}
              </Button>
            ))}
          </div>
        </div>

        {view === "canvas" && (
          <div className="mb-4">
            <AutomationFlowCanvas
              triggerType={trigger}
              steps={draft}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
            {selectedKey && (
              <p className="mt-2 text-xs text-[#737373]">
                Selected: click the step below to edit its config. Toggle to List for full editing.
              </p>
            )}
          </div>
        )}

        {draft.length === 0 ? (
          <p className="text-sm text-[#737373]">No steps yet. Add one with the buttons above.</p>
        ) : (
          <ol className="space-y-2">
            {draft.map((s, idx) => (
              <li key={s.clientKey} className="rounded-md border border-[#f1f5f9] bg-[#f8fafc] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#080812]">
                    <GripVertical className="h-3.5 w-3.5 text-[#737373]" />
                    {idx + 1}. {STEP_LABELS[s.step_type]}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeStep(s.clientKey)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {s.step_type === "sms" && (
                  <Textarea
                    value={(s.config.body as string) ?? ""}
                    onChange={(e) => updateStepConfig(s.clientKey, { body: e.target.value })}
                    placeholder="Hi {{first_name}}, ..."
                    rows={2}
                  />
                )}
                {s.step_type === "email" && (
                  <div className="space-y-2">
                    <Input
                      value={(s.config.subject as string) ?? ""}
                      onChange={(e) => updateStepConfig(s.clientKey, { subject: e.target.value })}
                      placeholder="Subject"
                    />
                    <Textarea
                      value={(s.config.body as string) ?? ""}
                      onChange={(e) => updateStepConfig(s.clientKey, { body: e.target.value })}
                      placeholder="Hi {{first_name}}, ..."
                      rows={3}
                    />
                  </div>
                )}
                {s.step_type === "wait" && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={(s.config.duration as { value: number })?.value ?? 1}
                      onChange={(e) =>
                        updateStepConfig(s.clientKey, {
                          duration: { value: Number(e.target.value), unit: (s.config.duration as { unit?: string })?.unit ?? "hours" },
                        })
                      }
                    />
                    <Select
                      value={(s.config.duration as { unit?: string })?.unit ?? "hours"}
                      onValueChange={(v) =>
                        updateStepConfig(s.clientKey, {
                          duration: { value: (s.config.duration as { value?: number })?.value ?? 1, unit: v },
                        })
                      }
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">minutes</SelectItem>
                        <SelectItem value="hours">hours</SelectItem>
                        <SelectItem value="days">days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {s.step_type === "condition" && (
                  <Input
                    value={(s.config.expression as string) ?? ""}
                    onChange={(e) => updateStepConfig(s.clientKey, { expression: e.target.value })}
                    placeholder="lead.score_band == 'hot'"
                  />
                )}
                {s.step_type === "stop" && (
                  <p className="text-xs text-[#737373]">Ends the run with status=completed.</p>
                )}
                {s.step_type === "whatsapp" && (
                  <Textarea
                    value={(s.config.body as string) ?? ""}
                    onChange={(e) => updateStepConfig(s.clientKey, { body: e.target.value })}
                    placeholder="Hi {{first_name}}, …"
                    rows={2}
                  />
                )}
                {s.step_type === "move_stage" && (
                  <Select
                    value={(s.config.to_stage as string) ?? ""}
                    onValueChange={(v) => updateStepConfig(s.clientKey, { to_stage: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Move to which stage?" /></SelectTrigger>
                    <SelectContent>
                      {ALL_STAGES.map((st) => (
                        <SelectItem key={st} value={st}>
                          <div className="flex flex-col">
                            <span className="font-medium">{stageLabel(st)}</span>
                            <span className="text-[10px] text-[#737373] font-mono">{st}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {s.step_type === "assign_staff" && (
                  <Select
                    value={(s.config.rule as string) ?? "round_robin"}
                    onValueChange={(v) => updateStepConfig(s.clientKey, { rule: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round_robin">Round robin</SelectItem>
                      <SelectItem value="least_loaded">Least loaded</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {s.step_type === "create_task" && (
                  <Input
                    value={(s.config.body as string) ?? ""}
                    onChange={(e) => updateStepConfig(s.clientKey, { body: e.target.value })}
                    placeholder="e.g. Call lead within 1 hour"
                  />
                )}
                {s.step_type === "webhook" && (
                  <div className="space-y-2">
                    <Input
                      value={(s.config.url as string) ?? ""}
                      onChange={(e) => updateStepConfig(s.clientKey, { url: e.target.value })}
                      placeholder="https://example.com/hook"
                    />
                    <Select
                      value={(s.config.method as string) ?? "POST"}
                      onValueChange={(v) => updateStepConfig(s.clientKey, { method: v })}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem>
                      </SelectContent>
                    </Select>
                    <Textarea
                      value={typeof s.config.body === "string" ? s.config.body : JSON.stringify(s.config.body ?? {}, null, 2)}
                      onChange={(e) => {
                        try {
                          updateStepConfig(s.clientKey, { body: JSON.parse(e.target.value) });
                        } catch {
                          updateStepConfig(s.clientKey, { body: e.target.value });
                        }
                      }}
                      placeholder='{"event": "lead.qualified"}'
                      rows={3}
                    />
                  </div>
                )}
                {s.step_type === "generate_doc" && (
                  <Select
                    value={(s.config.template_type as string) ?? "agreement"}
                    onValueChange={(v) => updateStepConfig(s.clientKey, { template_type: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agreement">Rental agreement</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="outline" onClick={saveSteps} disabled={upsertMut.isPending}>
            Save steps
          </Button>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-[#f1f5f9] bg-white p-5">
        <div className="mb-3 flex items-center gap-1.5">
          <Play className="h-3.5 w-3.5 text-[#737373]" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#737373]">Recent runs</h2>
        </div>
        {runs.length === 0 ? (
          <p className="text-sm text-[#737373]">No runs yet. Will appear here once published and triggered.</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id} className="rounded-md border border-[#f1f5f9] p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[#080812]">v{r.automation_version}</span>
                  <span className={`uppercase ${r.status === "completed" ? "text-emerald-700" : r.status === "failed" ? "text-red-700" : "text-indigo-700"}`}>
                    {r.status}
                  </span>
                </div>
                <div className="mt-0.5 text-[#737373]">
                  {r.entity_type} {r.entity_id.slice(0, 8)} · started {new Date(r.started_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Test run</DialogTitle>
            <DialogDescription>
              Pick a real lead. The simulation reads its data and walks through every step
              without sending real SMS/Email, calling webhooks, or moving stages.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Select value={testLeadId} onValueChange={setTestLeadId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a lead" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {testLeads.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.full_name} · {l.stage}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {testTimeline.length > 0 && (
              <ol className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
                {testTimeline.map((t, idx) => (
                  <li key={idx} className="border-b border-[#f1f5f9] py-1.5 last:border-b-0">
                    <div className="font-medium text-[#080812]">
                      {idx + 1}. {t.action}
                      {t.branch && <span className="ml-2 rounded bg-indigo-100 px-1 py-0.5 text-[10px] uppercase text-indigo-700">branch {t.branch}</span>}
                      {t.waitMs !== undefined && <span className="ml-2 text-[#737373]">({Math.round(t.waitMs / 60000)} min)</span>}
                    </div>
                    {t.preview && (
                      <pre className="mt-1 whitespace-pre-wrap text-[11px] text-[#404040]">{t.preview}</pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>Close</Button>
            <Button onClick={runTest} disabled={testRunning || !testLeadId}>
              {testRunning ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Simulating…</>
              ) : (
                <><Play className="mr-1.5 h-3.5 w-3.5" /> Run simulation</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
