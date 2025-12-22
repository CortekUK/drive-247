import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDocumentProxy } from "npm:unpdf";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ExtractedData {
  policyNumber: string | null;
  provider: string | null;
  startDate: string | null;
  endDate: string | null;
  coverageAmount: number | null;
  isValid: boolean;
  validationNotes: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  let documentId: string | null = null;

  try {
    const body = await req.json();
    documentId = body.documentId;
    const fileUrl = body.fileUrl;

    console.log('Starting AI scan for document:', documentId, 'fileUrl:', fileUrl);

    if (!documentId || !fileUrl) {
      throw new Error('Missing documentId or fileUrl');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update status to processing
    await supabase
      .from('customer_documents')
      .update({ ai_scan_status: 'processing' })
      .eq('id', documentId);

    console.log('Updated status to processing');

    // Get document record to find the actual file URL
    const { data: docRecord, error: docError } = await supabase
      .from('customer_documents')
      .select('file_url, mime_type')
      .eq('id', documentId)
      .single();

    if (docError) {
      console.error('Document record error:', docError);
      throw new Error(`Failed to get document record: ${docError.message}`);
    }

    const actualFileUrl = docRecord?.file_url || fileUrl;
    const mimeType = docRecord?.mime_type || 'application/pdf';
    console.log('File URL:', actualFileUrl, 'MIME type:', mimeType);

    // Download document from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('customer-documents')
      .download(actualFileUrl);

    if (downloadError) {
      console.error('Download error:', JSON.stringify(downloadError));
      throw new Error(`Failed to download document: ${JSON.stringify(downloadError)}`);
    }

    if (!fileData) {
      throw new Error('No file data returned from storage');
    }

    console.log('Document downloaded successfully, size:', fileData.size);

    const arrayBuffer = await fileData.arrayBuffer();
    const isPdf = mimeType === 'application/pdf' || actualFileUrl.toLowerCase().endsWith('.pdf');

    let textContent = '';

    if (isPdf) {
      // Extract text from PDF using unpdf
      console.log('Extracting text from PDF...');
      try {
        const uint8Array = new Uint8Array(arrayBuffer);
        const pdf = await getDocumentProxy(uint8Array);

        // Extract text from all pages
        const textPages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          textPages.push(pageText);
        }
        textContent = textPages.join('\n\n');
        console.log('PDF text extracted, length:', textContent.length);
      } catch (pdfError: any) {
        console.error('PDF extraction error:', pdfError);
        // If PDF extraction fails, mark for manual review
        await supabase
          .from('customer_documents')
          .update({
            ai_scan_status: 'needs_review',
            ai_extracted_data: {
              note: 'Could not extract text from PDF. Please verify manually.',
              error: pdfError.message
            },
            ai_validation_score: 0.5,
            ai_confidence_score: 0.5,
            scanned_at: new Date().toISOString()
          })
          .eq('id', documentId);

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              extractedData: { note: 'PDF extraction failed - manual review required' },
              validationScore: 0.5,
              confidenceScore: 0.5,
              requiresManualReview: true
            }
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Get OpenAI API key
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    let openaiResponse;

    if (isPdf && textContent.length > 50) {
      // For PDFs with extracted text, use text-based analysis
      console.log('Calling OpenAI with extracted PDF text...');

      openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an expert at analyzing insurance documents. Extract structured information from the provided text accurately.'
            },
            {
              role: 'user',
              content: `Analyze this insurance document text and extract the following information. Return ONLY valid JSON without any markdown formatting or code blocks:
{
  "policyNumber": "string or null",
  "provider": "string or null",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "coverageAmount": number or null,
  "isValid": boolean,
  "validationNotes": "string describing any issues or confirmations"
}

If any field cannot be determined, use null. Be strict and only extract data you are confident about.

DOCUMENT TEXT:
${textContent.substring(0, 15000)}`
            }
          ],
          max_tokens: 1000,
          temperature: 0.2
        })
      });
    } else {
      // For images, use Vision API
      console.log('Calling OpenAI Vision API with image...');
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an expert at analyzing insurance documents. Extract structured information from the provided document image accurately.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Analyze this insurance document and extract the following information. Return ONLY valid JSON without any markdown formatting or code blocks:
{
  "policyNumber": "string or null",
  "provider": "string or null",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "coverageAmount": number or null,
  "isValid": boolean,
  "validationNotes": "string describing any issues or confirmations"
}

If any field cannot be determined, use null. Be strict and only extract data you are confident about.`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Data}`
                  }
                }
              ]
            }
          ],
          max_tokens: 1000,
          temperature: 0.2
        })
      });
    }

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status} - ${errorText}`);
    }

    const openaiData = await openaiResponse.json();
    console.log('OpenAI response received');

    const aiResponseContent = openaiData.choices[0]?.message?.content;
    if (!aiResponseContent) {
      throw new Error('No content in OpenAI response');
    }

    console.log('OpenAI raw response:', aiResponseContent.substring(0, 200));

    // Parse extracted JSON (remove any markdown formatting if present)
    const cleanedText = aiResponseContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let extractedData: ExtractedData;
    try {
      extractedData = JSON.parse(cleanedText);
    } catch (parseError) {
      console.log('Could not parse AI response as JSON, marking for manual review');

      await supabase
        .from('customer_documents')
        .update({
          ai_scan_status: 'needs_review',
          ai_extracted_data: {
            note: 'AI could not extract structured data from this document',
            raw_response: aiResponseContent.substring(0, 500)
          },
          ai_validation_score: 0,
          scanned_at: new Date().toISOString()
        })
        .eq('id', documentId);

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            extractedData: { note: 'Document requires manual review' },
            validationScore: 0,
            confidenceScore: 0,
            requiresManualReview: true
          }
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Extracted data:', extractedData);

    // Calculate validation score (0.0 - 1.0)
    const validationScore = calculateValidationScore(extractedData);
    console.log('Calculated validation score:', validationScore);

    // Default confidence score
    const confidenceScore = 0.85;

    // Update document with AI results
    const { error: updateError } = await supabase
      .from('customer_documents')
      .update({
        ai_scan_status: 'completed',
        ai_extracted_data: extractedData,
        ai_confidence_score: confidenceScore,
        ai_validation_score: validationScore,
        scanned_at: new Date().toISOString()
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    console.log('Document updated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          extractedData,
          validationScore,
          confidenceScore
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('AI scan error:', error.message || error);

    // Try to update document with error status
    if (documentId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        await supabase
          .from('customer_documents')
          .update({
            ai_scan_status: 'failed',
            ai_scan_errors: [error.message || 'Unknown error occurred']
          })
          .eq('id', documentId);
      } catch (updateError) {
        console.error('Failed to update error status:', updateError);
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'AI scanning failed'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

/**
 * Calculate validation score based on data completeness and validity
 * Returns a score between 0.0 and 1.0
 */
function calculateValidationScore(data: ExtractedData): number {
  let score = 0;

  const weights = {
    policyNumber: 0.25,
    provider: 0.15,
    startDate: 0.2,
    endDate: 0.2,
    coverageAmount: 0.15,
    isValid: 0.05
  };

  // Policy number present
  if (data.policyNumber && data.policyNumber.length > 0) {
    score += weights.policyNumber;
  }

  // Provider present
  if (data.provider && data.provider.length > 0) {
    score += weights.provider;
  }

  // Start date present and valid
  if (data.startDate && isValidDate(data.startDate)) {
    score += weights.startDate;
  }

  // End date present, valid, and in the future
  if (data.endDate && isValidDate(data.endDate) && isFutureDate(data.endDate)) {
    score += weights.endDate;
  }

  // Coverage amount present and reasonable
  if (data.coverageAmount && data.coverageAmount > 0) {
    score += weights.coverageAmount;
  }

  // Document marked as valid
  if (data.isValid) {
    score += weights.isValid;
  }

  // Round to 2 decimal places
  return Math.round(score * 100) / 100;
}

/**
 * Check if string is a valid date in YYYY-MM-DD format
 */
function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Check if date is in the future (or today)
 */
function isFutureDate(dateString: string): boolean {
  const date = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}
