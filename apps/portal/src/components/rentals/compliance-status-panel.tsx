"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRemindersByObject } from '@/hooks/use-reminders';
import { AlertTriangle, Clock, Bell, ExternalLink } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface ComplianceStatusPanelProps {
  objectType: 'Vehicle' | 'Customer' | 'Rental' | 'Fine' | 'Document';
  objectId: string;
  title?: string;
}

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

export function ComplianceStatusPanel({ objectType, objectId, title }: ComplianceStatusPanelProps) {
  const { data: reminders = [], isLoading } = useRemindersByObject(objectType, objectId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{title || 'Compliance Status'}</CardTitle>
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

  if (reminders.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {title || 'Compliance Status'}
            <Badge variant="outline" className="text-green-600 border-green-600">
              All Clear
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No active reminders</p>
        </CardContent>
      </Card>
    );
  }

  // Group reminders by severity
  const critical = reminders.filter(r => r.severity === 'critical');
  const warning = reminders.filter(r => r.severity === 'warning');
  const info = reminders.filter(r => r.severity === 'info');

  const getSeverityIcon = (severity: string) => {
    const Icon = SEVERITY_ICONS[severity as keyof typeof SEVERITY_ICONS] || Bell;
    return <Icon className="h-3 w-3" />;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {title || 'Compliance Status'}
            {critical.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                {critical.length} Critical
              </Badge>
            )}
            {warning.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {warning.length} Warning
              </Badge>
            )}
          </CardTitle>
          
          <Button asChild variant="ghost" size="sm">
            <Link href={`/reminders?object_type=${objectType}&object_id=${objectId}`}>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Critical reminders first */}
        {critical.slice(0, 2).map((reminder) => (
          <div key={reminder.id} className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
            <div className="text-destructive mt-0.5">
              {getSeverityIcon(reminder.severity)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-destructive truncate">
                {reminder.title}
              </p>
              <p className="text-xs text-muted-foreground">
                Due: {format(parseISO(reminder.due_on), 'MMM dd, yyyy')}
              </p>
            </div>
          </div>
        ))}
        
        {/* Warning reminders */}
        {warning.slice(0, critical.length > 0 ? 1 : 2).map((reminder) => (
          <div key={reminder.id} className="flex items-start gap-2 p-2 rounded-md bg-secondary/10 border border-secondary/20">
            <div className="text-secondary-foreground mt-0.5">
              {getSeverityIcon(reminder.severity)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">
                {reminder.title}
              </p>
              <p className="text-xs text-muted-foreground">
                Due: {format(parseISO(reminder.due_on), 'MMM dd, yyyy')}
              </p>
            </div>
          </div>
        ))}
        
        {/* Show count if there are more reminders */}
        {reminders.length > 3 && (
          <div className="text-center pt-2 border-t">
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link href={`/reminders?object_type=${objectType}&object_id=${objectId}`}>
                +{reminders.length - 3} more reminders
              </Link>
            </Button>
          </div>
        )}
        
        {/* If only info reminders and none shown yet */}
        {critical.length === 0 && warning.length === 0 && info.length > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
            <div className="text-muted-foreground mt-0.5">
              {getSeverityIcon('info')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">
                {info[0].title}
              </p>
              <p className="text-xs text-muted-foreground">
                Due: {format(parseISO(info[0].due_on), 'MMM dd, yyyy')}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}