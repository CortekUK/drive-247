/**
 * API Route: Insurance Document Verification
 * POST /api/verify-insurance
 * 
 * Uses OpenAI GPT-4 Vision for image/PDF analysis with fallback support
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// OpenAI API Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_KEY_FALLBACK = process.env.OPENAI_API_KEY_FALLBACK || '';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// Supabase client for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest) {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║       AI INSURANCE VERIFICATION - OpenAI GPT-4 Vision       ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // Check if API key is loaded
    const apiKeyLoaded = OPENAI_API_KEY && OPENAI_API_KEY.length > 0;
    const fallbackKeyLoaded = OPENAI_API_KEY_FALLBACK && OPENAI_API_KEY_FALLBACK.length > 0;

    console.log('[AI-API] OpenAI API Key loaded:', apiKeyLoaded ? 'YES' : 'NO');
    console.log('[AI-API] Fallback API Key loaded:', fallbackKeyLoaded ? 'YES' : 'NO');

    if (!apiKeyLoaded && !fallbackKeyLoaded) {
        console.error('[AI-API] ERROR: No OpenAI API keys configured!');
        return NextResponse.json(
            {
                error: 'API configuration error',
                message: 'OpenAI API key not configured',
                status: 'pending_review'
            },
            { status: 500 }
        );
    }

    try {
        const body = await request.json();
        const { documentId, fileUrl, fileName, mimeType } = body;

        console.log('[AI-API] Document ID:', documentId);
        console.log('[AI-API] File URL:', fileUrl);
        console.log('[AI-API] File Name:', fileName);
        console.log('[AI-API] MIME Type:', mimeType);

        if (!documentId || !fileUrl) {
            console.error('[AI-API] Missing required fields');
            return NextResponse.json(
                { error: 'Missing required fields: documentId and fileUrl' },
                { status: 400 }
            );
        }

        // Update status to processing
        console.log('[AI-API] Updating document status to "processing"...');
        await supabase
            .from('customer_documents')
            .update({ ai_scan_status: 'processing' })
            .eq('id', documentId);

        // Get public URL for the document
        const publicUrl = supabase.storage
            .from('customer-documents')
            .getPublicUrl(fileUrl).data.publicUrl;

        console.log('[AI-API] Public URL:', publicUrl);

        // Perform AI verification with OpenAI
        console.log('[AI-API] Starting OpenAI GPT-4 Vision verification...');
        const verificationResult = await performOpenAIVerification(publicUrl, fileName, mimeType);

        // Update database with results
        console.log('[AI-API] Updating database with verification results...');

        const extractedDataForDb = verificationResult.extractedData ? {
            verification_status: verificationResult.status,
            confidence: verificationResult.confidence,
            message: verificationResult.message,
            validation_checks: verificationResult.validationChecks,
            provider: verificationResult.extractedData.provider || null,
            policyNumber: verificationResult.extractedData.policyNumber || null,
            startDate: verificationResult.extractedData.startDate || null,
            endDate: verificationResult.extractedData.endDate || null
        } : {
            verification_status: verificationResult.status,
            confidence: verificationResult.confidence,
            message: verificationResult.message,
            validation_checks: verificationResult.validationChecks,
            provider: null,
            policyNumber: null,
            startDate: null,
            endDate: null
        };

        const updateData: Record<string, unknown> = {
            ai_scan_status: verificationResult.status === 'approved' ? 'completed' :
                verificationResult.status === 'rejected' ? 'failed' : 'pending',
            ai_extracted_data: extractedDataForDb
        };

        if (verificationResult.status === 'rejected') {
            updateData.ai_scan_errors = [
                verificationResult.rejectionReason || 'Document verification failed',
                verificationResult.suggestion || 'Please upload a valid insurance document'
            ];
        }

        const { error: updateError } = await supabase
            .from('customer_documents')
            .update(updateData)
            .eq('id', documentId);

        if (updateError) {
            console.error('[AI-API] Database update error:', updateError);
        } else {
            console.log('[AI-API] Database updated successfully');
        }

        console.log('\n[AI-API] ═══════════════════════════════════════════════════');
        console.log('[AI-API] VERIFICATION COMPLETE');
        console.log('[AI-API] Status:', verificationResult.status);
        console.log('[AI-API] Confidence:', verificationResult.confidence);
        console.log('[AI-API] Message:', verificationResult.message);
        console.log('[AI-API] ═══════════════════════════════════════════════════\n');

        return NextResponse.json(verificationResult);

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : '';
        console.error('[AI-API] Error:', errorMessage);
        console.error('[AI-API] Stack:', errorStack);

        return NextResponse.json(
            {
                error: 'Verification failed',
                message: errorMessage,
                status: 'pending_review'
            },
            { status: 500 }
        );
    }
}

/**
 * Perform AI verification using OpenAI GPT-4 Vision
 * Supports both images and PDFs
 */
async function performOpenAIVerification(documentUrl: string, fileName: string, mimeType: string) {
    console.log('\n[AI-OPENAI] ═══ Starting OpenAI GPT-4 Vision Analysis ═══');
    console.log('[AI-OPENAI] Document URL:', documentUrl);
    console.log('[AI-OPENAI] MIME Type:', mimeType);

    const isPdf = mimeType === 'application/pdf';
    const isImage = mimeType?.startsWith('image/');

    // For PDFs, we need to extract text first since GPT-4 Vision works with images
    let documentContent: string | null = null;
    let base64Image: string | null = null;

    try {
        // Download the document
        console.log('[AI-OPENAI] Downloading document...');
        const docResponse = await fetch(documentUrl);
        if (!docResponse.ok) {
            throw new Error(`Failed to download document: ${docResponse.status}`);
        }

        const contentBuffer = await docResponse.arrayBuffer();
        const buffer = Buffer.from(contentBuffer);
        console.log('[AI-OPENAI] Document downloaded, size:', buffer.length, 'bytes');

        if (isPdf) {
            // Extract text from PDF using unpdf
            console.log('[AI-OPENAI] Extracting text from PDF...');
            try {
                const { extractText } = await import('unpdf');
                const uint8Array = new Uint8Array(buffer);
                const result = await extractText(uint8Array);
                documentContent = Array.isArray(result.text) ? result.text.join('\n') : (result.text || '');
                console.log('[AI-OPENAI] PDF text extracted, length:', documentContent.length);
                console.log('[AI-OPENAI] Number of pages:', result.totalPages);
            } catch (pdfError: unknown) {
                const errorMsg = pdfError instanceof Error ? pdfError.message : 'Unknown error';
                console.error('[AI-OPENAI] PDF extraction error:', errorMsg);
                documentContent = `[PDF FILE: ${fileName}] - Could not extract text`;
            }
        } else if (isImage) {
            // Convert image to base64 for GPT-4 Vision
            console.log('[AI-OPENAI] Converting image to base64...');
            base64Image = buffer.toString('base64');
            console.log('[AI-OPENAI] Image converted, base64 length:', base64Image.length);
        }
    } catch (downloadError: unknown) {
        const errorMsg = downloadError instanceof Error ? downloadError.message : 'Unknown error';
        console.error('[AI-OPENAI] Document processing error:', errorMsg);
    }

    // Build the verification prompt
    const verificationPrompt = buildVerificationPrompt(fileName, mimeType, documentContent);

    // Try primary API key first, then fallback
    let result = await callOpenAIAPI(verificationPrompt, base64Image, mimeType, OPENAI_API_KEY, 'PRIMARY');

    if (!result && OPENAI_API_KEY_FALLBACK) {
        console.log('[AI-OPENAI] Primary API failed, trying fallback key...');
        result = await callOpenAIAPI(verificationPrompt, base64Image, mimeType, OPENAI_API_KEY_FALLBACK, 'FALLBACK');
    }

    if (result) {
        return parseVerificationResponse(result, fileName, documentContent || '');
    }

    // Return pending review if all API calls fail
    return {
        status: 'pending_review',
        confidence: 0,
        message: 'Unable to verify document automatically. Manual review required.',
        extractedData: null,
        validationChecks: {
            documentType: 'UNKNOWN',
            policyActive: 'UNKNOWN',
            coverageAdequate: 'UNKNOWN',
            requiredFieldsPresent: 'UNKNOWN'
        }
    };
}

/**
 * Call OpenAI API with GPT-4 Vision
 */
async function callOpenAIAPI(
    prompt: string,
    base64Image: string | null,
    mimeType: string,
    apiKey: string,
    keyType: string
): Promise<string | null> {
    console.log(`[AI-OPENAI] ═══ Calling OpenAI API (${keyType}) ═══`);
    console.log('[AI-OPENAI] Model: gpt-5-2025-08-07');

    try {
        // Build message content
        const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

        // Add text prompt
        messageContent.push({
            type: 'text',
            text: prompt
        });

        // Add image if available (for image files)
        if (base64Image && mimeType?.startsWith('image/')) {
            console.log('[AI-OPENAI] Including image in request...');
            messageContent.push({
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType};base64,${base64Image}`
                }
            });
        }

        const requestBody = {
            model: 'gpt-5-2025-08-07', // GPT-5 model with vision support
            messages: [
                {
                    role: 'user',
                    content: messageContent
                }
            ],
            max_completion_tokens: 2000
            // Note: GPT-5 does not support temperature parameter
        };

        const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[AI-OPENAI] API Error (${keyType}):`, response.status, errorText);
            return null;
        }

        const data = await response.json();
        const aiResponse = data.choices?.[0]?.message?.content || '';

        console.log(`\n[AI-OPENAI] Response received (${keyType}):`);
        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log(aiResponse.substring(0, 500) + (aiResponse.length > 500 ? '...' : ''));
        console.log('└─────────────────────────────────────────────────────────────┘\n');

        return aiResponse;

    } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[AI-OPENAI] Request failed (${keyType}):`, errorMsg);
        return null;
    }
}

/**
 * Build verification prompt for OpenAI
 */
function buildVerificationPrompt(fileName: string, mimeType: string, extractedText: string | null): string {
    const hasText = extractedText && extractedText.trim().length > 0 && !extractedText.startsWith('[');
    const isImage = mimeType?.startsWith('image/');

    let prompt = `You are an expert insurance document verification specialist. Analyze the ${isImage ? 'uploaded image' : 'document'} and determine if it's a VALID INSURANCE CERTIFICATE.

DOCUMENT INFO:
- Filename: ${fileName}
- File type: ${mimeType}
`;

    if (hasText) {
        prompt += `
═══ EXTRACTED DOCUMENT TEXT ═══
${extractedText!.substring(0, 4000)}
═══ END OF DOCUMENT TEXT ═══
`;
    } else if (isImage) {
        prompt += `
═══ IMPORTANT ═══
Please analyze the image carefully to extract all insurance information.
Look for: policy number, insurer name, coverage dates, named insured, liability limits.
`;
    }

    prompt += `
═══ YOUR TASK ═══
Carefully analyze this document and determine:
1. Is this a legitimate insurance document? (Look for: policy number, coverage limits, effective/expiration dates, insurer name)
2. Extract all key insurance information you can find
3. Note if the policy appears to be active (check dates) but DO NOT reject based on expiration alone

═══ IMPORTANT RULES ═══
- APPROVE if the document is a legitimate insurance certificate/declarations page, even if the policy dates are expired
- Only REJECT if the document is clearly NOT an insurance document (receipt, random photo, unrelated document)
- Use MANUAL_REVIEW only if you cannot determine the document type
- Focus on DOCUMENT LEGITIMACY, not policy validity dates

═══ RESPOND IN THIS JSON FORMAT ONLY ═══
{
  "isInsuranceDocument": true or false,
  "confidence": 0.0 to 1.0,
  "documentType": "Insurance Certificate" or "Insurance Card" or "Declarations Page" or "Not Insurance",
  "extractedData": {
    "policyNumber": "extracted value or null",
    "insurer": "insurance company name or null",
    "namedInsured": "policyholder name or null",
    "effectiveDate": "YYYY-MM-DD or null",
    "expirationDate": "YYYY-MM-DD or null",
    "liabilityLimit": "amount or null",
    "vehicleInfo": "make/model/VIN if visible or null"
  },
  "validationResults": {
    "isDocumentValid": true or false,
    "isPolicyActive": true or false or null,
    "hasRequiredFields": true or false
  },
  "recommendation": "APPROVE" or "REJECT" or "MANUAL_REVIEW",
  "rejectionReason": "detailed reason if rejected, null otherwise",
  "message": "Brief human-readable summary of your findings"
}`;

    return prompt;
}

/**
 * Parse AI response and extract verification result
 */
interface ExtractedData {
    policyNumber?: string | null;
    insurer?: string | null;
    namedInsured?: string | null;
    effectiveDate?: string | null;
    expirationDate?: string | null;
}

interface ValidationResults {
    isDocumentValid?: boolean;
    isPolicyActive?: boolean | null;
    hasRequiredFields?: boolean;
}

interface ParsedResponse {
    isInsuranceDocument?: boolean;
    confidence?: number;
    recommendation?: string;
    message?: string;
    rejectionReason?: string | null;
    extractedData?: ExtractedData;
    validationResults?: ValidationResults;
}

function parseVerificationResponse(aiResponse: string, fileName: string, extractedText: string) {
    try {
        // Try to extract JSON from response
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed: ParsedResponse = JSON.parse(jsonMatch[0]);

            console.log('[AI-PARSE] Parsed JSON successfully');
            console.log('[AI-PARSE] Is Insurance Document:', parsed.isInsuranceDocument);
            console.log('[AI-PARSE] Recommendation:', parsed.recommendation);
            console.log('[AI-PARSE] Confidence:', parsed.confidence);

            const status = parsed.recommendation === 'APPROVE' ? 'approved' :
                parsed.recommendation === 'REJECT' ? 'rejected' : 'pending_review';

            return {
                status,
                confidence: parsed.confidence || 0.5,
                message: parsed.message || (status === 'approved' ? 'Document verified successfully' : 'Verification failed'),
                rejectionReason: parsed.rejectionReason,
                suggestion: status === 'rejected' ? 'Please upload a valid insurance certificate' : undefined,
                extractedData: parsed.extractedData ? {
                    provider: parsed.extractedData.insurer,
                    policyNumber: parsed.extractedData.policyNumber,
                    startDate: parsed.extractedData.effectiveDate,
                    endDate: parsed.extractedData.expirationDate
                } : null,
                validationChecks: {
                    documentType: parsed.isInsuranceDocument ? 'PASS' : 'FAIL',
                    policyActive: parsed.validationResults?.isPolicyActive === true ? 'PASS' :
                        parsed.validationResults?.isPolicyActive === false ? 'FAIL' : 'UNKNOWN',
                    coverageAdequate: 'UNKNOWN',
                    requiredFieldsPresent: parsed.validationResults?.hasRequiredFields ? 'PASS' : 'FAIL'
                }
            };
        }
    } catch (parseError) {
        console.error('[AI-PARSE] JSON parsing failed, using fallback analysis...');
    }

    // Fallback: text analysis
    const lower = aiResponse.toLowerCase();
    const fileNameLower = fileName.toLowerCase();

    // Check for rejection signals
    const rejectSignals = ['not an insurance', 'reject', 'invalid', 'not valid', 'unrelated', 'not a valid'];
    const isRejected = rejectSignals.some(s => lower.includes(s));

    // Check filename for non-insurance indicators
    const nonInsuranceNames = ['receipt', 'photo', 'selfie', 'cat', 'dog', 'screenshot', 'test'];
    const badFilename = nonInsuranceNames.some(s => fileNameLower.includes(s));

    if (isRejected || badFilename) {
        return {
            status: 'rejected',
            confidence: 0.7,
            message: 'This document is not a valid insurance certificate',
            rejectionReason: 'The uploaded document does not appear to be an insurance certificate',
            suggestion: 'Please upload your insurance certificate, declarations page, or policy document',
            extractedData: null,
            validationChecks: {
                documentType: 'FAIL',
                policyActive: 'UNKNOWN',
                coverageAdequate: 'UNKNOWN',
                requiredFieldsPresent: 'FAIL'
            }
        };
    }

    // Check for approval signals
    const approveSignals = ['valid insurance', 'approved', 'insurance certificate', 'policy confirmed'];
    const isApproved = approveSignals.some(s => lower.includes(s)) && !isRejected;

    if (isApproved) {
        return {
            status: 'approved',
            confidence: 0.75,
            message: 'Insurance document verified successfully',
            extractedData: null,
            validationChecks: {
                documentType: 'PASS',
                policyActive: 'UNKNOWN',
                coverageAdequate: 'UNKNOWN',
                requiredFieldsPresent: 'UNKNOWN'
            }
        };
    }

    // Default to pending review
    return {
        status: 'pending_review',
        confidence: 0.5,
        message: 'Document requires manual review',
        extractedData: null,
        validationChecks: {
            documentType: 'UNKNOWN',
            policyActive: 'UNKNOWN',
            coverageAdequate: 'UNKNOWN',
            requiredFieldsPresent: 'UNKNOWN'
        }
    };
}
