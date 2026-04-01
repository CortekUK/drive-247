'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useRentalSettings } from '@/hooks/use-rental-settings';
import { Timer, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LockboxCountdownTickerProps {
  rentalId: string;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function LockboxCountdownTicker({ rentalId }: LockboxCountdownTickerProps) {
  const { tenant } = useTenant();
  const { rentalSettings } = useRentalSettings();
  const [now, setNow] = useState(() => Date.now());

  // Fetch rental's date/time and sent status
  const { data: rental } = useQuery({
    queryKey: ['lockbox-ticker', rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rentals')
        .select('start_date, pickup_time, lockbox_sent_at, delivery_method')
        .eq('id', rentalId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!rentalId,
    refetchInterval: 30000, // refresh every 30s to catch sent status
  });

  const offsetMinutes = (rentalSettings as any)?.lockbox_send_offset_minutes ?? null;

  // Tick every second
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Don't render if no rental data or no auto-send configured
  if (!rental || offsetMinutes === null) {
    return null;
  }

  // Already sent
  if (rental.lockbox_sent_at) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <span className="text-sm font-medium text-green-600 dark:text-green-400">
          Lockbox code sent
        </span>
      </div>
    );
  }

  // Calculate send time
  const pickupTime = rental.pickup_time || '09:00';
  const sendAt = new Date(`${rental.start_date}T${pickupTime}`);
  sendAt.setMinutes(sendAt.getMinutes() - offsetMinutes);

  const msRemaining = sendAt.getTime() - now;

  // Already past send time but not yet sent (cron will pick it up)
  if (msRemaining <= 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <Clock className="h-4 w-4 text-amber-500 animate-pulse" />
        <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
          Sending lockbox code...
        </span>
      </div>
    );
  }

  // Show countdown
  const isUrgent = msRemaining < 15 * 60 * 1000; // < 15 min

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg border",
      isUrgent
        ? "bg-amber-500/10 border-amber-500/20"
        : "bg-blue-500/10 border-blue-500/20"
    )}>
      <Timer className={cn(
        "h-4 w-4",
        isUrgent ? "text-amber-500" : "text-blue-500"
      )} />
      <span className={cn(
        "text-sm font-medium tabular-nums",
        isUrgent ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"
      )}>
        Lockbox code sends in {formatCountdown(msRemaining)}
      </span>
    </div>
  );
}
