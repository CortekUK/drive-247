// Re-export useOrgSettings as useSettings for backwards compatibility
// The settings hook uses TanStack Query which handles all state management
export { useOrgSettings as useSettings, type OrgSettings } from '@/hooks/use-org-settings';
