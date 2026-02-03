'use client';

import { useMemo, useState, useEffect } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { toZonedTime } from 'date-fns-tz';

type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

const DAY_KEYS: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface DaySchedule {
  enabled: boolean;
  open: string;
  close: string;
}

export interface WorkingHoursStatus {
  isOpen: boolean;
  isAlwaysOpen: boolean;
  openTime: string;
  closeTime: string;
  isDayEnabled: boolean;
  timezone: string;
  currentTimeInTz: Date;
  nextOpenTime: Date | null;
  formattedOpenTime: string;
  formattedCloseTime: string;
  // Per-day schedule (full week)
  weeklySchedule: Record<DayKey, DaySchedule>;
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
 * Get the day key from a Date object using its local time representation.
 *
 * USE THIS FOR: Calendar date availability checks.
 * A calendar date like "January 22, 2026" has a fixed day-of-week (Thursday)
 * regardless of timezone. When users click a date on a calendar, they're
 * selecting THAT calendar date for booking at the business location.
 */
function getDayKeyFromCalendarDate(date: Date): DayKey {
  // Extract date components and create a clean date at noon to avoid
  // any potential DST edge cases at midnight boundaries
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const cleanDate = new Date(year, month, day, 12, 0, 0);
  return DAY_KEYS[cleanDate.getDay()];
}

/**
 * Get the day key for the current moment in a specific timezone.
 *
 * USE THIS FOR: Real-time "is open now" status checks.
 * When checking if a business is currently open, we need to know what
 * day and time it is RIGHT NOW at the business location.
 *
 * Example: If it's 11 PM Thursday in user's timezone but 10 AM Friday
 * in the tenant's timezone, we should check Friday's schedule.
 */
function getDayKeyInTimezone(date: Date, timezone: string): { dayKey: DayKey; zonedDate: Date } {
  const zonedDate = toZonedTime(date, timezone);
  return {
    dayKey: DAY_KEYS[zonedDate.getDay()],
    zonedDate,
  };
}

/**
 * Build the weekly schedule from tenant data
 */
function buildWeeklySchedule(tenant: TenantWorkingHoursConfig | null): Record<DayKey, DaySchedule> {
  return {
    sunday: {
      enabled: tenant?.sunday_enabled ?? false,
      open: tenant?.sunday_open ?? '10:00',
      close: tenant?.sunday_close ?? '14:00',
    },
    monday: {
      enabled: tenant?.monday_enabled ?? true,
      open: tenant?.monday_open ?? '09:00',
      close: tenant?.monday_close ?? '17:00',
    },
    tuesday: {
      enabled: tenant?.tuesday_enabled ?? true,
      open: tenant?.tuesday_open ?? '09:00',
      close: tenant?.tuesday_close ?? '17:00',
    },
    wednesday: {
      enabled: tenant?.wednesday_enabled ?? true,
      open: tenant?.wednesday_open ?? '09:00',
      close: tenant?.wednesday_close ?? '17:00',
    },
    thursday: {
      enabled: tenant?.thursday_enabled ?? true,
      open: tenant?.thursday_open ?? '09:00',
      close: tenant?.thursday_close ?? '17:00',
    },
    friday: {
      enabled: tenant?.friday_enabled ?? true,
      open: tenant?.friday_open ?? '09:00',
      close: tenant?.friday_close ?? '17:00',
    },
    saturday: {
      enabled: tenant?.saturday_enabled ?? false,
      open: tenant?.saturday_open ?? '10:00',
      close: tenant?.saturday_close ?? '14:00',
    },
  };
}

// Type for tenant working hours configuration
type TenantWorkingHoursConfig = {
  timezone?: string | null;
  working_hours_always_open?: boolean | null;
  working_hours_enabled?: boolean | null;
  monday_enabled?: boolean | null;
  monday_open?: string | null;
  monday_close?: string | null;
  tuesday_enabled?: boolean | null;
  tuesday_open?: string | null;
  tuesday_close?: string | null;
  wednesday_enabled?: boolean | null;
  wednesday_open?: string | null;
  wednesday_close?: string | null;
  thursday_enabled?: boolean | null;
  thursday_open?: string | null;
  thursday_close?: string | null;
  friday_enabled?: boolean | null;
  friday_open?: string | null;
  friday_close?: string | null;
  saturday_enabled?: boolean | null;
  saturday_open?: string | null;
  saturday_close?: string | null;
  sunday_enabled?: boolean | null;
  sunday_open?: string | null;
  sunday_close?: string | null;
};

/**
 * Hook to check if the business is currently open based on tenant's working hours settings.
 * Automatically refreshes every minute to keep the status current.
 *
 * This hook uses TIMEZONE-AWARE logic because it checks the CURRENT status
 * (what day/time is it RIGHT NOW at the business location).
 *
 * @param forDate - Optional date to check working hours for (defaults to current time)
 */
export function useWorkingHours(forDate?: Date): WorkingHoursStatus {
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
    const dateToCheck = forDate || currentTime;

    // For real-time status, we need to know what day/time it is at the business
    const { dayKey, zonedDate: currentTimeInTz } = getDayKeyInTimezone(dateToCheck, timezone);

    // Build the weekly schedule from tenant data
    const weeklySchedule = buildWeeklySchedule(tenant);

    // Get the schedule for the current day
    const todaySchedule = weeklySchedule[dayKey];
    const isDayEnabled = todaySchedule.enabled;
    const openTime = todaySchedule.open;
    const closeTime = todaySchedule.close;

    const isAlwaysOpen = tenant?.working_hours_always_open ?? false;
    const isWorkingHoursEnabled = tenant?.working_hours_enabled ?? true;

    // If always open or feature disabled, business is always open
    if (isAlwaysOpen || !isWorkingHoursEnabled) {
      return {
        isOpen: true,
        isAlwaysOpen: true,
        openTime,
        closeTime,
        isDayEnabled: true,
        timezone,
        currentTimeInTz,
        nextOpenTime: null,
        formattedOpenTime: formatTime12Hour(openTime),
        formattedCloseTime: formatTime12Hour(closeTime),
        weeklySchedule,
      };
    }

    // If day is not enabled, business is closed for the entire day
    if (!isDayEnabled) {
      // Find next open day
      let nextOpenTime: Date | null = null;
      for (let i = 1; i <= 7; i++) {
        const nextDate = new Date(currentTimeInTz);
        nextDate.setDate(nextDate.getDate() + i);
        const nextDayKey = DAY_KEYS[nextDate.getDay()];
        if (weeklySchedule[nextDayKey].enabled) {
          const [openHour, openMin] = weeklySchedule[nextDayKey].open.split(':').map(Number);
          nextOpenTime = new Date(nextDate);
          nextOpenTime.setHours(openHour, openMin, 0, 0);
          break;
        }
      }

      return {
        isOpen: false,
        isAlwaysOpen,
        openTime,
        closeTime,
        isDayEnabled,
        timezone,
        currentTimeInTz,
        nextOpenTime,
        formattedOpenTime: formatTime12Hour(openTime),
        formattedCloseTime: formatTime12Hour(closeTime),
        weeklySchedule,
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
      if (currentMinutes < openMinutes) {
        // Before opening, next open is today
        nextOpenTime = new Date(currentTimeInTz);
        nextOpenTime.setHours(openHour, openMin, 0, 0);
      } else {
        // After close, find next open day
        for (let i = 1; i <= 7; i++) {
          const nextDate = new Date(currentTimeInTz);
          nextDate.setDate(nextDate.getDate() + i);
          const nextDayKey = DAY_KEYS[nextDate.getDay()];
          if (weeklySchedule[nextDayKey].enabled) {
            const [nextOpenHour, nextOpenMin] = weeklySchedule[nextDayKey].open.split(':').map(Number);
            nextOpenTime = new Date(nextDate);
            nextOpenTime.setHours(nextOpenHour, nextOpenMin, 0, 0);
            break;
          }
        }
      }
    }

    return {
      isOpen,
      isAlwaysOpen,
      openTime,
      closeTime,
      isDayEnabled,
      timezone,
      currentTimeInTz,
      nextOpenTime,
      formattedOpenTime: formatTime12Hour(openTime),
      formattedCloseTime: formatTime12Hour(closeTime),
      weeklySchedule,
    };
  }, [tenant, currentTime, forDate]);
}

/**
 * Get working hours for a specific CALENDAR DATE.
 *
 * This is used for calendar date pickers to determine if a given date
 * should be disabled based on working days.
 *
 * IMPORTANT: This function does NOT perform timezone conversion because
 * when a user clicks "January 22" on a calendar, they're booking for
 * January 22 at the business location. January 22, 2026 is always a
 * Thursday regardless of what timezone the user is viewing from.
 *
 * The timezone only matters for:
 * 1. Determining if a business is CURRENTLY open (real-time status)
 * 2. Validating specific pickup/dropoff TIMES against business hours
 *
 * @param date - The calendar date to check (from date picker)
 * @param tenant - The tenant configuration
 */
export function getWorkingHoursForDate(
  date: Date,
  tenant: TenantWorkingHoursConfig | null
): { enabled: boolean; open: string; close: string; isAlwaysOpen: boolean } {
  // Get day of week from the calendar date itself, not timezone-converted
  const dayKey = getDayKeyFromCalendarDate(date);

  const isAlwaysOpen = tenant?.working_hours_always_open ?? false;
  const isWorkingHoursEnabled = tenant?.working_hours_enabled ?? true;

  const daySchedules = buildWeeklySchedule(tenant);
  const daySchedule = daySchedules[dayKey];

  // If always open or feature disabled, return enabled with the day's hours
  if (isAlwaysOpen || !isWorkingHoursEnabled) {
    return {
      enabled: true,
      open: daySchedule.open,
      close: daySchedule.close,
      isAlwaysOpen: true,
    };
  }

  return {
    enabled: daySchedule.enabled,
    open: daySchedule.open,
    close: daySchedule.close,
    isAlwaysOpen: false,
  };
}

/**
 * Validate if a specific date AND time is within business hours.
 *
 * Use this for validating pickup/dropoff times after the user has
 * selected both a date and time. This considers the tenant's timezone
 * to properly interpret what "9:00 AM on January 22" means.
 *
 * @param date - The date/time to validate
 * @param tenant - The tenant configuration
 */
export function isTimeWithinWorkingHours(
  date: Date,
  tenant: TenantWorkingHoursConfig | null
): { isValid: boolean; reason?: string; schedule: DaySchedule } {
  const timezone = tenant?.timezone || 'America/Chicago';
  const isAlwaysOpen = tenant?.working_hours_always_open ?? false;
  const isWorkingHoursEnabled = tenant?.working_hours_enabled ?? true;

  // Convert the requested time to tenant's timezone to get correct hours
  const { dayKey, zonedDate } = getDayKeyInTimezone(date, timezone);

  const daySchedules = buildWeeklySchedule(tenant);
  const daySchedule = daySchedules[dayKey];

  // If always open or feature disabled, always valid
  if (isAlwaysOpen || !isWorkingHoursEnabled) {
    return {
      isValid: true,
      schedule: daySchedule,
    };
  }

  // Check if the day is enabled
  if (!daySchedule.enabled) {
    return {
      isValid: false,
      reason: `Business is closed on ${dayKey.charAt(0).toUpperCase() + dayKey.slice(1)}s`,
      schedule: daySchedule,
    };
  }

  // Check if the time is within working hours
  const requestedHour = zonedDate.getHours();
  const requestedMinute = zonedDate.getMinutes();
  const requestedMinutes = requestedHour * 60 + requestedMinute;

  const [openHour, openMin] = daySchedule.open.split(':').map(Number);
  const [closeHour, closeMin] = daySchedule.close.split(':').map(Number);
  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;

  if (requestedMinutes < openMinutes) {
    return {
      isValid: false,
      reason: `Selected time is before opening hours (${formatTime12Hour(daySchedule.open)})`,
      schedule: daySchedule,
    };
  }

  if (requestedMinutes >= closeMinutes) {
    return {
      isValid: false,
      reason: `Selected time is after closing hours (${formatTime12Hour(daySchedule.close)})`,
      schedule: daySchedule,
    };
  }

  return {
    isValid: true,
    schedule: daySchedule,
  };
}
