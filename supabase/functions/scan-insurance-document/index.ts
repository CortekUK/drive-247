import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDocumentProxy } from "npm:unpdf";
import { encode as base64Encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// GPT-4o model for multimodal document analysis (supports vision + text)
const AI_MODEL = 'gpt-4o';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Confidence thresholds for auto-decisions
const THRESHOLDS = {
  AUTO_APPROVE: 0.85,    // 85%+ = auto approve
  NEEDS_REVIEW: 0.60,    // 60-85% = human review
  AUTO_REJECT: 0.60      // <60% = request resubmission
};

/**
 * Enhanced extracted data structure with industry-standard fields
 */
interface ExtractedInsuranceData {
  // Core Fields
  provider: string | null;
  policyNumber: string | null;
  policyHolderName: string | null;

  // Dates
  effectiveDate: string | null;      // YYYY-MM-DD (renamed from startDate)
  expirationDate: string | null;     // YYYY-MM-DD (renamed from endDate)

  // Coverage Details
  coverageType: string | null;       // "Comprehensive", "Liability", "Full Coverage", etc.
  coverageLimits: {
    liability: number | null;
    collision: number | null;
    comprehensive: number | null;
  } | null;

  // Validation Results
  isValidDocument: boolean;
  isExpired: boolean;

  // Metadata
  documentType: string;              // "Certificate", "Policy", "Declaration Page", "ID Card"
  validationNotes: string[];
  needsManualReview: boolean;
  reviewReasons: string[];
}

/**
 * Fraud detection results
 */
interface FraudCheckResult {
  isExpired: boolean;
  hasInconsistentDates: boolean;
  suspiciousIndicators: string[];
  fraudRiskScore: number;
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
    const fileUrl = body.fileUrl; // Optional - will be looked up from database if not provided

    console.log('[INSURANCE-AI] Starting scan for document:', documentId);

    if (!documentId) {
      throw new Error('Missing documentId');
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

    console.log('[INSURANCE-AI] Status updated to processing');

    // Get document record to find the actual file URL
    const { data: docRecord, error: docError } = await supabase
      .from('customer_documents')
      .select('file_url, mime_type, file_name')
      .eq('id', documentId)
      .single();

    if (docError) {
      console.error('[INSURANCE-AI] Document record error:', docError);
      throw new Error(`Failed to get document record: ${docError.message}`);
    }

    const actualFileUrl = fileUrl || docRecord?.file_url;
    const mimeType = docRecord?.mime_type || 'application/pdf';
    const fileName = docRecord?.file_name || 'unknown';
    console.log('[INSURANCE-AI] Processing:', fileName, 'Type:', mimeType);

    // Download document from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('customer-documents')
      .download(actualFileUrl);

    if (downloadError) {
      console.error('[INSURANCE-AI] Download error:', JSON.stringify(downloadError));
      throw new Error(`Failed to download document: ${JSON.stringify(downloadError)}`);
    }

    if (!fileData) {
      throw new Error('No file data returned from storage');
    }

    console.log('[INSURANCE-AI] Document downloaded, size:', fileData.size);

    const arrayBuffer = await fileData.arrayBuffer();
    const isPdf = mimeType === 'application/pdf' || actualFileUrl.toLowerCase().endsWith('.pdf');

    let textContent = '';

    if (isPdf) {
      // Extract text from PDF using unpdf
      console.log('[INSURANCE-AI] Extracting text from PDF...');
      try {
        const uint8Array = new Uint8Array(arrayBuffer);
        const pdf = await getDocumentProxy(uint8Array);

        // Extract text from all pages
        const textPages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item: any) => item.str)
            .join(' ');
          textPages.push(pageText);
        }
        textContent = textPages.join('\n\n');
        console.log('[INSURANCE-AI] PDF text extracted, length:', textContent.length);
      } catch (pdfError: any) {
        console.error('[INSURANCE-AI] PDF extraction error:', pdfError);
        // If PDF extraction fails, mark for manual review with VALID status
        await supabase
          .from('customer_documents')
          .update({
            ai_scan_status: 'pending', // Use valid status, not 'needs_review'
            ai_extracted_data: {
              needsManualReview: true,
              reviewReasons: ['Could not extract text from PDF - manual verification required'],
              validationNotes: ['PDF extraction failed: ' + pdfError.message],
              isValidDocument: false,
              isExpired: false,
              documentType: 'Unknown'
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
              extractedData: { needsManualReview: true, reviewReasons: ['PDF extraction failed'] },
              validationScore: 0.5,
              confidenceScore: 0.5,
              requiresManualReview: true
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Get OpenAI API keys (primary and fallback)
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const openaiApiKeyFallback = Deno.env.get('OPENAI_API_KEY_FALLBACK');
    if (!openaiApiKey && !openaiApiKeyFallback) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    console.log('[INSURANCE-AI] OpenAI API key configured:', openaiApiKey ? 'Primary' : 'Fallback only');

    // Build the AI prompt for comprehensive extraction
    const systemPrompt = `You are an expert insurance document verification specialist. Your task is to:
1. Verify if the document is a legitimate insurance document
2. Extract all relevant policy information accurately
3. Check for signs of document tampering or fraud
4. Determine if the policy is currently valid (not expired)

Be thorough but only extract data you are confident about. If unsure, use null.`;

    const extractionPrompt = `Analyze this insurance document and extract information. Return ONLY valid JSON (no markdown, no code blocks):

{
  "provider": "Insurance company name or null",
  "policyNumber": "Policy/Certificate number or null",
  "policyHolderName": "Name of insured person/entity or null",
  "effectiveDate": "YYYY-MM-DD start date or null",
  "expirationDate": "YYYY-MM-DD end date or null",
  "coverageType": "Type of coverage (Comprehensive, Liability, Full Coverage, etc.) or null",
  "coverageLimits": {
    "liability": numeric limit or null,
    "collision": numeric limit or null,
    "comprehensive": numeric limit or null
  },
  "isValidDocument": true if this appears to be a legitimate insurance document,
  "isExpired": true if expiration date is in the past,
  "documentType": "Certificate" | "Policy" | "Declaration Page" | "ID Card" | "Unknown",
  "validationNotes": ["array of observations about the document"],
  "needsManualReview": true if document quality is poor or data is unclear,
  "reviewReasons": ["reasons why manual review is needed, if any"],
  "suspiciousIndicators": ["any signs of tampering, inconsistency, or fraud"]
}

IMPORTANT:
- Dates must be in YYYY-MM-DD format
- Coverage amounts should be numbers without currency symbols
- If the document is NOT an insurance document, set isValidDocument to false
- Check if dates are logically consistent (expiration after effective date)
- Flag any suspicious patterns or quality issues`;

    // Helper function to make OpenAI API call
    const makeOpenAICall = async (apiKey: string, isPdfText: boolean, base64Data?: string) => {
      const requestBody = isPdfText ? {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${extractionPrompt}\n\nDOCUMENT TEXT:\n${textContent.substring(0, 15000)}` }
        ],
        max_completion_tokens: 2000,
        temperature: 0.1
      } : {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
            ]
          }
        ],
        max_completion_tokens: 2000,
        temperature: 0.1
      };

      return fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
    };

    let openaiResponse;
    const isPdfText = isPdf && textContent.length > 50;
    // Use Deno's base64 encoder to avoid stack overflow with large files
    const base64Data = !isPdfText ? base64Encode(new Uint8Array(arrayBuffer)) : undefined;

    console.log('[INSURANCE-AI] Using GPT-4o', isPdfText ? 'text analysis...' : 'Vision analysis...');

    // Try primary key first
    if (openaiApiKey) {
      console.log('[INSURANCE-AI] Attempting with primary API key...');
      openaiResponse = await makeOpenAICall(openaiApiKey, isPdfText, base64Data);

      if (!openaiResponse.ok && openaiApiKeyFallback) {
        const errorText = await openaiResponse.text();
        console.error('[INSURANCE-AI] Primary key failed:', openaiResponse.status, errorText);
        console.log('[INSURANCE-AI] Retrying with fallback API key...');
        openaiResponse = await makeOpenAICall(openaiApiKeyFallback, isPdfText, base64Data);
      }
    } else if (openaiApiKeyFallback) {
      console.log('[INSURANCE-AI] Using fallback API key (no primary)...');
      openaiResponse = await makeOpenAICall(openaiApiKeyFallback, isPdfText, base64Data);
    }

    if (!openaiResponse || !openaiResponse.ok) {
      const errorText = openaiResponse ? await openaiResponse.text() : 'No response';
      console.error('[INSURANCE-AI] OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${openaiResponse?.status || 'unknown'} - ${errorText}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResponseContent = openaiData.choices[0]?.message?.content;

    if (!aiResponseContent) {
      throw new Error('No content in OpenAI response');
    }

    console.log('[INSURANCE-AI] AI response received, parsing...');

    // Parse extracted JSON (remove any markdown formatting if present)
    const cleanedText = aiResponseContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let extractedData: ExtractedInsuranceData;
    try {
      extractedData = JSON.parse(cleanedText);
    } catch (parseError) {
      console.log('[INSURANCE-AI] JSON parse failed, marking for manual review');

      await supabase
        .from('customer_documents')
        .update({
          ai_scan_status: 'pending', // Use valid status
          ai_extracted_data: {
            needsManualReview: true,
            reviewReasons: ['AI could not extract structured data - manual verification required'],
            validationNotes: ['Parse error - raw response logged'],
            isValidDocument: false,
            isExpired: false,
            documentType: 'Unknown',
            rawResponse: aiResponseContent.substring(0, 500)
          },
          ai_validation_score: 0,
          ai_confidence_score: 0,
          scanned_at: new Date().toISOString()
        })
        .eq('id', documentId);

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            extractedData: { needsManualReview: true },
            validationScore: 0,
            confidenceScore: 0,
            requiresManualReview: true
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[INSURANCE-AI] Extracted data:', JSON.stringify(extractedData).substring(0, 200));

    // Perform fraud checks
    const fraudCheck = performFraudChecks(extractedData);
    console.log('[INSURANCE-AI] Fraud check result:', fraudCheck);

    // Calculate validation score
    const validationScore = calculateValidationScore(extractedData, fraudCheck);
    console.log('[INSURANCE-AI] Validation score:', validationScore);

    // Calculate confidence score based on data completeness
    const confidenceScore = calculateConfidenceScore(extractedData);
    console.log('[INSURANCE-AI] Confidence score:', confidenceScore);

    // Determine verification decision based on thresholds
    let verificationDecision: string;
    if (validationScore >= THRESHOLDS.AUTO_APPROVE && !extractedData.needsManualReview && fraudCheck.fraudRiskScore < 0.3) {
      verificationDecision = 'auto_approved';
    } else if (validationScore < THRESHOLDS.AUTO_REJECT || fraudCheck.fraudRiskScore >= 0.7) {
      verificationDecision = 'auto_rejected';
    } else {
      verificationDecision = 'pending_review';
    }

    // Add fraud indicators to review reasons
    if (fraudCheck.suspiciousIndicators.length > 0) {
      extractedData.reviewReasons = [
        ...(extractedData.reviewReasons || []),
        ...fraudCheck.suspiciousIndicators
      ];
      extractedData.needsManualReview = true;
    }

    // Update document with AI results
    // Note: fraud_risk_score, verification_decision, and review_reasons columns
    // may not exist yet - they're optional and data is stored in ai_extracted_data JSON
    const { error: updateError } = await supabase
      .from('customer_documents')
      .update({
        ai_scan_status: 'completed',
        ai_extracted_data: {
          ...extractedData,
          fraudRiskScore: fraudCheck.fraudRiskScore,
          verificationDecision
        },
        ai_confidence_score: confidenceScore,
        ai_validation_score: validationScore,
        scanned_at: new Date().toISOString()
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('[INSURANCE-AI] Update error:', updateError);
      throw updateError;
    }

    console.log('[INSURANCE-AI] Document scan completed successfully. Decision:', verificationDecision);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          extractedData,
          validationScore,
          confidenceScore,
          verificationDecision,
          fraudRiskScore: fraudCheck.fraudRiskScore,
          requiresManualReview: extractedData.needsManualReview || verificationDecision === 'pending_review'
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[INSURANCE-AI] Scan error:', error.message || error);

    // Update document with error status
    if (documentId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        await supabase
          .from('customer_documents')
          .update({
            ai_scan_status: 'failed',
            ai_scan_errors: [error.message || 'Unknown error occurred'],
            ai_extracted_data: {
              needsManualReview: true,
              reviewReasons: ['AI scan failed - manual verification required'],
              error: error.message
            }
          })
          .eq('id', documentId);
      } catch (updateError) {
        console.error('[INSURANCE-AI] Failed to update error status:', updateError);
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'AI scanning failed'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Perform basic fraud detection checks
 */
function performFraudChecks(data: ExtractedInsuranceData): FraudCheckResult {
  const suspiciousIndicators: string[] = [];
  let fraudRiskScore = 0;

  // Check 1: Expired policy
  const isExpired = data.isExpired || (data.expirationDate && new Date(data.expirationDate) < new Date());
  if (isExpired) {
    suspiciousIndicators.push('Policy appears to be expired');
    fraudRiskScore += 0.3;
  }

  // Check 2: Inconsistent dates (expiration before effective)
  let hasInconsistentDates = false;
  if (data.effectiveDate && data.expirationDate) {
    const effectiveDate = new Date(data.effectiveDate);
    const expirationDate = new Date(data.expirationDate);
    if (expirationDate <= effectiveDate) {
      hasInconsistentDates = true;
      suspiciousIndicators.push('Expiration date is before or same as effective date');
      fraudRiskScore += 0.4;
    }
  }

  // Check 3: Not a valid insurance document
  if (!data.isValidDocument) {
    suspiciousIndicators.push('Document does not appear to be a valid insurance document');
    fraudRiskScore += 0.5;
  }

  // Check 4: Missing critical information
  if (!data.policyNumber && !data.provider) {
    suspiciousIndicators.push('Missing both policy number and provider - possibly incomplete or fake document');
    fraudRiskScore += 0.3;
  }

  // Check 5: Any suspicious indicators from AI
  if (data.validationNotes) {
    const suspiciousNotes = data.validationNotes.filter(note =>
      note.toLowerCase().includes('tamper') ||
      note.toLowerCase().includes('alter') ||
      note.toLowerCase().includes('suspicious') ||
      note.toLowerCase().includes('fake') ||
      note.toLowerCase().includes('invalid')
    );
    if (suspiciousNotes.length > 0) {
      suspiciousIndicators.push(...suspiciousNotes);
      fraudRiskScore += 0.2 * suspiciousNotes.length;
    }
  }

  // Cap fraud risk score at 1.0
  fraudRiskScore = Math.min(fraudRiskScore, 1.0);

  return {
    isExpired: isExpired || false,
    hasInconsistentDates,
    suspiciousIndicators,
    fraudRiskScore: Math.round(fraudRiskScore * 100) / 100
  };
}

/**
 * Calculate validation score based on data completeness and validity
 * Returns a score between 0.0 and 1.0
 */
function calculateValidationScore(data: ExtractedInsuranceData, fraudCheck: FraudCheckResult): number {
  let score = 0;

  const weights = {
    policyNumber: 0.25,        // Must have policy number
    provider: 0.20,            // Must identify carrier
    effectiveDate: 0.15,       // Must have start date
    expirationDate: 0.25,      // Must have end date & not expired
    coverageLimits: 0.10,      // Should have coverage amounts
    isValidDocument: 0.05      // Document authenticity
  };

  // Policy number present
  if (data.policyNumber && data.policyNumber.length > 0) {
    score += weights.policyNumber;
  }

  // Provider present
  if (data.provider && data.provider.length > 0) {
    score += weights.provider;
  }

  // Effective date present and valid
  if (data.effectiveDate && isValidDate(data.effectiveDate)) {
    score += weights.effectiveDate;
  }

  // Expiration date present, valid, and in the future
  if (data.expirationDate && isValidDate(data.expirationDate) && isFutureDate(data.expirationDate)) {
    score += weights.expirationDate;
  }

  // Coverage limits present
  if (data.coverageLimits) {
    const hasAnyLimit = data.coverageLimits.liability || data.coverageLimits.collision || data.coverageLimits.comprehensive;
    if (hasAnyLimit) {
      score += weights.coverageLimits;
    }
  }

  // Document marked as valid
  if (data.isValidDocument) {
    score += weights.isValidDocument;
  }

  // Penalize for fraud indicators
  score = score * (1 - fraudCheck.fraudRiskScore * 0.5);

  // Round to 2 decimal places
  return Math.round(score * 100) / 100;
}

/**
 * Calculate confidence score based on how much data was extracted
 */
function calculateConfidenceScore(data: ExtractedInsuranceData): number {
  let fieldsExtracted = 0;
  const totalFields = 7;

  if (data.provider) fieldsExtracted++;
  if (data.policyNumber) fieldsExtracted++;
  if (data.policyHolderName) fieldsExtracted++;
  if (data.effectiveDate) fieldsExtracted++;
  if (data.expirationDate) fieldsExtracted++;
  if (data.coverageType) fieldsExtracted++;
  if (data.coverageLimits && (data.coverageLimits.liability || data.coverageLimits.collision || data.coverageLimits.comprehensive)) {
    fieldsExtracted++;
  }

  const baseConfidence = fieldsExtracted / totalFields;

  // Boost confidence if document is valid
  const validityBoost = data.isValidDocument ? 0.1 : 0;

  // Reduce confidence if manual review needed
  const reviewPenalty = data.needsManualReview ? 0.15 : 0;

  const finalConfidence = Math.min(Math.max(baseConfidence + validityBoost - reviewPenalty, 0), 1);

  return Math.round(finalConfidence * 100) / 100;
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
