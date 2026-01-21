// RAG Init Edge Function
// Performs full initial indexing of all data for RAG
// Should be run once to populate the rag_documents table

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { generateEmbedding, chunkArray } from '../_shared/openai.ts';
import { getIndexedTables, getSelectFields, getDocumentLoader } from '../_shared/document-loaders.ts';
import { corsHeaders, jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts';

const BATCH_SIZE = 50; // Process embeddings in batches

interface IndexingResult {
  table: string;
  indexed: number;
  errors: number;
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Missing Supabase configuration', 500);
    }

    // Use service role client for full access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    let body: { tenantId?: string } = {};
    try {
      body = await req.json();
    } catch {
      // No body provided, will index all tenants
    }

    const { tenantId } = body;

    // Get list of tenants to process
    let tenants: { id: string; company_name: string }[] = [];
    if (tenantId) {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, company_name')
        .eq('id', tenantId)
        .single();

      if (error || !data) {
        return errorResponse(`Tenant not found: ${tenantId}`, 404);
      }
      tenants = [data];
    } else {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, company_name')
        .eq('status', 'active');

      if (error) {
        return errorResponse(`Failed to fetch tenants: ${error.message}`, 500);
      }
      tenants = data || [];
    }

    console.log(`Processing ${tenants.length} tenant(s)`);

    const results: Record<string, IndexingResult[]> = {};
    const tables = getIndexedTables();

    // Process each tenant
    for (const tenant of tenants) {
      console.log(`\nIndexing tenant: ${tenant.company_name} (${tenant.id})`);
      results[tenant.id] = [];

      // Process each table
      for (const tableName of tables) {
        console.log(`  Processing table: ${tableName}`);

        const tableResult: IndexingResult = {
          table: tableName,
          indexed: 0,
          errors: 0,
        };

        try {
          // Fetch all records for this tenant
          const selectFields = getSelectFields(tableName);
          const { data: records, error } = await supabase
            .from(tableName)
            .select(selectFields)
            .eq('tenant_id', tenant.id);

          if (error) {
            console.error(`    Error fetching ${tableName}: ${error.message}`);
            tableResult.errors++;
            results[tenant.id].push(tableResult);
            continue;
          }

          if (!records || records.length === 0) {
            console.log(`    No records found in ${tableName}`);
            results[tenant.id].push(tableResult);
            continue;
          }

          console.log(`    Found ${records.length} records`);

          // Get document loader for this table
          const toDocument = getDocumentLoader(tableName);
          if (!toDocument) {
            console.error(`    No document loader for ${tableName}`);
            tableResult.errors++;
            results[tenant.id].push(tableResult);
            continue;
          }

          // Process in batches
          const batches = chunkArray(records, BATCH_SIZE);

          for (const batch of batches) {
            // Convert records to documents
            const documents = batch.map(record => {
              try {
                return {
                  id: record.id,
                  ...toDocument(record),
                };
              } catch (e) {
                console.error(`    Error converting record ${record.id}: ${e.message}`);
                tableResult.errors++;
                return null;
              }
            }).filter(Boolean) as Array<{ id: string; content: string; metadata: Record<string, unknown> }>;

            if (documents.length === 0) continue;

            // Generate embeddings for batch
            for (const doc of documents) {
              try {
                const embedding = await generateEmbedding(doc.content);

                // Upsert into rag_documents
                const { error: upsertError } = await supabase
                  .from('rag_documents')
                  .upsert({
                    tenant_id: tenant.id,
                    source_table: tableName,
                    source_id: doc.id,
                    content: doc.content,
                    embedding: embedding,
                    metadata: doc.metadata,
                    updated_at: new Date().toISOString(),
                  }, {
                    onConflict: 'tenant_id,source_table,source_id',
                  });

                if (upsertError) {
                  console.error(`    Error upserting ${tableName}/${doc.id}: ${upsertError.message}`);
                  tableResult.errors++;
                } else {
                  tableResult.indexed++;
                }
              } catch (e) {
                console.error(`    Error processing ${tableName}/${doc.id}: ${e.message}`);
                tableResult.errors++;
              }
            }
          }
        } catch (e) {
          console.error(`    Unexpected error with ${tableName}: ${e.message}`);
          tableResult.errors++;
        }

        results[tenant.id].push(tableResult);
        console.log(`    Completed ${tableName}: ${tableResult.indexed} indexed, ${tableResult.errors} errors`);
      }
    }

    // Calculate totals
    const totals = {
      tenants: tenants.length,
      tables: tables.length,
      totalIndexed: 0,
      totalErrors: 0,
    };

    for (const tenantResults of Object.values(results)) {
      for (const tableResult of tenantResults) {
        totals.totalIndexed += tableResult.indexed;
        totals.totalErrors += tableResult.errors;
      }
    }

    console.log(`\nIndexing complete: ${totals.totalIndexed} documents indexed, ${totals.totalErrors} errors`);

    return jsonResponse({
      success: true,
      totals,
      results,
    });

  } catch (error) {
    console.error('RAG init error:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});
