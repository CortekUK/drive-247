"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Inspection & Registration Status</CardTitle>
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

        {/* All Clear State */}
        {motStatus.state === 'ok' && taxStatus.state === 'ok' && (
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