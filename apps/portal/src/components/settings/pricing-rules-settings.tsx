'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Pencil, Trash2, TrendingUp, Calendar, Save } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useWeekendPricing } from '@/hooks/use-weekend-pricing';
import { useTenantHolidays, type TenantHolidayInsert, type TenantHolidayUpdate } from '@/hooks/use-tenant-holidays';
import { format } from 'date-fns';

const DAY_LABELS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

interface HolidayFormState {
  name: string;
  start_date: string;
  end_date: string;
  surcharge_percent: number | '';
  recurs_annually: boolean;
}

const emptyHolidayForm: HolidayFormState = {
  name: '',
  start_date: '',
  end_date: '',
  surcharge_percent: '',
  recurs_annually: false,
};

export function PricingRulesSettings() {
  const { settings: weekendSettings, isLoading: weekendLoading, updateSettings: updateWeekend, isUpdating: weekendUpdating } = useWeekendPricing();
  const { holidays, isLoading: holidaysLoading, addHoliday, isAdding, updateHoliday, isUpdating: holidayUpdating, deleteHoliday, isDeleting } = useTenantHolidays();

  // Weekend form state
  const [weekendPercent, setWeekendPercent] = useState<number | ''>(weekendSettings.weekend_surcharge_percent || '');
  const [weekendDays, setWeekendDays] = useState<number[]>(weekendSettings.weekend_days || [6, 0]);
  const [weekendDirty, setWeekendDirty] = useState(false);

  // Holiday dialog state
  const [holidayDialogOpen, setHolidayDialogOpen] = useState(false);
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);
  const [holidayForm, setHolidayForm] = useState<HolidayFormState>(emptyHolidayForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Sync weekend form when data loads
  React.useEffect(() => {
    if (!weekendLoading) {
      setWeekendPercent(weekendSettings.weekend_surcharge_percent || '');
      setWeekendDays(weekendSettings.weekend_days || [6, 0]);
      setWeekendDirty(false);
    }
  }, [weekendLoading, weekendSettings.weekend_surcharge_percent, weekendSettings.weekend_days]);

  const handleWeekendDayToggle = (day: number) => {
    if (!weekendDays.includes(day) && weekendDays.length >= 3) {
      toast({ title: 'Limit Reached', description: 'You can select up to 3 weekend days.', variant: 'destructive' });
      return;
    }
    setWeekendDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
    setWeekendDirty(true);
  };

  const handleSaveWeekend = async () => {
    await updateWeekend({
      weekend_surcharge_percent: Number(weekendPercent) || 0,
      weekend_days: weekendDays,
    });
    setWeekendDirty(false);
  };

  const openAddHoliday = () => {
    setEditingHolidayId(null);
    setHolidayForm(emptyHolidayForm);
    setHolidayDialogOpen(true);
  };

  const openEditHoliday = (holiday: typeof holidays[0]) => {
    setEditingHolidayId(holiday.id);
    setHolidayForm({
      name: holiday.name,
      start_date: holiday.start_date,
      end_date: holiday.end_date,
      surcharge_percent: holiday.surcharge_percent,
      recurs_annually: holiday.recurs_annually,
    });
    setHolidayDialogOpen(true);
  };

  const handleSaveHoliday = async () => {
    const payload = {
      name: holidayForm.name,
      start_date: holidayForm.start_date,
      end_date: holidayForm.end_date,
      surcharge_percent: Number(holidayForm.surcharge_percent) || 0,
      recurs_annually: holidayForm.recurs_annually,
      excluded_vehicle_ids: [],
    };

    if (editingHolidayId) {
      await updateHoliday({ id: editingHolidayId, ...payload });
    } else {
      await addHoliday(payload as TenantHolidayInsert);
    }
    setHolidayDialogOpen(false);
  };

  const handleDeleteHoliday = async () => {
    if (!deleteConfirmId) return;
    await deleteHoliday(deleteConfirmId);
    setDeleteConfirmId(null);
  };

  const isHolidayFormValid = holidayForm.name.trim() &&
    holidayForm.start_date &&
    holidayForm.end_date &&
    holidayForm.end_date >= holidayForm.start_date &&
    Number(holidayForm.surcharge_percent) >= 0;

  if (weekendLoading || holidaysLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Weekend Pricing Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Weekend Pricing
          </CardTitle>
          <CardDescription>
            Apply a surcharge percentage to the daily rate on selected days. Only affects bookings under 7 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="weekend-percent">Surcharge (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="weekend-percent"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={weekendPercent}
                  onChange={e => {
                    setWeekendPercent(e.target.value === '' ? '' : Number(e.target.value));
                    setWeekendDirty(true);
                  }}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Weekend Days</Label>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map(day => {
                  const isSelected = weekendDays.includes(day.value);
                  const isAtLimit = !isSelected && weekendDays.length >= 3;
                  return (
                  <button
                    key={day.value}
                    type="button"
                    disabled={isAtLimit}
                    onClick={() => handleWeekendDayToggle(day.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : isAtLimit
                          ? 'bg-muted text-muted-foreground/40 border-input cursor-not-allowed'
                          : 'bg-background text-muted-foreground border-input hover:bg-muted/50'
                    }`}
                  >
                    {day.label}
                  </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveWeekend}
              disabled={!weekendDirty || weekendUpdating}
              size="sm"
            >
              {weekendUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save Weekend Pricing
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Holiday Pricing Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Holiday Pricing
              </CardTitle>
              <CardDescription>
                Define holiday periods with custom surcharges. Holidays take priority over weekend pricing.
              </CardDescription>
            </div>
            <Button onClick={openAddHoliday} size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Holiday
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {holidays.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No holiday pricing rules configured yet. Add one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Surcharge</TableHead>
                  <TableHead>Recurs</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map(holiday => (
                  <TableRow key={holiday.id}>
                    <TableCell className="font-medium">{holiday.name}</TableCell>
                    <TableCell className="text-sm">
                      {formatDateDisplay(holiday.start_date)}
                      {holiday.start_date !== holiday.end_date && (
                        <> &ndash; {formatDateDisplay(holiday.end_date)}</>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">+{holiday.surcharge_percent}%</Badge>
                    </TableCell>
                    <TableCell>
                      {holiday.recurs_annually ? (
                        <Badge variant="outline" className="text-xs">Yearly</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">One-time</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditHoliday(holiday)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteConfirmId(holiday.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Holiday Add/Edit Dialog */}
      <Dialog open={holidayDialogOpen} onOpenChange={setHolidayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingHolidayId ? 'Edit Holiday' : 'Add Holiday'}</DialogTitle>
            <DialogDescription>
              Configure a holiday period with a surcharge that applies to daily-tier bookings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="holiday-name">Name</Label>
              <Input
                id="holiday-name"
                placeholder="e.g. Christmas, Bank Holiday"
                value={holidayForm.name}
                onChange={e => setHolidayForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="holiday-start">Start Date</Label>
                <Input
                  id="holiday-start"
                  type="date"
                  value={holidayForm.start_date}
                  onChange={e => setHolidayForm(prev => ({ ...prev, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="holiday-end">End Date</Label>
                <Input
                  id="holiday-end"
                  type="date"
                  value={holidayForm.end_date}
                  min={holidayForm.start_date}
                  onChange={e => setHolidayForm(prev => ({ ...prev, end_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="holiday-surcharge">Surcharge (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="holiday-surcharge"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={holidayForm.surcharge_percent}
                  onChange={e => setHolidayForm(prev => ({
                    ...prev,
                    surcharge_percent: e.target.value === '' ? '' : Number(e.target.value),
                  }))}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="holiday-recurs"
                checked={holidayForm.recurs_annually}
                onCheckedChange={checked => setHolidayForm(prev => ({ ...prev, recurs_annually: checked }))}
              />
              <Label htmlFor="holiday-recurs" className="text-sm">Recurs annually</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setHolidayDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveHoliday}
              disabled={!isHolidayFormValid || isAdding || holidayUpdating}
            >
              {(isAdding || holidayUpdating) && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {editingHolidayId ? 'Update' : 'Add'} Holiday
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={open => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Holiday?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this holiday pricing rule and any vehicle-specific overrides for it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteHoliday} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatDateDisplay(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return format(date, 'MMM d, yyyy');
  } catch {
    return dateStr;
  }
}
