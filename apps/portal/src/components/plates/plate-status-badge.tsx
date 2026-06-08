import { StatusPill, type StatusTone } from "@/components/bento";

interface PlateStatusBadgeProps {
  status: string;
  showTooltip?: boolean;
}

export const PlateStatusBadge = ({ status, showTooltip }: PlateStatusBadgeProps) => {
  const getStatusConfig = (status: string): { tone: StatusTone; label: string } => {
    switch (status?.toLowerCase()) {
      case "ordered":
        return { tone: "warn", label: "Ordered" };
      case "received":
        return { tone: "success", label: "Received" };
      case "fitted":
      case "assigned":
        return { tone: "success", label: "Assigned" };
      case "expired":
        return { tone: "danger", label: "Expired" };
      default:
        return { tone: "neutral", label: status || "Unknown" };
    }
  };

  const config = getStatusConfig(status);

  return (
    <StatusPill tone={config.tone} title={showTooltip ? config.label : undefined}>
      {config.label}
    </StatusPill>
  );
};
