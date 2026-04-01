'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRentalSettings } from '@/hooks/use-rental-settings';
import { Timer, CheckCircle2, Clock, Lock, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface LockboxCountdownTickerProps {
  rentalId: string;
}

function formatCountdown(ms: number): { value: string; unit: string } {
  if (ms <= 0) return { value: '0', unit: 's' };
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return { value: `${days}d ${hours}h ${minutes}m`, unit: '' };
  if (hours > 0) return { value: `${hours}h ${minutes}m ${seconds}s`, unit: '' };
  if (minutes > 0) return { value: `${minutes}m ${seconds}s`, unit: '' };
  return { value: `${seconds}`, unit: 's' };
}

export function LockboxCountdownTicker({ rentalId }: LockboxCountdownTickerProps) {
  const { settings: rentalSettings } = useRentalSettings();
  const [now, setNow] = useState(() => Date.now());

  const { data: rental } = useQuery({
    queryKey: ['lockbox-ticker', rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rentals')
        .select('start_date, pickup_time, lockbox_sent_at')
        .eq('id', rentalId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!rentalId,
    refetchInterval: 15000,
  });

  const offsetMinutes = (rentalSettings as any)?.lockbox_send_offset_minutes ?? null;

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // No auto-send configured
  if (!rental || offsetMinutes === null) {
    return null;
  }

  const pickupTime = rental.pickup_time || '09:00';
  const sendAt = new Date(`${rental.start_date}T${pickupTime}`);
  sendAt.setMinutes(sendAt.getMinutes() - offsetMinutes);
  const sendTimeLabel = format(sendAt, 'MMM d, h:mm a');

  // STATE: Already sent
  if (rental.lockbox_sent_at) {
    const sentTime = format(new Date(rental.lockbox_sent_at), 'MMM d, h:mm a');
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20">
        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-green-500/20">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-green-600 dark:text-green-400">Lockbox code sent</p>
          <p className="text-xs text-green-600/70 dark:text-green-400/70">Sent at {sentTime}</p>
        </div>
      </div>
    );
  }

  const msRemaining = sendAt.getTime() - now;

  // STATE: Past due — waiting for cron to pick it up
  if (msRemaining <= 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 animate-pulse">
        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-amber-500/20">
          <Send className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Sending lockbox code...</p>
          <p className="text-xs text-amber-600/70 dark:text-amber-400/70">Scheduled for {sendTimeLabel} — processing now</p>
        </div>
      </div>
    );
  }

  // STATE: Counting down
  const isUrgent = msRemaining < 15 * 60 * 1000;
  const isVerySoon = msRemaining < 5 * 60 * 1000;
  const countdown = formatCountdown(msRemaining);

  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-3 rounded-xl border",
      isVerySoon
        ? "bg-red-500/10 border-red-500/20"
        : isUrgent
          ? "bg-amber-500/10 border-amber-500/20"
          : "bg-primary/5 border-primary/20"
    )}>
      <div className={cn(
        "flex items-center justify-center h-10 w-10 rounded-full",
        isVerySoon
          ? "bg-red-500/20"
          : isUrgent
            ? "bg-amber-500/20"
            : "bg-primary/10"
      )}>
        <Timer className={cn(
          "h-5 w-5",
          isVerySoon
            ? "text-red-500 animate-pulse"
            : isUrgent
              ? "text-amber-500"
              : "text-primary"
        )} />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className={cn(
            "text-sm font-semibold tabular-nums",
            isVerySoon
              ? "text-red-600 dark:text-red-400"
              : isUrgent
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground"
          )}>
            Lockbox code sends in {countdown.value}{countdown.unit}
          </p>
          <Lock className="h-3 w-3 text-muted-foreground" />
        </div>
        <p className="text-xs text-muted-foreground">Scheduled for {sendTimeLabel}</p>
      </div>
    </div>
  );
}
