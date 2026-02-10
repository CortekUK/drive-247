'use client';

import React, { useState, useEffect } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, Save, Loader2, Copy } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuditLog } from '@/hooks/use-audit-log';
import { getTimezonesByRegion, findTimezone } from '@/lib/timezones';

const DAYS_OF_WEEK = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
] as const;

type DayKey = typeof DAYS_OF_WEEK[number]['key'];

interface DaySchedule {
  enabled: boolean;
  open: string;
  close: string;
}

interface WorkingHoursForm {
  working_hours_always_open: boolean;
  timezone: string;
  schedule: Record<DayKey, DaySchedule>;
}

const DEFAULT_SCHEDULE: Record<DayKey, DaySchedule> = {
  monday: { enabled: true, open: '09:00', close: '17:00' },
  tuesday: { enabled: true, open: '09:00', close: '17:00' },
  wednesday: { enabled: true, open: '09:00', close: '17:00' },
  thursday: { enabled: true, open: '09:00', close: '17:00' },
  friday: { enabled: true, open: '09:00', close: '17:00' },
  saturday: { enabled: false, open: '10:00', close: '14:00' },
  sunday: { enabled: false, open: '10:00', close: '14:00' },
};

export function WorkingHoursCard() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const [isSaving, setIsSaving] = useState(false);

  // Fetch working hours data directly
  const { data: workingHoursData, isLoading } = useQuery({
    queryKey: ['working-hours', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return null;

      const { data, error } = await supabase
        .from('tenants')
        .select(`
          working_hours_always_open,
          timezone,
          monday_enabled, monday_open, monday_close,
          tuesday_enabled, tuesday_open, tuesday_close,
          wednesday_enabled, wednesday_open, wednesday_close,
          thursday_enabled, thursday_open, thursday_close,
          friday_enabled, friday_open, friday_close,
          saturday_enabled, saturday_open, saturday_close,
          sunday_enabled, sunday_open, sunday_close
        `)
        .eq('id', tenant.id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!tenant?.id,
  });

  // Working hours form state
  const [form, setForm] = useState<WorkingHoursForm>({
    working_hours_always_open: false,
    timezone: 'America/Chicago',
    schedule: { ...DEFAULT_SCHEDULE },
  });

  // Sync form with loaded data
  useEffect(() => {
    if (workingHoursData) {
      setForm({
        working_hours_always_open: workingHoursData.working_hours_always_open ?? false,
        timezone: tenant?.timezone ?? 'America/Chicago',
        schedule: {
          monday: {
            enabled: workingHoursData.monday_enabled ?? true,
            open: workingHoursData.monday_open ?? '09:00',
            close: workingHoursData.monday_close ?? '17:00',
          },
          tuesday: {
            enabled: workingHoursData.tuesday_enabled ?? true,
            open: workingHoursData.tuesday_open ?? '09:00',
            close: workingHoursData.tuesday_close ?? '17:00',
          },
          wednesday: {
            enabled: workingHoursData.wednesday_enabled ?? true,
            open: workingHoursData.wednesday_open ?? '09:00',
            close: workingHoursData.wednesday_close ?? '17:00',
          },
          thursday: {
            enabled: workingHoursData.thursday_enabled ?? true,
            open: workingHoursData.thursday_open ?? '09:00',
            close: workingHoursData.thursday_close ?? '17:00',
          },
          friday: {
            enabled: workingHoursData.friday_enabled ?? true,
            open: workingHoursData.friday_open ?? '09:00',
            close: workingHoursData.friday_close ?? '17:00',
          },
          saturday: {
            enabled: workingHoursData.saturday_enabled ?? false,
            open: workingHoursData.saturday_open ?? '10:00',
            close: workingHoursData.saturday_close ?? '14:00',
          },
          sunday: {
            enabled: workingHoursData.sunday_enabled ?? false,
            open: workingHoursData.sunday_open ?? '10:00',
            close: workingHoursData.sunday_close ?? '14:00',
          },
        },
      });
    }
  }, [workingHoursData, tenant?.timezone]);

  const updateDaySchedule = (day: DayKey, field: keyof DaySchedule, value: boolean | string) => {
    setForm(prev => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [day]: {
          ...prev.schedule[day],
          [field]: value,
        },
      },
    }));
  };

  const copyToAllDays = (sourceDay: DayKey) => {
    const sourceSchedule = form.schedule[sourceDay];
    setForm(prev => ({
      ...prev,
      schedule: DAYS_OF_WEEK.reduce((acc, { key }) => ({
        ...acc,
        [key]: { ...sourceSchedule },
      }), {} as Record<DayKey, DaySchedule>),
    }));
    toast({
      title: "Copied",
      description: `${sourceDay.charAt(0).toUpperCase() + sourceDay.slice(1)}'s hours copied to all days`,
    });
  };

  const handleSave = async () => {
    if (!tenant?.id) return;

    setIsSaving(true);
    try {
      const updateData: Record<string, any> = {
        working_hours_always_open: form.working_hours_always_open,
        working_hours_enabled: true,
        timezone: form.timezone,
        // Per-day schedule
        monday_enabled: form.schedule.monday.enabled,
        monday_open: form.schedule.monday.open,
        monday_close: form.schedule.monday.close,
        tuesday_enabled: form.schedule.tuesday.enabled,
        tuesday_open: form.schedule.tuesday.open,
        tuesday_close: form.schedule.tuesday.close,
        wednesday_enabled: form.schedule.wednesday.enabled,
        wednesday_open: form.schedule.wednesday.open,
        wednesday_close: form.schedule.wednesday.close,
        thursday_enabled: form.schedule.thursday.enabled,
        thursday_open: form.schedule.thursday.open,
        thursday_close: form.schedule.thursday.close,
        friday_enabled: form.schedule.friday.enabled,
        friday_open: form.schedule.friday.open,
        friday_close: form.schedule.friday.close,
        saturday_enabled: form.schedule.saturday.enabled,
        saturday_open: form.schedule.saturday.open,
        saturday_close: form.schedule.saturday.close,
        sunday_enabled: form.schedule.sunday.enabled,
        sunday_open: form.schedule.sunday.open,
        sunday_close: form.schedule.sunday.close,
      };

      const { error } = await supabase
        .from('tenants')
        .update(updateData)
        .eq('id', tenant.id);

      if (error) throw error;

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: ['working-hours', tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['tenant'] });

      toast({
        title: "Success",
        description: "Working hours updated successfully",
      });
      logAction({
        action: "working_hours_updated",
        entityType: "working_hours",
        entityId: tenant.id,
        details: { always_open: form.working_hours_always_open, timezone: form.timezone },
      });
    } catch (error) {
      console.error('Failed to update working hours:', error);
      toast({
        title: "Error",
        description: "Failed to update working hours settings",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Working Hours
        </CardTitle>
        <CardDescription>
          Set when your business accepts bookings. Customers can only select pickup and drop-off times during open hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Always Open Toggle */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-1">
            <h4 className="font-medium">24/7 Always Open</h4>
            <p className="text-sm text-muted-foreground">
              Allow bookings at any time without restrictions
            </p>
          </div>
          <Switch
            checked={form.working_hours_always_open}
            onCheckedChange={(checked) => {
              setForm(prev => ({ ...prev, working_hours_always_open: checked }));
            }}
          />
        </div>

        {/* Business Timezone Selection */}
        <div className="space-y-2">
          <Label htmlFor="business_timezone">Business Timezone</Label>
          <Select
            value={form.timezone}
            onValueChange={(value) => setForm(prev => ({ ...prev, timezone: value }))}
          >
            <SelectTrigger id="business_timezone" className="w-full">
              <SelectValue placeholder="Select your business timezone">
                {findTimezone(form.timezone)?.label || form.timezone}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {getTimezonesByRegion().map((group) => (
                <React.Fragment key={group.region}>
                  <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground bg-muted/50">
                    {group.label}
                  </div>
                  {group.timezones.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </React.Fragment>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            All times are in this timezone. Customers in different timezones will see converted times.
          </p>
        </div>

        {/* Per-Day Schedule (shown when not 24/7) */}
        {!form.working_hours_always_open && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Weekly Schedule</Label>
            </div>

            <div className="border rounded-lg divide-y">
              {DAYS_OF_WEEK.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-4 p-4">
                  {/* Day Toggle */}
                  <div className="flex items-center gap-3 min-w-[140px]">
                    <Switch
                      checked={form.schedule[key].enabled}
                      onCheckedChange={(checked) => updateDaySchedule(key, 'enabled', checked)}
                    />
                    <span className={`font-medium ${!form.schedule[key].enabled ? 'text-muted-foreground' : ''}`}>
                      {label}
                    </span>
                  </div>

                  {/* Time Inputs */}
                  {form.schedule[key].enabled ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        type="time"
                        value={form.schedule[key].open}
                        onChange={(e) => updateDaySchedule(key, 'open', e.target.value)}
                        className="w-32"
                      />
                      <span className="text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={form.schedule[key].close}
                        onChange={(e) => updateDaySchedule(key, 'close', e.target.value)}
                        className="w-32"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToAllDays(key)}
                        className="ml-2 text-xs"
                        title="Copy to all days"
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copy to all
                      </Button>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Closed</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Working Hours
        </Button>
      </CardContent>
    </Card>
  );
}
