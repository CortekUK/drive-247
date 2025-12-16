import { differenceInDays, startOfDay } from "date-fns";

export interface DueStatus {
  state: 'ok' | 'due_soon' | 'overdue' | 'missing';
  days?: number;
}

export function getDueStatus(dueDate: Date | string | null): DueStatus {
  if (!dueDate) {
    return { state: 'missing' };
  }
  
  // Normalize both dates to start of day to avoid time-of-day issues
  const dueDateObj = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const normalizedDueDate = startOfDay(dueDateObj);
  const normalizedToday = startOfDay(new Date());
  const diffDays = differenceInDays(normalizedDueDate, normalizedToday);
  
  if (diffDays < 0) {
    return { state: 'overdue', days: Math.abs(diffDays) };
  }
  
  if (diffDays <= 30) {
    return { state: 'due_soon', days: diffDays };
  }
  
  return { state: 'ok' };
}

export function formatDueStatusText(status: DueStatus, dueDate: Date | string | null): string {
  switch (status.state) {
    case 'overdue':
      return `Overdue by ${status.days} day${status.days === 1 ? '' : 's'}`;
    case 'due_soon':
      return `Due in ${status.days} day${status.days === 1 ? '' : 's'}`;
    case 'ok':
      if (dueDate) {
        const dueDateObj = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
        return `OK (${dueDateObj.toLocaleDateString('en-US')})`;
      }
      return 'OK';
    case 'missing':
      return 'Not set';
    default:
      return 'Unknown';
  }
}