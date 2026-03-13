'use client';

import React, { useState } from 'react';
import { useReminders, useReminderStats, useReminderActions, type ReminderFilters } from '@/hooks/use-reminders';
import { AddReminderDialog } from '@/components/reminders/add-reminder-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Bell,
  Calendar,
  Download,
  Plus,
  MoreHorizontal,
  Shield,
  BarChart3,
  X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Image from 'next/image';
import Link from 'next/link';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';

const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

const SEVERITY_ICONS = {
  critical: AlertTriangle,
  warning: Clock,
  info: Bell
};

export default function RemindersPageEnhanced() {
  const [filters, setFilters] = useState<ReminderFilters>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const { canEdit } = useManagerPermissions();

  const { data: reminders = [], isLoading, error } = useReminders(filters);
  const { data: stats } = useReminderStats();
  const { markDone, dismiss, snooze, bulkUpdate, isLoading: isUpdating } = useReminderActions();

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(reminders.map(r => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectReminder = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
    }
  };

  const handleBulkAction = (action: string, snoozeUntil?: string) => {
    if (selectedIds.length === 0) return;

    bulkUpdate.mutate({
      ids: selectedIds,
      action,
      snoozeUntil,
      note: `Bulk ${action} operation`
    });

    setSelectedIds([]);
  };

  const exportReminders = () => {
    const csv = [
      'ID,Rule Code,Object Type,Object ID,Title,Message,Due On,Remind On,Severity,Created At,Updated At',
      ...reminders.map(r => [
        r.id,
        r.rule_code,
        r.object_type,
        r.object_id,
        `"${r.title}"`,
        `"${r.message}"`,
        r.due_on,
        r.remind_on,
        r.severity,
        r.created_at,
        r.updated_at
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reminders_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  const getSeverityIcon = (severity: string) => {
    const Icon = SEVERITY_ICONS[severity as keyof typeof SEVERITY_ICONS] || Bell;
    return <Icon className="h-4 w-4" />;
  };

  const getObjectLink = (reminder: any) => {
    const baseClasses = "text-primary hover:underline";
    const objectId = reminder.object_id;

    switch (reminder.object_type) {
      case 'Vehicle':
        return <Link href={`/vehicles/${objectId}`} className={baseClasses}>{reminder.context?.reg || objectId}</Link>;
      case 'Customer':
        return <Link href={`/customers/${objectId}`} className={baseClasses}>{reminder.context?.customer_name || objectId}</Link>;
      case 'Rental':
        return <Link href={`/rentals/${objectId}`} className={baseClasses}>Rental</Link>;
      case 'Fine':
        return <Link href={`/fines/${objectId}`} className={baseClasses}>{reminder.context?.reference || objectId}</Link>;
      case 'Integration':
        return (
          <Link href="/settings?tab=integrations" className="inline-block hover:opacity-80">
            <Image src="/bonzah-logo.svg" alt="Bonzah" width={72} height={23} className="dark:hidden" />
            <Image src="/bonzah-logo-dark.svg" alt="Bonzah" width={72} height={23} className="hidden dark:block" />
          </Link>
        );
      default:
        return <span className="text-muted-foreground">{objectId}</span>;
    }
  };

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Error Loading Reminders</h3>
              <p className="text-muted-foreground">{error.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Reminders</h1>
          <p className="text-muted-foreground">Monitor and manage fleet compliance reminders</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={exportReminders}
            disabled={reminders.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>

          <Link href="/reminders/analytics">
            <Button variant="outline" size="icon">
              <BarChart3 className="h-4 w-4" />
            </Button>
          </Link>

          {canEdit('reminders') && (
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Reminder
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 border-indigo-500/20 hover:border-indigo-500/40 transition-all duration-200 cursor-pointer hover:shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
            <p className="text-xs text-muted-foreground">All pending & snoozed</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20 hover:border-warning/40 transition-all duration-200 cursor-pointer hover:shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Due Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{stats?.due || 0}</div>
            <p className="text-xs text-muted-foreground">Require attention</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/20 hover:border-destructive/40 transition-all duration-200 cursor-pointer hover:shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats?.critical || 0}</div>
            <p className="text-xs text-muted-foreground">Urgent action needed</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Select
          value={filters.severity?.[0] || ''}
          onValueChange={(value) =>
            setFilters(prev => ({ ...prev, severity: value ? [value] : undefined }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.object_type?.[0] || ''}
          onValueChange={(value) =>
            setFilters(prev => ({ ...prev, object_type: value ? [value] : undefined }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Vehicle">Vehicle</SelectItem>
            <SelectItem value="Rental">Rental</SelectItem>
            <SelectItem value="Customer">Customer</SelectItem>
            <SelectItem value="Fine">Fine</SelectItem>
            <SelectItem value="Integration">Integration</SelectItem>
            <SelectItem value="Document">Document</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          onClick={() => setFilters({})}
          className="w-fit"
        >
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>

      {/* Bulk Actions */}
      {canEdit('reminders') && selectedIds.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {selectedIds.length} reminder{selectedIds.length !== 1 ? 's' : ''} selected
              </span>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleBulkAction('done')}
                  disabled={isUpdating}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark Done
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulkAction('dismissed')}
                  disabled={isUpdating}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Dismiss
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reminders Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            All Reminders ({reminders.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-4 text-muted-foreground">Loading reminders...</p>
            </div>
          ) : reminders.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Reminders</h3>
              <p className="text-muted-foreground mb-4">No reminders match your current filters.</p>
              {canEdit('reminders') && (
                <Button
                  variant="outline"
                  onClick={() => setShowAddDialog(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create a Reminder
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border max-h-[calc(100vh-420px)] min-h-[300px] overflow-auto relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-[50px]">
                      {canEdit('reminders') && (
                        <Checkbox
                          checked={selectedIds.length === reminders.length}
                          onCheckedChange={handleSelectAll}
                        />
                      )}
                    </TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-center">Object</TableHead>
                    <TableHead>Due On</TableHead>
                    <TableHead>Remind On</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reminders.map((reminder) => {
                    const isIntegration = reminder.object_type === 'Integration';
                    return (
                    <TableRow key={reminder.id} className={isIntegration ? 'bg-amber-50/50 dark:bg-amber-950/10' : undefined}>
                      <TableCell>
                        {canEdit('reminders') && (
                          <Checkbox
                            checked={selectedIds.includes(reminder.id)}
                            onCheckedChange={(checked) =>
                              handleSelectReminder(reminder.id, checked as boolean)
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          {getSeverityIcon(reminder.severity)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{reminder.title}</div>
                          {!isIntegration && (
                            <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                              {reminder.message}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div>
                          <div>{getObjectLink(reminder)}</div>
                          {!isIntegration && (
                            <div className="text-xs text-muted-foreground">
                              {reminder.object_type}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {isIntegration
                            ? ''
                            : format(parseISO(reminder.due_on), 'MMM dd, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {isIntegration ? (
                            reminder.context?.alerted ? (
                              <Badge variant="destructive" className="text-xs">Triggered</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">Monitoring</Badge>
                            )
                          ) : (
                            format(parseISO(reminder.remind_on), 'MMM dd, yyyy')
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEdit('reminders') && (
                              <DropdownMenuItem onClick={() => markDone(reminder.id)}>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Mark Done
                              </DropdownMenuItem>
                            )}
                            {canEdit('reminders') && (
                              <DropdownMenuItem onClick={() => dismiss(reminder.id)}>
                                <XCircle className="h-4 w-4 mr-2" />
                                Dismiss
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <AddReminderDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
    </div>
  );
}
