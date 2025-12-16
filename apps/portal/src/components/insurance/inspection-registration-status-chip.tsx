import { Badge } from "@/components/ui/badge";
import { getDueStatus, formatDueStatusText, type DueStatus } from "@/lib/mot-tax-utils";
import { AlertCircle, CheckCircle, Clock, Minus } from "lucide-react";

interface InspectionRegistrationStatusChipProps {
  dueDate: Date | string | null;
  type: 'Inspection' | 'Registration';
  compact?: boolean;
}

const getStatusVariant = (state: DueStatus['state']) => {
  switch (state) {
    case 'overdue':
      return 'destructive';
    case 'due_soon':
      return 'secondary';
    case 'ok':
      return 'default';
    case 'missing':
      return 'outline';
    default:
      return 'outline';
  }
};

const getStatusIcon = (state: DueStatus['state']) => {
  switch (state) {
    case 'overdue':
      return <AlertCircle className="h-3 w-3" />;
    case 'due_soon':
      return <Clock className="h-3 w-3" />;
    case 'ok':
      return <CheckCircle className="h-3 w-3" />;
    case 'missing':
      return <Minus className="h-3 w-3" />;
    default:
      return null;
  }
};

export function InspectionRegistrationStatusChip({ dueDate, type, compact = false }: InspectionRegistrationStatusChipProps) {
  const status = getDueStatus(dueDate);
  const statusText = formatDueStatusText(status, dueDate);
  const variant = getStatusVariant(status.state);
  const icon = getStatusIcon(status.state);

  if (compact) {
    return (
      <Badge variant={variant} className="flex items-center justify-center gap-1 text-xs">
        {icon}
        <span className="font-medium">
          {status.state === 'missing' ? 'N/A' :
           status.state === 'ok' ? 'OK' :
           status.state === 'overdue' ? `${status.days}d over` :
           `${status.days}d left`}
        </span>
      </Badge>
    );
  }

  return (
    <Badge variant={variant} className="flex items-center gap-2 whitespace-nowrap">
      {icon}
      <span className="font-medium">{statusText}</span>
    </Badge>
  );
}
