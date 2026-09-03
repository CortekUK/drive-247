/**
 * AutomationFlowCanvas — Spec Section 7.3 (Drag-drop flow builder).
 *
 * React Flow canvas representation of the automation steps. Auto-syncs with the
 * `draft` state so list-view + canvas-view stay in lockstep. Nodes are positioned
 * top-to-bottom based on order_index; condition branches fork into true/false.
 *
 * Node types are styled per step_type. Edges are auto-generated; the canvas is
 * read-mostly for V1 (drag to reposition, click-to-select for property editing
 * in the right panel). Add/remove still happens via the palette in the parent.
 */
"use client";

import { useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  Phone,
  Mail,
  MessageSquare,
  Clock,
  GitBranch,
  Square,
  Workflow as WorkflowIcon,
  ListChecks,
  UserPlus,
  Globe,
  FileSignature,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface DraftStep {
  clientKey: string;
  step_type: string;
  config: Record<string, unknown>;
  branch: "true" | "false" | null;
}

const STEP_META: Record<string, { Icon: typeof Phone; color: string; label: string }> = {
  sms: { Icon: Phone, color: "bg-emerald-50 border-emerald-200 text-emerald-900", label: "SMS" },
  email: { Icon: Mail, color: "bg-blue-50 border-blue-200 text-blue-900", label: "Email" },
  whatsapp: { Icon: MessageSquare, color: "bg-green-50 border-green-200 text-green-900", label: "WhatsApp" },
  wait: { Icon: Clock, color: "bg-amber-50 border-amber-200 text-amber-900", label: "Wait" },
  condition: { Icon: GitBranch, color: "bg-violet-50 border-violet-200 text-violet-900", label: "Condition" },
  stop: { Icon: Square, color: "bg-zinc-100 border-zinc-200 text-zinc-700", label: "Stop" },
  move_stage: { Icon: WorkflowIcon, color: "bg-indigo-50 border-indigo-200 text-indigo-900", label: "Move stage" },
  assign_staff: { Icon: UserPlus, color: "bg-pink-50 border-pink-200 text-pink-900", label: "Assign staff" },
  create_task: { Icon: ListChecks, color: "bg-yellow-50 border-yellow-200 text-yellow-900", label: "Task" },
  webhook: { Icon: Globe, color: "bg-cyan-50 border-cyan-200 text-cyan-900", label: "Webhook" },
  generate_doc: { Icon: FileSignature, color: "bg-rose-50 border-rose-200 text-rose-900", label: "Doc" },
};

interface StepNodeData extends Record<string, unknown> {
  step: DraftStep;
  index: number;
  preview: string;
  onClick: () => void;
  selected: boolean;
}

function StepNode({ data }: NodeProps) {
  const d = data as StepNodeData;
  const meta = STEP_META[d.step.step_type] ?? STEP_META.sms;
  const Icon = meta.Icon;
  return (
    <div
      onClick={d.onClick}
      className={cn(
        "min-w-[200px] cursor-pointer rounded-md border-2 px-3 py-2 shadow-sm",
        meta.color,
        d.selected ? "ring-2 ring-indigo-500 ring-offset-1" : "",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-400" />
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5" />
        {d.index + 1}. {meta.label}
        {d.step.branch && (
          <span className="ml-auto rounded bg-white px-1 py-0.5 text-[10px] font-medium">
            {d.step.branch}
          </span>
        )}
      </div>
      {d.preview && (
        <p className="mt-1 line-clamp-2 text-[11px] text-[#404040]">{d.preview}</p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-400" />
    </div>
  );
}

function TriggerNode({ data }: NodeProps) {
  const d = data as { triggerType: string };
  return (
    <div className="min-w-[200px] rounded-md border-2 border-indigo-400 bg-indigo-100 px-3 py-2 text-indigo-900 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wide">Trigger</div>
      <div className="mt-0.5 font-mono text-xs">{d.triggerType || "(unset)"}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-500" />
    </div>
  );
}

const nodeTypes = { stepNode: StepNode, triggerNode: TriggerNode };

interface Props {
  triggerType: string;
  steps: DraftStep[];
  selectedKey: string | null;
  onSelect: (clientKey: string) => void;
}

export function AutomationFlowCanvas({ triggerType, steps, selectedKey, onSelect }: Props) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Trigger node
    nodes.push({
      id: "__trigger__",
      type: "triggerNode",
      position: { x: 250, y: 0 },
      data: { triggerType },
      draggable: false,
    });

    // Linear layout (V1 — branches fan out below their parent)
    let yCursor = 120;
    let prevId = "__trigger__";

    steps.forEach((step, idx) => {
      const node: Node = {
        id: step.clientKey,
        type: "stepNode",
        position: { x: 250, y: yCursor },
        data: {
          step,
          index: idx,
          preview: previewFor(step),
          onClick: () => onSelect(step.clientKey),
          selected: selectedKey === step.clientKey,
        } as StepNodeData,
      };
      nodes.push(node);
      edges.push({
        id: `${prevId}->${step.clientKey}`,
        source: prevId,
        target: step.clientKey,
        animated: idx === 0,
        style: { stroke: "#a3a3a3" },
      });
      prevId = step.clientKey;
      yCursor += 110;
    });

    return { nodes, edges };
  }, [triggerType, steps, selectedKey, onSelect]);

  return (
    <div className="h-[420px] rounded-lg border border-[#f1f5f9] bg-white">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
          panOnDrag
          zoomOnScroll
          minZoom={0.4}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} color="#e0e7ff" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-[#f8fafc]" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function previewFor(step: DraftStep): string {
  switch (step.step_type) {
    case "sms":
    case "whatsapp":
      return String((step.config.body as string) ?? "");
    case "email": {
      const subject = (step.config.subject as string) ?? "";
      return subject ? `Subject: ${subject}` : "";
    }
    case "wait": {
      const d = step.config.duration as { value: number; unit: string } | undefined;
      return d ? `${d.value} ${d.unit}` : "1 hour";
    }
    case "condition":
      return String((step.config.expression as string) ?? "");
    case "move_stage":
      return `→ ${(step.config.to_stage as string) ?? "(unset)"}`;
    case "assign_staff":
      return String((step.config.rule as string) ?? "round_robin");
    case "create_task":
      return String((step.config.body as string) ?? "Follow up");
    case "webhook":
      return `${(step.config.method as string) ?? "POST"} ${(step.config.url as string) ?? ""}`;
    case "generate_doc":
      return String((step.config.template_type as string) ?? "agreement");
    case "stop":
      return "End run";
    default:
      return "";
  }
}
