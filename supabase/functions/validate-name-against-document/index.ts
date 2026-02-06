// @ts-nocheck - This is a Deno Edge Function, not Node.js TypeScript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidateRequest {
  documentFrontUrl: string;
  documentBackUrl?: string;
  // Fields to validate
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  documentNumber?: string;
  documentType?: string;
  documentExpiry?: string; // YYYY-MM-DD
  documentCountry?: string;
}

interface FieldValidation {
  field: string;
  userValue: string | null;
  documentValue: string | null;
  matches: boolean;
  message: string;
}

interface ValidateResponse {
  ok: boolean;
  approved: boolean;
  overallConfidence: number;
  fields: FieldValidation[];
  message: string;
}

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Download image from URL and convert to base64
 */
async function downloadImageAsBase64(url: string, supabase?: any): Promise<string | null> {
  try {
    if (url.includes('supabase') && url.includes('storage')) {
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
        return uint8ArrayToBase64(new Uint8Array(arrayBuffer));
      }
    }

    const response = await fetch(url);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    return uint8ArrayToBase64(new Uint8Array(arrayBuffer));
  } catch (error) {
    console.error('Error downloading image:', error);
    return null;
  }
}

/**
 * Validate all fields against document using OpenAI Vision
 */
async function validateFieldsWithAI(
  frontImageBase64: string,
  backImageBase64: string | null,
  fieldsToValidate: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    documentNumber?: string;
    documentType?: string;
    documentExpiry?: string;
    documentCountry?: string;
  }
): Promise<ValidateResponse> {
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  // Build the fields string for the prompt
  const fieldsList = [];
  if (fieldsToValidate.firstName) fieldsList.push(`First Name: "${fieldsToValidate.firstName}"`);
  if (fieldsToValidate.lastName) fieldsList.push(`Last Name: "${fieldsToValidate.lastName}"`);
  if (fieldsToValidate.dateOfBirth) fieldsList.push(`Date of Birth: "${fieldsToValidate.dateOfBirth}"`);
  if (fieldsToValidate.documentNumber) fieldsList.push(`Document Number: "${fieldsToValidate.documentNumber}"`);
  if (fieldsToValidate.documentType) fieldsList.push(`Document Type: "${fieldsToValidate.documentType}"`);
  if (fieldsToValidate.documentExpiry) fieldsList.push(`Document Expiry: "${fieldsToValidate.documentExpiry}"`);
  if (fieldsToValidate.documentCountry) fieldsList.push(`Document Country: "${fieldsToValidate.documentCountry}"`);

  const imageContents: any[] = [
    {
      type: 'text',
      text: `You are validating user-edited information against an identity document. Compare each field the user provided with what's actually on the document.

User-provided values to validate:
${fieldsList.join('\n')}

Extract the actual values from the document and compare them. Return ONLY valid JSON:
{
  "fields": [
    {
      "field": "firstName",
      "userValue": "what user provided",
      "documentValue": "what document shows or null if not visible",
      "matches": true/false,
      "message": "brief explanation"
    }
  ],
  "overallConfidence": 0.0 to 1.0,
  "approved": true/false (true if all critical fields match or are close enough),
  "message": "overall summary"
}

Guidelines:
- Be flexible with name matching (ignore case, minor spelling variations)
- Dates should match exactly (YYYY-MM-DD format)
- Document numbers should match exactly (ignore spaces/dashes)
- Country codes: accept both full names and ISO codes as matching
- Document type: "drivers_license", "passport", "id_card" - be flexible with naming
- If a field cannot be read from the document, set documentValue to null and matches to true (benefit of doubt)
- IMPORTANT: approved=true ONLY if ALL provided fields match. If ANY field does not match, approved MUST be false.`
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
      text: 'Back of the document:'
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
          content: 'You are an expert at reading and validating identity documents. Compare user-provided data against document images accurately. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: imageContents
        }
      ],
      max_tokens: 1500,
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
    const result = JSON.parse(cleanedContent);

    return {
      ok: true,
      approved: result.approved === true,
      overallConfidence: typeof result.overallConfidence === 'number' ? result.overallConfidence : 0.5,
      fields: Array.isArray(result.fields) ? result.fields : [],
      message: result.message || ''
    };
  } catch (parseError) {
    console.error('Failed to parse validation response:', cleanedContent);
    throw new Error('Failed to parse validation result');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json() as ValidateRequest;

    // Support both old API (documentImageUrl) and new API (documentFrontUrl)
    const documentFrontUrl = body.documentFrontUrl || (body as any).documentImageUrl;
    const { documentBackUrl, firstName, lastName, dateOfBirth, documentNumber, documentType, documentExpiry, documentCountry } = body;

    if (!documentFrontUrl) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'documentFrontUrl is required'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fieldsToValidate = { firstName, lastName, dateOfBirth, documentNumber, documentType, documentExpiry, documentCountry };

    // Check if there are any fields to validate
    const hasFields = Object.values(fieldsToValidate).some(v => v !== undefined && v !== null && v !== '');
    if (!hasFields) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'At least one field to validate is required'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client for storage access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Download document images
    console.log('Downloading document front image...');
    const frontBase64 = await downloadImageAsBase64(documentFrontUrl, supabaseClient);

    if (!frontBase64) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Failed to download document front image'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let backBase64: string | null = null;
    if (documentBackUrl) {
      console.log('Downloading document back image...');
      backBase64 = await downloadImageAsBase64(documentBackUrl, supabaseClient);
    }

    // Validate fields with AI
    console.log('Validating fields against document...');
    const validationResult = await validateFieldsWithAI(frontBase64, backBase64, fieldsToValidate);

    console.log('Validation result:', {
      approved: validationResult.approved,
      confidence: validationResult.overallConfidence,
      message: validationResult.message
    });

    return new Response(
      JSON.stringify(validationResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Validation failed',
        detail: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
