import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RateLimitStatus {
  allowed: boolean;
  attemptsRemaining: number;
  lockoutMinutes: number;
  nextAttemptAt?: string;
}

export function useRateLimiting() {
  const [rateLimitStatus, setRateLimitStatus] = useState<RateLimitStatus>({
    allowed: true,
    attemptsRemaining: 5,
    lockoutMinutes: 0
  });

  const checkRateLimit = useCallback(async (email: string): Promise<RateLimitStatus> => {
    // Temporarily disable rate limiting to fix login issues
    const fallbackStatus: RateLimitStatus = {
      allowed: true,
      attemptsRemaining: 5,
      lockoutMinutes: 0
    };
    setRateLimitStatus(fallbackStatus);
    return fallbackStatus;
  }, []);

  const recordLoginAttempt = useCallback(async (email: string, success: boolean): Promise<RateLimitStatus> => {
    // Temporarily disable rate limiting - always return success status
    const successStatus: RateLimitStatus = {
      allowed: true,
      attemptsRemaining: 5,
      lockoutMinutes: 0
    };
    setRateLimitStatus(successStatus);
    return successStatus;
  }, []);

  const getRateLimitMessage = useCallback((): string | null => {
    // Temporarily disable all rate limit messages
    return null;
  }, []);

  return {
    rateLimitStatus,
    checkRateLimit,
    recordLoginAttempt,
    getRateLimitMessage,
    isLocked: false // Temporarily always allow login
  };
}