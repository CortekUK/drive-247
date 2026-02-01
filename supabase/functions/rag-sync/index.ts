// RAG Sync Edge Function
// Processes the rag_sync_queue for incremental embedding updates
// Should be run periodically (cron) or on-demand

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { generateEmbedding } from '../_shared/openai.ts';
import { getSelectFields, getDocumentLoader } from '../_shared/document-loaders.ts';
import { corsHeaders, jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts';

const MAX_ITEMS_PER_RUN = 100; // Limit items processed per invocation

interface SyncResult {
  processed: number;
  inserted: number;
  updated: number;
  deleted: number;
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

    // Parse request body for optional parameters
    let body: { tenantId?: string; limit?: number } = {};
    try {
      body = await req.json();
    } catch {
      // No body provided
    }

    const { tenantId, limit = MAX_ITEMS_PER_RUN } = body;

    // Fetch unprocessed queue items
    let query = supabase
      .from('rag_sync_queue')
      .select('*')
      .is('processed_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: queueItems, error: queueError } = await query;

    if (queueError) {
      return errorResponse(`Failed to fetch queue: ${queueError.message}`, 500);
    }

    if (!queueItems || queueItems.length === 0) {
      return jsonResponse({
        success: true,
        message: 'No items to process',
        result: { processed: 0, inserted: 0, updated: 0, deleted: 0, errors: 0 },
      });
    }

    console.log(`Processing ${queueItems.length} queue items`);

    const result: SyncResult = {
      processed: 0,
      inserted: 0,
      updated: 0,
      deleted: 0,
      errors: 0,
    };

    // Process each queue item
    for (const item of queueItems) {
      console.log(`Processing: ${item.action} ${item.source_table}/${item.source_id}`);

      try {
        if (item.action === 'DELETE') {
          // Remove from rag_documents
          const { error: deleteError } = await supabase
            .from('rag_documents')
            .delete()
            .eq('tenant_id', item.tenant_id)
            .eq('source_table', item.source_table)
            .eq('source_id', item.source_id);

          if (deleteError) {
            throw new Error(`Delete failed: ${deleteError.message}`);
          }

          result.deleted++;
        } else {
          // INSERT or UPDATE - fetch the record and update embedding
          const selectFields = getSelectFields(item.source_table);
          const { data: record, error: fetchError } = await supabase
            .from(item.source_table)
            .select(selectFields)
            .eq('id', item.source_id)
            .single();

          if (fetchError) {
            // Record might have been deleted after the trigger fired
            if (fetchError.code === 'PGRST116') {
              console.log(`  Record not found, skipping: ${item.source_table}/${item.source_id}`);
              // Remove from rag_documents if it exists
              await supabase
                .from('rag_documents')
                .delete()
                .eq('tenant_id', item.tenant_id)
                .eq('source_table', item.source_table)
                .eq('source_id', item.source_id);
            } else {
              throw new Error(`Fetch failed: ${fetchError.message}`);
            }
          } else if (record) {
            // Get document loader
            const toDocument = getDocumentLoader(item.source_table);
            if (!toDocument) {
              throw new Error(`No document loader for table: ${item.source_table}`);
            }

            // Convert record to document
            const doc = toDocument(record);

            // Generate embedding
            const embedding = await generateEmbedding(doc.content);

            // Upsert into rag_documents
            const { error: upsertError } = await supabase
              .from('rag_documents')
              .upsert({
                tenant_id: item.tenant_id,
                source_table: item.source_table,
                source_id: item.source_id,
                content: doc.content,
                embedding: embedding,
                metadata: doc.metadata,
                updated_at: new Date().toISOString(),
              }, {
                onConflict: 'tenant_id,source_table,source_id',
              });

            if (upsertError) {
              throw new Error(`Upsert failed: ${upsertError.message}`);
            }

            if (item.action === 'INSERT') {
              result.inserted++;
            } else {
              result.updated++;
            }
          }
        }

        // Mark queue item as processed
        await supabase
          .from('rag_sync_queue')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', item.id);

        result.processed++;

      } catch (e) {
        console.error(`  Error processing ${item.source_table}/${item.source_id}: ${e.message}`);

        // Update queue item with error
        await supabase
          .from('rag_sync_queue')
          .update({
            error_message: e.message,
            processed_at: new Date().toISOString(),
          })
          .eq('id', item.id);

        result.errors++;
        result.processed++;
      }
    }

    console.log(`Sync complete: ${result.processed} processed, ${result.inserted} inserted, ${result.updated} updated, ${result.deleted} deleted, ${result.errors} errors`);

    return jsonResponse({
      success: true,
      result,
    });

  } catch (error) {
    console.error('RAG sync error:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});
