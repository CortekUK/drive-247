"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRemindersByObject } from '@/hooks/use-reminders';
import { AlertTriangle, Clock, Bell, CheckCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getDueStatus, formatDueStatusText } from '@/lib/mot-tax-utils';

interface Vehicle {
  id: string;
  reg: string;
  mot_due_date?: string;
  tax_due_date?: string;
}

interface VehicleCompliancePanelProps {
  vehicle: Vehicle;
}

export function VehicleCompliancePanel({ vehicle }: VehicleCompliancePanelProps) {
  const { data: reminders = [], isLoading } = useRemindersByObject('Vehicle', vehicle.id);

  const motStatus = vehicle.mot_due_date ? getDueStatus(parseISO(vehicle.mot_due_date)) : { state: 'missing' as const };
  const taxStatus = vehicle.tax_due_date ? getDueStatus(parseISO(vehicle.tax_due_date)) : { state: 'missing' as const };

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'ok': return 'default';
      case 'due_soon': return 'secondary';
      case 'overdue': return 'destructive';
      case 'missing': return 'outline';
      default: return 'outline';
    }
  };

  const getStatusIcon = (state: string) => {
    switch (state) {
      case 'ok': return <CheckCircle className="h-3 w-3" />;
      case 'due_soon': return <Clock className="h-3 w-3" />;
      case 'overdue': return <AlertTriangle className="h-3 w-3" />;
      case 'missing': return <Bell className="h-3 w-3" />;
      default: return <Bell className="h-3 w-3" />;
    }
  };

  const criticalReminders = reminders.filter(r => r.severity === 'critical').length;
  const warningReminders = reminders.filter(r => r.severity === 'warning').length;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Inspection & Registration Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Inspection & Registration Status</CardTitle>
          {(criticalReminders > 0 || warningReminders > 0) && (
            <div className="flex gap-1">
              {criticalReminders > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {criticalReminders} Critical
                </Badge>
              )}
              {warningReminders > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {warningReminders} Warning
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inspection Status */}
        <div className="flex items-center justify-between p-3 rounded-md border">
          <div className="flex items-center gap-2">
            <div className={motStatus.state === 'overdue' ? 'text-destructive' : motStatus.state === 'due_soon' ? 'text-secondary-foreground' : 'text-muted-foreground'}>
              {getStatusIcon(motStatus.state)}
            </div>
            <div>
              <p className="text-sm font-medium">Inspection</p>
              <p className="text-xs text-muted-foreground">
                {formatDueStatusText(motStatus, vehicle.mot_due_date)}
              </p>
            </div>
          </div>
          <Badge variant={getStatusColor(motStatus.state)} className="text-xs">
            {motStatus.state === 'ok' ? 'Valid' :
             motStatus.state === 'due_soon' ? 'Due Soon' :
             motStatus.state === 'overdue' ? 'Overdue' : 'Missing'}
          </Badge>
        </div>

        {/* Registration Status */}
        <div className="flex items-center justify-between p-3 rounded-md border">
          <div className="flex items-center gap-2">
            <div className={taxStatus.state === 'overdue' ? 'text-destructive' : taxStatus.state === 'due_soon' ? 'text-secondary-foreground' : 'text-muted-foreground'}>
              {getStatusIcon(taxStatus.state)}
            </div>
            <div>
              <p className="text-sm font-medium">Registration</p>
              <p className="text-xs text-muted-foreground">
                {formatDueStatusText(taxStatus, vehicle.tax_due_date)}
              </p>
            </div>
          </div>
          <Badge variant={getStatusColor(taxStatus.state)} className="text-xs">
            {taxStatus.state === 'ok' ? 'Valid' :
             taxStatus.state === 'due_soon' ? 'Due Soon' :
             taxStatus.state === 'overdue' ? 'Overdue' : 'Missing'}
          </Badge>
        </div>

        {/* Reminders Summary */}
        {reminders.length > 0 && (
          <div className="pt-2 border-t">
            <Button asChild variant="ghost" size="sm" className="w-full text-xs">
              <Link href={`/reminders?object_type=Vehicle&object_id=${vehicle.id}`}>
                View {reminders.length} reminder{reminders.length !== 1 ? 's' : ''}
              </Link>
            </Button>
          </div>
        )}

        {/* All Clear State */}
        {reminders.length === 0 && motStatus.state === 'ok' && taxStatus.state === 'ok' && (
          <div className="text-center pt-2 border-t">
            <div className="flex items-center justify-center gap-2 text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">All Compliant</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}