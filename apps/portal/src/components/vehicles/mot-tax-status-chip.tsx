// This component has been renamed to InspectionRegistrationStatusChip
// This file exists for backward compatibility only
import { InspectionRegistrationStatusChip } from "../insurance/inspection-registration-status-chip";

interface MOTTaxStatusChipProps {
  dueDate: Date | string | null;
  type: 'MOT' | 'TAX';
  compact?: boolean;
}

export function MOTTaxStatusChip({ dueDate, type, compact = false }: MOTTaxStatusChipProps) {
  // Map old UK terminology to new US terminology
  const newType = type === 'MOT' ? 'Inspection' : 'Registration';
  return <InspectionRegistrationStatusChip dueDate={dueDate} type={newType} compact={compact} />;
}
