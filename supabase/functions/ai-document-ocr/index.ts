// @ts-nocheck - This is a Deno Edge Function, not Node.js TypeScript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OCRRequest {
  documentFrontUrl: string;
  documentBackUrl?: string;
}

interface ExtractedData {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  documentNumber: string | null;
  documentType: 'drivers_license' | 'passport' | 'id_card' | null;
  documentExpiry: string | null;
  documentCountry: string | null;
  address: string | null;
  photoDetected: boolean;
  confidence: number;
}

interface OCRResponse {
  ok: boolean;
  extractedData?: ExtractedData;
  error?: string;
  detail?: string;
}

/**
 * Download image from URL and convert to base64
 */
async function downloadImageAsBase64(url: string, supabase?: any): Promise<string | null> {
  try {
    // Check if it's a Supabase storage URL
    if (url.includes('supabase') && url.includes('storage')) {
      // Extract the path from the URL
      const pathMatch = url.match(/\/storage\/v1\/object\/public\/([^?]+)/);
      if (pathMatch && supabase) {
        const fullPath = pathMatch[1];
        const [bucket, ...pathParts] = fullPath.split('/');
        const filePath = pathParts.join('/');

        const { data, error } = await supabase.storage
          .from(bucket)
          .download(filePath);

        if (error) {
          console.error('Supabase storage download error:', error);
          return null;
        }

        const arrayBuffer = await data.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        return base64;
      }
    }

    // Regular URL download
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Image download failed:', response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    return base64;

  } catch (error) {
    console.error('Error downloading image:', error);
    return null;
  }
}

/**
 * Extract document data using OpenAI Vision API
 */
async function extractDocumentData(
  frontImageBase64: string,
  backImageBase64?: string
): Promise<ExtractedData> {
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  // Build the message content
  const imageContents: any[] = [
    {
      type: 'text',
      text: `Analyze this identity document (driver's license, passport, or ID card) and extract the following information.

Return ONLY valid JSON without any markdown formatting or code blocks:
{
  "firstName": "string or null",
  "lastName": "string or null",
  "dateOfBirth": "YYYY-MM-DD or null",
  "documentNumber": "string or null (license number, passport number, or ID number)",
  "documentType": "drivers_license or passport or id_card or null",
  "documentExpiry": "YYYY-MM-DD or null",
  "documentCountry": "ISO 3166-1 alpha-2 country code or null (e.g., GB, US, DE)",
  "address": "string or null",
  "photoDetected": true or false (whether a photo of a person is visible on the document),
  "confidence": 0.0 to 1.0 (your confidence in the extracted data accuracy)
}

Be strict and only extract data you are confident about. If a field cannot be determined, use null.
For dates, always use YYYY-MM-DD format. For country codes, use 2-letter ISO codes.`
    },
    {
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${frontImageBase64}`,
        detail: 'high'
      }
    }
  ];

  // Add back image if provided
  if (backImageBase64) {
    imageContents.push({
      type: 'text',
      text: 'This is the back of the same document:'
    });
    imageContents.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${backImageBase64}`,
        detail: 'high'
      }
    });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
          content: 'You are an expert at analyzing identity documents. Extract structured information from the provided document images accurately. Always respond with valid JSON only, no markdown.'
        },
        {
          role: 'user',
          content: imageContents
        }
      ],
      max_tokens: 1000,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI API error:', errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  // Clean and parse JSON response
  const cleanedContent = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    const extractedData = JSON.parse(cleanedContent);

    // Validate and normalize the data
    return {
      firstName: extractedData.firstName || null,
      lastName: extractedData.lastName || null,
      dateOfBirth: extractedData.dateOfBirth || null,
      documentNumber: extractedData.documentNumber || null,
      documentType: ['drivers_license', 'passport', 'id_card'].includes(extractedData.documentType)
        ? extractedData.documentType
        : null,
      documentExpiry: extractedData.documentExpiry || null,
      documentCountry: extractedData.documentCountry || null,
      address: extractedData.address || null,
      photoDetected: extractedData.photoDetected === true,
      confidence: typeof extractedData.confidence === 'number'
        ? Math.min(1, Math.max(0, extractedData.confidence))
        : 0.5
    };

  } catch (parseError) {
    console.error('Failed to parse OCR response:', cleanedContent);
    throw new Error('Failed to parse document data');
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documentFrontUrl, documentBackUrl } = await req.json() as OCRRequest;

    if (!documentFrontUrl) {
      return new Response(
        JSON.stringify({ ok: false, error: 'documentFrontUrl is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client for storage access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Downloading document front image...');
    const frontBase64 = await downloadImageAsBase64(documentFrontUrl, supabaseClient);

    if (!frontBase64) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Failed to download document front image',
          detail: 'Could not access the document image'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let backBase64: string | undefined;
    if (documentBackUrl) {
      console.log('Downloading document back image...');
      backBase64 = await downloadImageAsBase64(documentBackUrl, supabaseClient) || undefined;
    }

    console.log('Extracting document data with OpenAI Vision...');
    const extractedData = await extractDocumentData(frontBase64, backBase64);

    console.log('OCR extraction complete:', {
      firstName: extractedData.firstName,
      lastName: extractedData.lastName,
      documentType: extractedData.documentType,
      confidence: extractedData.confidence
    });

    const response: OCRResponse = {
      ok: true,
      extractedData
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('OCR function error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'OCR extraction failed',
        detail: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
