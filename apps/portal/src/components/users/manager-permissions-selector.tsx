'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { TAB_GROUPS, SETTINGS_SUB_TABS } from '@/lib/permissions';
import type { PermissionEntry } from '@/client-schemas/users/add-user';

interface ManagerPermissionsSelectorProps {
  value: PermissionEntry[];
  onChange: (permissions: PermissionEntry[]) => void;
}

export function ManagerPermissionsSelector({ value, onChange }: ManagerPermissionsSelectorProps) {
  const permMap = new Map(value.map(p => [p.tab_key, p.access_level]));

  const isChecked = (key: string) => permMap.has(key);
  const getAccessLevel = (key: string) => permMap.get(key) || 'viewer';

  const toggleTab = (key: string) => {
    if (permMap.has(key)) {
      // Remove this tab
      let next = value.filter(p => p.tab_key !== key);
      // If removing 'settings', also remove all settings sub-tabs
      if (key === 'settings') {
        next = next.filter(p => !p.tab_key.startsWith('settings.'));
      }
      onChange(next);
    } else {
      // Add this tab with default viewer access
      onChange([...value, { tab_key: key, access_level: 'viewer' }]);
    }
  };

  const toggleAccessLevel = (key: string) => {
    const newLevel = getAccessLevel(key) === 'viewer' ? 'editor' : 'viewer';
    onChange(value.map(p => p.tab_key === key ? { ...p, access_level: newLevel } : p));
  };

  const hasSettings = isChecked('settings');

  return (
    <TooltipProvider>
      <div className="max-h-[500px] overflow-y-auto pr-2 border rounded-md p-3">
        <div className="space-y-4">
          {TAB_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {group.label}
              </p>
              <div className="space-y-2">
                {group.tabs.map(tab => (
                  <PermissionRow
                    key={tab.key}
                    label={tab.label}
                    checked={isChecked(tab.key)}
                    accessLevel={getAccessLevel(tab.key)}
                    onToggle={() => toggleTab(tab.key)}
                    onAccessLevelToggle={() => toggleAccessLevel(tab.key)}
                    viewOnly={tab.viewOnly}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Settings section */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Settings
            </p>
            <PermissionRow
              label="Settings"
              checked={hasSettings}
              accessLevel={getAccessLevel('settings')}
              onToggle={() => toggleTab('settings')}
              onAccessLevelToggle={() => toggleAccessLevel('settings')}
            />
            {hasSettings && (
              <div className="ml-5 mt-2 space-y-2 border-l-2 border-muted pl-3">
                {SETTINGS_SUB_TABS.map(sub => (
                  <PermissionRow
                    key={sub.key}
                    label={sub.label}
                    checked={isChecked(sub.key)}
                    accessLevel={getAccessLevel(sub.key)}
                    onToggle={() => toggleTab(sub.key)}
                    onAccessLevelToggle={() => toggleAccessLevel(sub.key)}
                    compact
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

interface PermissionRowProps {
  label: string;
  checked: boolean;
  accessLevel: string;
  onToggle: () => void;
  onAccessLevelToggle: () => void;
  compact?: boolean;
  viewOnly?: boolean;
}

function PermissionRow({ label, checked, accessLevel, onToggle, onAccessLevelToggle, compact, viewOnly }: PermissionRowProps) {
  return (
    <div className={`flex items-center justify-between ${compact ? 'py-0.5' : 'py-1'}`}>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          id={`perm-${label}`}
        />
        <Label
          htmlFor={`perm-${label}`}
          className={`cursor-pointer ${compact ? 'text-xs' : 'text-sm'} ${!checked ? 'text-muted-foreground' : ''}`}
        >
          {label}
        </Label>
      </div>
      {checked && (
        viewOnly ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium">View only</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[200px]">
                <p className="text-xs">This tab has no editable actions — only view access is available.</p>
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className={`text-xs ${accessLevel === 'viewer' ? 'text-muted-foreground font-medium' : 'text-muted-foreground'}`}>
              View
            </span>
            <Switch
              checked={accessLevel === 'editor'}
              onCheckedChange={onAccessLevelToggle}
            />
            <span className={`text-xs ${accessLevel === 'editor' ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
              Edit
            </span>
          </div>
        )
      )}
    </div>
  );
}
