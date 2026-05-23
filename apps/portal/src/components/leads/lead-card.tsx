/**
 * LeadCard — Spec Section 6.3 (Cards).
 *
 * One card per lead in the kanban board. Sortable / draggable via @dnd-kit/core.
 * Click → routes to /leads/[id] workspace (NOT a drawer per spec).
 */
"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Mail,
  Phone,
  Calendar,
  Car,
  Flame,
  Snowflake,
  AlertTriangle,
  ThermometerSun,
} from "lucide-react";
import type { LeadRow } from "@/hooks/use-leads";
import { stageColor } from "@/lib/lead-stage-machine";
import { cn } from "@/lib/utils";

const BAND_ICON = {
  hot: { Icon: Flame, color: "text-orange-600", title: "Hot" },
  warm: { Icon: ThermometerSun, color: "text-amber-600", title: "Warm" },
  cold: { Icon: Snowflake, color: "text-blue-500", title: "Cold" },
  risk: { Icon: AlertTriangle, color: "text-red-600", title: "Risk" },
} as const;

const SOURCE_ICON = {
  application: Mail,
  quick_enquiry: Mail,
  phone_in: Phone,
  walk_in: Calendar,
  admin_manual: Calendar,
  inbound_sms: Phone,
  inbound_email: Mail,
  inbound_whatsapp: Phone,
  legacy_enquiry: Mail,
  ad_landing: Mail,
} as const;

function timeInStage(stageUpdatedAt: string): string {
  const ms = Date.now() - Date.parse(stageUpdatedAt);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface LeadCardProps {
  lead: LeadRow;
  staleThresholdHours?: number;
  draggable?: boolean;
}

export function LeadCard({ lead, staleThresholdHours = 48, draggable = true }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    disabled: !draggable,
    data: { type: "lead", lead },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const stageHues = stageColor(lead.stage);
  const band = lead.score_band ? BAND_ICON[lead.score_band] : null;
  const SourceIcon = SOURCE_ICON[lead.source as keyof typeof SOURCE_ICON] ?? Mail;

  const stale = Date.now() - Date.parse(lead.last_activity_at) > staleThresholdHours * 60 * 60 * 1000;
  const phoneTail = lead.phone.replace(/\D/g, "").slice(-4);
  const requestedVehicle = lead.vehicle_class || (lead.vehicle_id ? "Specific vehicle" : "Any vehicle");
  const dateRange = lead.start_date && lead.end_date ? `${lead.start_date} → ${lead.end_date}` : null;

  return (
    <Link
      ref={setNodeRef}
      href={`/leads/${lead.id}`}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group block touch-none rounded-md border border-[#f1f5f9] bg-white p-3 transition-shadow hover:shadow-sm",
        isDragging && "shadow-md ring-2 ring-indigo-200",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-[#080812]">{lead.full_name}</span>
            {band && (
              <band.Icon className={cn("h-3.5 w-3.5 shrink-0", band.color)} aria-label={band.title} />
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#737373]">
            <SourceIcon className="h-3 w-3" aria-hidden />
            <span>···{phoneTail}</span>
          </div>
        </div>
        {stale && (
          <span
            className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-500"
            aria-label="No activity recently"
          />
        )}
      </div>

      <div className="mt-2 space-y-1 text-xs text-[#404040]">
        <div className="flex items-center gap-1.5">
          <Car className="h-3 w-3 shrink-0 text-[#737373]" />
          <span className="truncate">{requestedVehicle}</span>
        </div>
        {dateRange && (
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3 shrink-0 text-[#737373]" />
            <span>{dateRange}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-[#f1f5f9] pt-2">
        <span className={cn("text-[10px] uppercase tracking-wide", stageHues.text)}>
          In stage {timeInStage(lead.stage_updated_at)}
        </span>
        {!lead.is_read && (
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" aria-label="Unread" />
        )}
      </div>
    </Link>
  );
}
