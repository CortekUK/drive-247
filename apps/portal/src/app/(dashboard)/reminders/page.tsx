'use client';

import React, { useState } from 'react';
import { useReminders, useReminderStats, useReminderActions, type ReminderFilters } from '@/hooks/use-reminders';
import { AddReminderDialog } from '@/components/reminders/add-reminder-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Bell,
  Download,
  Plus,
  MoreHorizontal,
  BarChart3,
  X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import Image from 'next/image';
import Link from 'next/link';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import {
  Tile,
  KpiTile,
  Eyebrow,
  StatusPill,
  TableTile,
  bentoTable,
  EmptyState,
  ErrorState,
  TableSkeleton,
  KpiTileSkeletonRow,
} from '@/components/bento';

const SEVERITY_ICONS = {
  critical: AlertTriangle,
  warning: Clock,
  info: Bell,
};

const SEVERITY_TONE = {
  critical: 'text-[color:var(--bento-danger-fg)]',
  warning: 'text-[color:var(--bento-warn-accent)]',
  info: 'text-[color:var(--bento-info)]',
} as const;

export default function RemindersPageEnhanced() {
  const [filters, setFilters] = useState<ReminderFilters>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const { canEdit } = useManagerPermissions();

  const { data: reminders = [], isLoading, error, refetch } = useReminders(filters);
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
    const tone = SEVERITY_TONE[severity as keyof typeof SEVERITY_TONE] || 'text-muted-foreground';
    return <Icon className={`h-4 w-4 ${tone}`} />;
  };

  const getObjectLink = (reminder: any) => {
    const baseClasses = "text-primary hover:underline font-medium";
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
          <Link href="/settings?tab=insurance" className="inline-block hover:opacity-80">
            <Image src="/bonzah-logo.svg" alt="Bonzah" width={72} height={23} className="dark:hidden" />
            <Image src="/bonzah-logo-dark.svg" alt="Bonzah" width={72} height={23} className="hidden dark:block" />
          </Link>
        );
      default:
        return <span className="text-muted-foreground">{objectId}</span>;
    }
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0">
          <Eyebrow>Compliance</Eyebrow>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight">Reminders</h1>
          <p className="text-muted-foreground text-sm sm:text-base">Monitor and manage fleet compliance reminders</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={exportReminders}
            disabled={reminders.length === 0}
            className="shrink-0"
          >
            <Download className="h-4 w-4" />
          </Button>

          <Link href="/reminders/analytics" className="shrink-0">
            <Button variant="outline" size="icon">
              <BarChart3 className="h-4 w-4" />
            </Button>
          </Link>

          {canEdit('reminders') && (
            <Button onClick={() => setShowAddDialog(true)} className="flex-1 sm:flex-none">
              <Plus className="h-4 w-4 mr-2" />
              New Reminder
            </Button>
          )}
        </div>
      </div>

      {/* Stats Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        <KpiTile
          variant="hero"
          label="Total Active"
          value={stats?.total || 0}
          sub="All pending & snoozed"
          icon={<Bell className="h-4 w-4" />}
        />
        <KpiTile
          variant="warn"
          label="Due Today"
          value={stats?.due || 0}
          sub="Require attention"
          icon={<Clock className="h-4 w-4" />}
        />
        <KpiTile
          label="Critical"
          value={stats?.critical || 0}
          sub="Urgent action needed"
          icon={<AlertTriangle className="h-4 w-4 text-[color:var(--bento-danger-fg)]" />}
          className="col-span-2 md:col-span-1"
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
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
        <Tile variant="inset" className="flex items-center justify-between">
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
        </Tile>
      )}

      {/* Reminders Table */}
      {error ? (
        <ErrorState
          title="Error loading reminders"
          description={error.message}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <TableSkeleton rows={8} cols={7} />
      ) : reminders.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-5 w-5" />}
          title="No reminders"
          description="No reminders match your current filters."
          action={
            canEdit('reminders') ? (
              <Button variant="outline" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create a Reminder
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableTile
          toolbar={
            <Eyebrow>All Reminders ({reminders.length})</Eyebrow>
          }
        >
          <div className="max-h-[calc(100vh-460px)] min-h-[300px] overflow-auto relative">
            <Table>
              <TableHeader className={`sticky top-0 z-10 ${bentoTable.header}`}>
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
                  <TableRow key={reminder.id} className={`border-border ${isIntegration ? '[background:var(--bento-warn-bg)]' : ''}`}>
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
                        <div className="font-medium text-foreground">{reminder.title}</div>
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
                      <div className="text-sm font-mono tabular-nums text-muted-foreground">
                        {isIntegration
                          ? ''
                          : format(parseISO(reminder.due_on), 'MMM dd, yyyy')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {isIntegration ? (
                          reminder.context?.alerted ? (
                            <StatusPill tone="danger" dot>Triggered</StatusPill>
                          ) : (
                            <StatusPill tone="info" dot>Monitoring</StatusPill>
                          )
                        ) : (
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {format(parseISO(reminder.remind_on), 'MMM dd, yyyy')}
                          </span>
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
        </TableTile>
      )}
      <AddReminderDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
    </div>
  );
}
