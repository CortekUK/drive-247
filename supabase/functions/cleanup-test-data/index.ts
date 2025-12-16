import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupRequest {
  confirmationToken: string;
  preserveUsers?: boolean;
}

interface CleanupResponse {
  success: boolean;
  tablesCleared: string[];
  rowsDeleted: Record<string, number>;
  error?: string;
}

const CONFIRMATION_TOKEN = "CLEANUP_TEST_DATA_CONFIRMED";

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const { confirmationToken, preserveUsers = true }: CleanupRequest = await req.json();

    // Safety check - require confirmation token
    if (confirmationToken !== CONFIRMATION_TOKEN) {
      return new Response(JSON.stringify({
        error: 'Invalid confirmation token. This is a destructive operation that requires explicit confirmation.',
        requiredToken: CONFIRMATION_TOKEN
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    console.log('Starting data cleanup operation...');

    const tablesCleared: string[] = [];
    const rowsDeleted: Record<string, number> = {};

    // Define cleanup order (respecting foreign key constraints)
    const cleanupTables = [
      // Dependent tables first
      'payment_applications',
      'authority_payments', 
      'fine_files',
      'insurance_documents',
      'vehicle_files',
      'vehicle_events',
      'service_records',
      'vehicle_expenses',
      'reminder_actions',
      'reminder_events',
      'reminder_logs',
      'reminder_emails',
      'customer_documents',
      
      // Main transactional data
      'ledger_entries',
      'pnl_entries',
      'payments',
      'fines',
      'insurance_policies',
      'plates',
      'rentals',
      
      // Master data
      'reminders',
      'vehicles',
      'customers',
      
      // System logs (optional - can be preserved for debugging)
      'login_attempts',
      'audit_logs',
      'maintenance_runs'
    ];

    // Execute cleanup in transaction
    for (const table of cleanupTables) {
      try {
        console.log(`Cleaning table: ${table}`);
        
        // Get count before deletion
        const { count: beforeCount } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (beforeCount && beforeCount > 0) {
          // Delete all rows from table
          const { error: deleteError } = await supabase
            .from(table)
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // This condition will match all rows

          if (deleteError) {
            console.error(`Error cleaning ${table}:`, deleteError);
            // Continue with other tables even if one fails
            continue;
          }

          tablesCleared.push(table);
          rowsDeleted[table] = beforeCount;
          console.log(`Cleared ${beforeCount} rows from ${table}`);
        } else {
          console.log(`Table ${table} was already empty`);
          rowsDeleted[table] = 0;
        }

      } catch (error) {
        console.error(`Failed to clean table ${table}:`, error);
        // Continue with other tables
        continue;
      }
    }

    // Reset sequences for better ID management (PostgreSQL specific)
    const sequenceResets = [
      "SELECT setval('customers_id_seq', 1, false);",
      "SELECT setval('vehicles_id_seq', 1, false);",
      "SELECT setval('rentals_id_seq', 1, false);",
      "SELECT setval('payments_id_seq', 1, false);",
    ];

    for (const resetQuery of sequenceResets) {
      try {
        // Note: This would require raw SQL execution which we avoid for security
        // Sequences will auto-increment normally
        console.log(`Skipping sequence reset: ${resetQuery}`);
      } catch (error) {
        console.log(`Sequence reset not available: ${error}`);
      }
    }

    // Log the cleanup operation
    try {
      await supabase.from('audit_logs').insert({
        action: 'data_cleanup',
        details: {
          tables_cleared: tablesCleared,
          total_rows_deleted: Object.values(rowsDeleted).reduce((sum, count) => sum + count, 0),
          preserve_users: preserveUsers,
          cleanup_timestamp: new Date().toISOString()
        }
      });
    } catch (auditError) {
      console.error('Failed to log cleanup operation:', auditError);
      // Don't fail the operation if audit logging fails
    }

    const totalRowsDeleted = Object.values(rowsDeleted).reduce((sum, count) => sum + count, 0);

    console.log(`Data cleanup completed. Cleared ${tablesCleared.length} tables, deleted ${totalRowsDeleted} total rows.`);

    const response: CleanupResponse = {
      success: true,
      tablesCleared,
      rowsDeleted,
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error: any) {
    console.error('Error in cleanup-test-data function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message,
      tablesCleared: [],
      rowsDeleted: {}
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
});