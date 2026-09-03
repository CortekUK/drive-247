'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { format } from 'date-fns';
import {
  Clock,
  CheckCircle,
  RefreshCw,
  AlertTriangle,
  Send,
  Mail,
  MessageCircle,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface LockboxSendTimelineProps {
  rentalId: string;
  /** Rental start_date + pickup_time for showing scheduled time */
  scheduledSendTime?: Date | null;
}

interface LogEntry {
  id: string;
  event_type: 'scheduled' | 'sent' | 'resent' | 'rescheduled' | 'failed';
  channel: 'email' | 'sms' | 'whatsapp';
  scheduled_for: string | null;
  sent_by_name: string | null;
  details: string | null;
  created_at: string;
}

const eventConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  scheduled: { icon: Calendar, color: 'text-blue-500', label: 'Scheduled' },
  sent: { icon: CheckCircle, color: 'text-green-500', label: 'Sent' },
  resent: { icon: RefreshCw, color: 'text-amber-500', label: 'Re-sent' },
  rescheduled: { icon: Clock, color: 'text-blue-500', label: 'Rescheduled' },
  failed: { icon: AlertTriangle, color: 'text-red-500', label: 'Failed' },
};

const channelIcons: Record<string, typeof Mail> = {
  email: Mail,
  sms: MessageCircle,
  whatsapp: MessageCircle,
};

export function LockboxSendTimeline({ rentalId, scheduledSendTime }: LockboxSendTimelineProps) {
  const { tenant } = useTenant();

  const { data: logs, isLoading } = useQuery({
    queryKey: ['lockbox-send-log', rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lockbox_send_log')
        .select('*')
        .eq('rental_id', rentalId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as LogEntry[];
    },
    enabled: !!rentalId,
  });

  if (isLoading) return null;

  const hasLogs = logs && logs.length > 0;
  const hasScheduled = scheduledSendTime && scheduledSendTime > new Date();

  if (!hasLogs && !hasScheduled) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
        <Send className="h-3.5 w-3.5" />
        Lockbox Send Log
      </h4>
      <div className="relative pl-4 border-l-2 border-border space-y-3">
        {/* Show pending scheduled time if auto-send is configured and hasn't fired yet */}
        {hasScheduled && (
          <div className="relative flex items-start gap-2">
            <div className="absolute -left-[21px] bg-background p-0.5">
              <Clock className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-500">Scheduled</p>
              <p className="text-xs text-muted-foreground">
                Auto-send at {format(scheduledSendTime, 'MMM d, yyyy h:mm a')}
              </p>
            </div>
          </div>
        )}

        {/* Render log entries */}
        {logs?.map((log) => {
          const config = eventConfig[log.event_type] || eventConfig.sent;
          const Icon = config.icon;
          const ChannelIcon = channelIcons[log.channel] || Mail;

          return (
            <div key={log.id} className="relative flex items-start gap-2">
              <div className="absolute -left-[21px] bg-background p-0.5">
                <Icon className={cn('h-3.5 w-3.5', config.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className={cn('text-sm font-medium', config.color)}>{config.label}</p>
                  <ChannelIcon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground capitalize">{log.channel}</span>
                </div>
                {log.details && (
                  <p className="text-xs text-muted-foreground">{log.details}</p>
                )}
                <p className="text-xs text-muted-foreground/60">
                  {format(new Date(log.created_at), 'MMM d, yyyy h:mm a')}
                  {log.sent_by_name && ` · by ${log.sent_by_name}`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
