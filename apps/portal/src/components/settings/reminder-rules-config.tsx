import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Loader2, RotateCcw, Car, Shield, AlertTriangle, FileText, DollarSign, Settings2, KeyRound } from 'lucide-react';
import { useReminderRulesByCategory, useReminderRuleActions, type ReminderRule } from '@/hooks/use-reminder-rules';

const categoryIcons = {
  'Vehicle': Car,
  'Insurance': Shield,
  'Financial': DollarSign,
  'Document': FileText,
  'Immobiliser': KeyRound
};

const severityColors = {
  'info': 'bg-blue-100 text-blue-800 border-blue-200',
  'warning': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'critical': 'bg-red-100 text-red-800 border-red-200'
};

const ReminderRuleCard: React.FC<{
  rule: ReminderRule;
  onUpdate: (updates: { id: string; lead_days?: number; severity?: 'info' | 'warning' | 'critical'; is_enabled?: boolean }) => void;
  isLoading: boolean;
}> = ({ rule, onUpdate, isLoading }) => {
  const [leadDays, setLeadDays] = useState(rule.lead_days.toString());
  const [hasChanges, setHasChanges] = useState(false);

  const handleLeadDaysChange = (value: string) => {
    setLeadDays(value);
    setHasChanges(parseInt(value) !== rule.lead_days);
  };

  const handleSave = () => {
    const newLeadDays = parseInt(leadDays);
    if (newLeadDays !== rule.lead_days && !isNaN(newLeadDays) && newLeadDays >= 0) {
      onUpdate({ id: rule.id, lead_days: newLeadDays });
      setHasChanges(false);
    }
  };

  const handleReset = () => {
    setLeadDays(rule.lead_days.toString());
    setHasChanges(false);
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm">{rule.rule_type}</h4>
            <Badge className={`text-xs ${severityColors[rule.severity]}`}>
              {rule.severity.charAt(0).toUpperCase() + rule.severity.slice(1)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{rule.description}</p>
        </div>
        <Switch
          checked={rule.is_enabled}
          onCheckedChange={(enabled) => onUpdate({ id: rule.id, is_enabled: enabled })}
          disabled={isLoading}
        />
      </div>

      {rule.is_enabled && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor={`days-${rule.id}`} className="text-xs">
              {rule.is_recurring ? 'Days interval:' : 'Days before due:'}
            </Label>
            <Input
              id={`days-${rule.id}`}
              type="number"
              min="0"
              max="365"
              value={leadDays}
              onChange={(e) => handleLeadDaysChange(e.target.value)}
              className="w-20 h-8 text-xs"
              disabled={isLoading}
            />
            <span className="text-xs text-muted-foreground">
              {rule.is_recurring ? 
                (rule.interval_type === 'weekly' ? '(weekly)' :
                 rule.interval_type === 'bi-weekly' ? '(bi-weekly)' :
                 rule.interval_type === 'monthly' ? '(monthly)' :
                 '(recurring)') : 
                'days'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor={`severity-${rule.id}`} className="text-xs">
              Severity:
            </Label>
            <Select
              value={rule.severity}
              onValueChange={(severity) => onUpdate({ id: rule.id, severity: severity as any })}
              disabled={isLoading}
            >
              <SelectTrigger className="w-24 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasChanges && (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isLoading}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReset}
                disabled={isLoading}
              >
                Reset
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ReminderRulesConfig: React.FC = () => {
  const { data: groupedRules, isLoading, error } = useReminderRulesByCategory();
  const { updateRule, resetToDefaults, isLoading: isUpdating } = useReminderRuleActions();

  const handleRuleUpdate = (updates: { id: string; lead_days?: number; severity?: 'info' | 'warning' | 'critical'; is_enabled?: boolean }) => {
    updateRule.mutate(updates);
  };

  const handleResetAll = () => {
    resetToDefaults.mutate();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading reminder rules...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <h3 className="font-medium">Failed to load reminder rules</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {(error as Error).message || 'Unable to connect to database'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!groupedRules || Object.keys(groupedRules).length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p>No reminder rules found.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              Reminder Timing Rules
            </CardTitle>
            <CardDescription>
              Configure when reminders are generated for different types of events
            </CardDescription>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isUpdating}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset All Rules to Defaults?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will reset all reminder timing rules to their original default values. 
                  Any custom configurations will be lost.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetAll}>
                  Reset All Rules
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={Object.keys(groupedRules)[0]} className="space-y-4">
          <TabsList className="grid w-full auto-cols-fr" style={{ gridTemplateColumns: `repeat(${Object.keys(groupedRules).length}, 1fr)` }}>
            {Object.entries(groupedRules).map(([category]) => {
              const Icon = categoryIcons[category as keyof typeof categoryIcons] || Settings2;
              return (
                <TabsTrigger key={category} value={category} className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {category}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {Object.entries(groupedRules).map(([category, ruleTypes]) => (
            <TabsContent key={category} value={category} className="space-y-4">
          {Object.entries(ruleTypes).map(([ruleType, rules]) => (
            <div key={ruleType} className="space-y-3">
              <div className="space-y-1">
                <h3 className="font-medium text-sm flex items-center gap-2">
                  {ruleType === 'Expiry' ? 'Policy Expiry Reminders' : 
                   ruleType === 'Verification' ? 'Insurance Verification Reminders' : 
                   `${ruleType} Reminders`}
                  <Badge variant="secondary" className="text-xs">
                    {rules.filter(r => r.is_enabled).length} active
                  </Badge>
                </h3>
                 <p className="text-xs text-muted-foreground">
                   {ruleType === 'Expiry' ? 'Reminders sent before insurance policies expire' :
                    ruleType === 'Verification' ? 'Recurring reminders to verify insurance is still active during rentals' :
                    ruleType === 'Immobiliser' ? 'Reminders to fit immobilisers on vehicles that don\'t have them' :
                    `Configure ${ruleType.toLowerCase()} reminder settings`}
                 </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {rules.map((rule) => (
                  <ReminderRuleCard
                    key={rule.id}
                    rule={rule}
                    onUpdate={handleRuleUpdate}
                    isLoading={isUpdating}
                  />
                ))}
              </div>
            </div>
          ))}
            </TabsContent>
          ))}
        </Tabs>

        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium text-sm mb-2">How Reminder Rules Work</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• <strong>Lead Days:</strong> How many days before the due date to generate the reminder</li>
            <li>• <strong>Severity:</strong> Priority level of the reminder (affects sorting and display)</li>
            <li>• <strong>Enable/Disable:</strong> Turn specific timing rules on or off</li>
            <li>• Changes take effect immediately and apply to future reminder generation</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default ReminderRulesConfig;