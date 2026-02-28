'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Clock, Save, Loader2, Copy, ChevronDown } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuditLog } from '@/hooks/use-audit-log';
import { getTimezonesByRegion, findTimezone } from '@/lib/timezones';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';

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

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1–12
const MINUTES = Array.from({ length: 60 }, (_, i) => i);   // 0–59
const PERIODS = ['AM', 'PM'] as const;

/** Convert 24h "HH:mm" → { hour12, minute, period } */
function parse24(time: string) {
  const [h, m] = time.split(':').map(Number);
  const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { hour12, minute: m, period };
}

/** Convert { hour12, minute, period } → 24h "HH:mm" */
function to24(hour12: number, minute: number, period: 'AM' | 'PM') {
  let h = hour12;
  if (period === 'AM' && h === 12) h = 0;
  if (period === 'PM' && h !== 12) h += 12;
  return `${h.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

/** Format "HH:mm" → display string like "9:00 AM" */
function formatTime(time: string) {
  const { hour12, minute, period } = parse24(time);
  return `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
}

function ScrollColumn({ items, selected, onSelect, formatItem }: {
  items: readonly (string | number)[];
  selected: string | number;
  onSelect: (v: string | number) => void;
  formatItem?: (v: string | number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string | number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const el = itemRefs.current.get(selected);
    if (el && containerRef.current) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [selected]);

  return (
    <div ref={containerRef} className="flex flex-col overflow-y-auto h-[200px] scrollbar-thin px-0.5">
      {items.map((item) => (
        <button
          key={item}
          ref={(el) => { if (el) itemRefs.current.set(item, el); }}
          type="button"
          onClick={() => onSelect(item)}
          className={`shrink-0 px-3 py-1.5 text-sm rounded-md text-center transition-colors ${
            item === selected
              ? 'bg-primary text-primary-foreground font-medium'
              : 'hover:bg-muted text-foreground'
          }`}
        >
          {formatItem ? formatItem(item) : String(item)}
        </button>
      ))}
    </div>
  );
}

function TimeSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { hour12, minute, period } = parse24(value);

  const handleChange = useCallback((h: number, m: number, p: 'AM' | 'PM') => {
    onChange(to24(h, m, p));
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="w-[130px] justify-between font-normal"
        >
          {formatTime(value)}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex gap-1">
          {/* Hours */}
          <ScrollColumn
            items={HOURS}
            selected={hour12}
            onSelect={(h) => handleChange(h as number, minute, period)}
          />
          {/* Divider */}
          <div className="w-px bg-border" />
          {/* Minutes */}
          <ScrollColumn
            items={MINUTES}
            selected={minute}
            onSelect={(m) => handleChange(hour12, m as number, period)}
            formatItem={(m) => String(m).padStart(2, '0')}
          />
          {/* Divider */}
          <div className="w-px bg-border" />
          {/* AM/PM */}
          <ScrollColumn
            items={PERIODS}
            selected={period}
            onSelect={(p) => handleChange(hour12, minute, p as 'AM' | 'PM')}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
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
  const { canEdit } = useManagerPermissions();
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
    working_hours_always_open: true,
    timezone: 'America/Chicago',
    schedule: { ...DEFAULT_SCHEDULE },
  });

  // Sync form with loaded data
  useEffect(() => {
    if (workingHoursData) {
      setForm({
        working_hours_always_open: workingHoursData.working_hours_always_open ?? true,
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
            disabled={!canEdit('availability')}
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
                      disabled={!canEdit('availability')}
                    />
                    <span className={`font-medium ${!form.schedule[key].enabled ? 'text-muted-foreground' : ''}`}>
                      {label}
                    </span>
                  </div>

                  {/* Time Inputs */}
                  {form.schedule[key].enabled ? (
                    <div className="flex items-center gap-2 flex-1">
                      <TimeSelect
                        value={form.schedule[key].open}
                        onChange={(v) => updateDaySchedule(key, 'open', v)}
                        disabled={!canEdit('availability')}
                      />
                      <span className="text-muted-foreground">to</span>
                      <TimeSelect
                        value={form.schedule[key].close}
                        onChange={(v) => updateDaySchedule(key, 'close', v)}
                        disabled={!canEdit('availability')}
                      />
                      {canEdit('availability') && (
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
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Closed</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {canEdit('availability') && (
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 w-full sm:w-auto">
                  Reset to Defaults
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Working Hours?</AlertDialogTitle>
                  <div className="text-sm text-muted-foreground">
                    This will reset working hours to their default values:
                    <ul className="mt-2 list-disc list-inside space-y-1">
                      <li>Always Open: Enabled (24/7)</li>
                      <li>Mon–Fri: 9:00 AM – 5:00 PM</li>
                      <li>Sat–Sun: Closed (10:00 AM – 2:00 PM if enabled)</li>
                    </ul>
                    <p className="mt-2">Your timezone will remain unchanged.</p>
                  </div>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const defaultForm: WorkingHoursForm = {
                        working_hours_always_open: true,
                        timezone: form.timezone,
                        schedule: { ...DEFAULT_SCHEDULE },
                      };
                      setForm(defaultForm);

                      if (!tenant?.id) return;
                      setIsSaving(true);
                      try {
                        const updateData: Record<string, any> = {
                          working_hours_always_open: true,
                          working_hours_enabled: true,
                          timezone: form.timezone,
                          monday_enabled: DEFAULT_SCHEDULE.monday.enabled,
                          monday_open: DEFAULT_SCHEDULE.monday.open,
                          monday_close: DEFAULT_SCHEDULE.monday.close,
                          tuesday_enabled: DEFAULT_SCHEDULE.tuesday.enabled,
                          tuesday_open: DEFAULT_SCHEDULE.tuesday.open,
                          tuesday_close: DEFAULT_SCHEDULE.tuesday.close,
                          wednesday_enabled: DEFAULT_SCHEDULE.wednesday.enabled,
                          wednesday_open: DEFAULT_SCHEDULE.wednesday.open,
                          wednesday_close: DEFAULT_SCHEDULE.wednesday.close,
                          thursday_enabled: DEFAULT_SCHEDULE.thursday.enabled,
                          thursday_open: DEFAULT_SCHEDULE.thursday.open,
                          thursday_close: DEFAULT_SCHEDULE.thursday.close,
                          friday_enabled: DEFAULT_SCHEDULE.friday.enabled,
                          friday_open: DEFAULT_SCHEDULE.friday.open,
                          friday_close: DEFAULT_SCHEDULE.friday.close,
                          saturday_enabled: DEFAULT_SCHEDULE.saturday.enabled,
                          saturday_open: DEFAULT_SCHEDULE.saturday.open,
                          saturday_close: DEFAULT_SCHEDULE.saturday.close,
                          sunday_enabled: DEFAULT_SCHEDULE.sunday.enabled,
                          sunday_open: DEFAULT_SCHEDULE.sunday.open,
                          sunday_close: DEFAULT_SCHEDULE.sunday.close,
                        };
                        const { error } = await supabase.from('tenants').update(updateData).eq('id', tenant.id);
                        if (error) throw error;
                        queryClient.invalidateQueries({ queryKey: ['working-hours', tenant.id] });
                        queryClient.invalidateQueries({ queryKey: ['tenant'] });
                        toast({ title: "Settings Reset", description: "Working hours have been restored to defaults." });
                      } catch (error) {
                        console.error('Failed to reset working hours:', error);
                        toast({ title: "Error", description: "Failed to reset working hours", variant: "destructive" });
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                  >
                    Reset to Defaults
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 w-full sm:w-auto"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Working Hours
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
