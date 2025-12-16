import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface CleanupResult {
  success: boolean;
  tablesCleared: string[];
  rowsDeleted: Record<string, number>;
  error?: string;
}

export function useDataCleanup() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);

  const cleanupTestData = async (): Promise<CleanupResult> => {
    setIsLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('cleanup-test-data', {
        body: {
          confirmationToken: 'CLEANUP_TEST_DATA_CONFIRMED',
          preserveUsers: true
        }
      });

      if (error) throw error;

      const cleanupResult = data as CleanupResult;
      setResult(cleanupResult);
      return cleanupResult;

    } catch (error) {
      console.error('Data cleanup failed:', error);
      const errorResult: CleanupResult = {
        success: false,
        tablesCleared: [],
        rowsDeleted: {},
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
      setResult(errorResult);
      return errorResult;
    } finally {
      setIsLoading(false);
    }
  };

  const getTotalRowsDeleted = (): number => {
    if (!result) return 0;
    return Object.values(result.rowsDeleted).reduce((sum, count) => sum + count, 0);
  };

  return {
    cleanupTestData,
    isLoading,
    result,
    getTotalRowsDeleted
  };
}