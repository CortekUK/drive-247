'use client';

/**
 * The developer row, read once and shared by every page on the Developer side
 * of the rail (one react-query key, so moving between them does not refetch).
 */

import { useQuery } from '@tanstack/react-query';
import { callDeveloper, type DeveloperStatus } from './developer-api';

export function useDeveloperStatus() {
  return useQuery({
    queryKey: ['developer-status'],
    staleTime: 30_000,
    queryFn: async (): Promise<DeveloperStatus> => {
      const res = await callDeveloper({ action: 'get' });
      if (!res.ok) throw new Error(res.error ?? 'The developer service did not answer');
      return res.body as unknown as DeveloperStatus;
    },
  });
}
