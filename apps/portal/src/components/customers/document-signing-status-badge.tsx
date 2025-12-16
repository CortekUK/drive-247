import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, Mail, FileSignature, XCircle, Ban } from "lucide-react";

interface DocumentSigningStatusBadgeProps {
  status: string;
}

export const DocumentSigningStatusBadge = ({ status }: DocumentSigningStatusBadgeProps) => {
  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any; className?: string }> = {
    pending: {
      label: "Pending",
      variant: "secondary",
      icon: Clock
    },
    sent: {
      label: "Sent",
      variant: "outline",
      icon: Mail
    },
    delivered: {
      label: "Delivered",
      variant: "outline",
      icon: Mail
    },
    signed: {
      label: "Signed",
      variant: "default",
      icon: FileSignature
    },
    completed: {
      label: "Completed",
      variant: "outline",
      icon: CheckCircle,
      className: "!bg-emerald-500 !text-white !border-emerald-500 hover:!bg-emerald-600"
    },
    declined: {
      label: "Declined",
      variant: "destructive",
      icon: XCircle
    },
    voided: {
      label: "Voided",
      variant: "secondary",
      icon: Ban
    }
  };

  const config = statusConfig[status.toLowerCase()] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={`flex items-center gap-1 ${config.className || ''}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
};
