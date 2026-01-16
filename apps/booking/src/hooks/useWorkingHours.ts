'use client';

import { useMemo, useState, useEffect } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { toZonedTime } from 'date-fns-tz';

export interface WorkingHoursStatus {
  isOpen: boolean;
  isAlwaysOpen: boolean;
  openTime: string;
  closeTime: string;
  timezone: string;
  currentTimeInTz: Date;
  nextOpenTime: Date | null;
  formattedOpenTime: string;
  formattedCloseTime: string;
}

/**
 * Formats a 24-hour time string (HH:MM) to 12-hour format with AM/PM
 */
function formatTime12Hour(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Hook to check if the business is currently open based on tenant's working hours settings.
 * Automatically refreshes every minute to keep the status current.
 */
export function useWorkingHours(): WorkingHoursStatus {
  const { tenant } = useTenant();
  const [currentTime, setCurrentTime] = useState(() => new Date());

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, []);

  return useMemo(() => {
    const timezone = tenant?.timezone || 'America/Chicago'; // Default to Texas (Central Time)
    const currentTimeInTz = toZonedTime(currentTime, timezone);

    // Default values
    const openTime = tenant?.working_hours_open || '09:00';
    const closeTime = tenant?.working_hours_close || '17:00';
    const isAlwaysOpen = tenant?.working_hours_always_open ?? false;
    const isEnabled = tenant?.working_hours_enabled ?? true;

    // If always open or feature disabled, business is always open
    if (isAlwaysOpen || !isEnabled) {
      return {
        isOpen: true,
        isAlwaysOpen: true,
        openTime,
        closeTime,
        timezone,
        currentTimeInTz,
        nextOpenTime: null,
        formattedOpenTime: formatTime12Hour(openTime),
        formattedCloseTime: formatTime12Hour(closeTime),
      };
    }

    // Parse current time in tenant's timezone
    const currentHour = currentTimeInTz.getHours();
    const currentMinute = currentTimeInTz.getMinutes();
    const currentMinutes = currentHour * 60 + currentMinute;

    // Parse open/close times
    const [openHour, openMin] = openTime.split(':').map(Number);
    const [closeHour, closeMin] = closeTime.split(':').map(Number);
    const openMinutes = openHour * 60 + openMin;
    const closeMinutes = closeHour * 60 + closeMin;

    // Check if currently within working hours
    const isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes;

    // Calculate next open time (for display)
    let nextOpenTime: Date | null = null;
    if (!isOpen) {
      nextOpenTime = new Date(currentTimeInTz);
      if (currentMinutes >= closeMinutes) {
        // After close, next open is tomorrow
        nextOpenTime.setDate(nextOpenTime.getDate() + 1);
      }
      nextOpenTime.setHours(openHour, openMin, 0, 0);
    }

    return {
      isOpen,
      isAlwaysOpen,
      openTime,
      closeTime,
      timezone,
      currentTimeInTz,
      nextOpenTime,
      formattedOpenTime: formatTime12Hour(openTime),
      formattedCloseTime: formatTime12Hour(closeTime),
    };
  }, [tenant, currentTime]);
}
