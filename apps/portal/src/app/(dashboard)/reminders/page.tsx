'use client';

import React, { useState, useMemo } from 'react';
import { useReminders, useReminderStats, useReminderActions, useReminderGeneration, type ReminderFilters } from '@/hooks/use-reminders';
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
  Play,
  MoreHorizontal,
  Shield,
  Info,
} from 'lucide-react';
import { format, parseISO, subMonths, startOfMonth } from 'date-fns';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import {
  BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import Image from 'next/image';
import Link from 'next/link';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';

const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

// --- Chart configs ---
const SEVERITY_CHART_COLORS: Record<string, string> = {
  critical: '#dc2626',
  warning: '#f59e0b',
  info: '#6366f1',
};

const severityChartConfig = Object.fromEntries(
  Object.entries(SEVERITY_CHART_COLORS).map(([k, v]) => [k, { label: capitalize(k), color: v }])
) as ChartConfig;

const OBJECT_TYPE_COLORS: Record<string, string> = {
  Vehicle: '#6366f1',
  Rental: '#22c55e',
  Customer: '#f59e0b',
  Fine: '#dc2626',
  Document: '#06b6d4',
  Integration: '#8b5cf6',
};

const objectTypeConfig = Object.fromEntries(
  Object.entries(OBJECT_TYPE_COLORS).map(([k, v]) => [k, { label: k, color: v }])
) as ChartConfig;

const criticalRadialConfig: ChartConfig = {
  rate: { label: 'Critical Rate', color: '#dc2626' },
};

const monthlyConfig: ChartConfig = {
  count: { label: 'Reminders', color: '#6366f1' },
};

const SEVERITY_COLORS = {
  critical: 'destructive',
  warning: 'secondary',
  info: 'outline'
} as const;

const SEVERITY_ICONS = {
  critical: AlertTriangle,
  warning: Clock,
  info: Bell
};

export default function RemindersPageEnhanced() {
  const [filters, setFilters] = useState<ReminderFilters>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { canEdit } = useManagerPermissions();

  const { data: reminders = [], isLoading, error } = useReminders(filters);
  const { data: stats } = useReminderStats();
  const { markDone, dismiss, snooze, bulkUpdate, isLoading: isUpdating } = useReminderActions();
  const generateReminders = useReminderGeneration();

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

  // --- Chart data derivations ---
  const severityDonutData = useMemo(() => {
    const counts: Record<string, number> = {};
    reminders.forEach((r) => {
      counts[r.severity] = (counts[r.severity] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name: capitalize(name), value, fill: SEVERITY_CHART_COLORS[name] || '#94a3b8' }))
      .sort((a, b) => b.value - a.value);
  }, [reminders]);

  const objectTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    reminders.forEach((r) => {
      counts[r.object_type] = (counts[r.object_type] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count, fill: OBJECT_TYPE_COLORS[name] || '#94a3b8' }))
      .sort((a, b) => b.count - a.count);
  }, [reminders]);

  const criticalRadialData = useMemo(() => {
    const total = reminders.length;
    const critical = reminders.filter((r) => r.severity === 'critical').length;
    const rate = total > 0 ? Math.round((critical / total) * 100) : 0;
    return { rate, critical, total, nonCritical: total - critical };
  }, [reminders]);

  const monthlyTrendData = useMemo(() => {
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      const key = format(startOfMonth(d), 'yyyy-MM');
      const label = format(d, 'MMM');
      const count = reminders.filter((r) => r.created_at?.startsWith(key)).length;
      months.push({ month: label, count });
    }
    return months;
  }, [reminders]);

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
      <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Reminders</h1>
          <p className="text-sm text-muted-foreground">
            Monitor and manage fleet compliance reminders and notifications
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={exportReminders}
            disabled={reminders.length === 0}
            className="flex-1 sm:flex-none"
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>

          {canEdit('reminders') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateReminders.mutate()}
              disabled={generateReminders.isPending}
              className="flex-1 sm:flex-none"
            >
              <Play className="h-4 w-4 mr-2" />
              {generateReminders.isPending ? 'Generating...' : 'Generate'}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card hover:bg-accent/50 border transition-all duration-200 cursor-pointer hover:shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
            <p className="text-xs text-muted-foreground">All pending & snoozed</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20 hover:border-primary/40 transition-all duration-200 cursor-pointer hover:shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Due Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{stats?.due || 0}</div>
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

      {/* Charts */}
      <TooltipProvider>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Severity Breakdown Donut */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Severity Breakdown</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Distribution by severity level</TooltipContent>
              </Tooltip>
            </div>
            {severityDonutData.length > 0 ? (
              <ChartContainer config={severityChartConfig} className="h-[180px] w-full">
                <PieChart>
                  <Pie data={severityDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {severityDonutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartTooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} />
                          <span className="text-sm font-medium">{d.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{d.value} reminder{d.value !== 1 ? 's' : ''}</p>
                      </div>
                    );
                  }} />
                </PieChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No data</p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {severityDonutData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />
                  {d.name}
                </div>
              ))}
            </div>
          </div>

          {/* Object Type Bar */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">By Category</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Reminders by object type</TooltipContent>
              </Tooltip>
            </div>
            {objectTypeData.length > 0 ? (
              <ChartContainer config={objectTypeConfig} className="h-[180px] w-full">
                <BarChart data={objectTypeData} layout="vertical" margin={{ left: 0, right: 8 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={75} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {objectTypeData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                  <ChartTooltip cursor={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} />
                          <span className="text-sm font-medium">{d.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{d.count} reminder{d.count !== 1 ? 's' : ''}</p>
                      </div>
                    );
                  }} />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No data</p>
            )}
          </div>

          {/* Critical Rate Radial */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Critical Rate</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Percentage of critical reminders</TooltipContent>
              </Tooltip>
            </div>
            <ChartContainer config={criticalRadialConfig} className="h-[180px] w-full">
              <RadialBarChart
                innerRadius="70%"
                outerRadius="100%"
                data={[{ rate: criticalRadialData.rate, fill: '#dc2626' }]}
                startAngle={180}
                endAngle={0}
                cx="50%"
                cy="65%"
              >
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background dataKey="rate" cornerRadius={6} />
                <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                  {criticalRadialData.rate}%
                </text>
                <text x="50%" y="70%" textAnchor="middle" className="fill-muted-foreground text-xs">
                  {criticalRadialData.critical}/{criticalRadialData.total} critical
                </text>
              </RadialBarChart>
            </ChartContainer>
          </div>

          {/* Monthly Trend */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Monthly Trend</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Reminders created over last 6 months</TooltipContent>
              </Tooltip>
            </div>
            <ChartContainer config={monthlyConfig} className="h-[180px] w-full">
              <BarChart data={monthlyTrendData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={28} />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <ChartTooltip cursor={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.08 }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                      <p className="text-xs text-muted-foreground">{d.month}</p>
                      <p className="text-sm font-semibold">{d.count} reminder{d.count !== 1 ? 's' : ''}</p>
                    </div>
                  );
                }} />
              </BarChart>
            </ChartContainer>
          </div>
        </div>
      </TooltipProvider>

      {/* Filters Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filter Reminders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Severity</Label>
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
            </div>

            <div className="space-y-2">
              <Label>Object Type</Label>
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
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => setFilters({})}
                className="w-full"
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
                  onClick={() => generateReminders.mutate()}
                  disabled={generateReminders.isPending}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Generate Reminders
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
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
    </div>
  );
}
