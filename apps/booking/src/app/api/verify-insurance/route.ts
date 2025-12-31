/**
 * API Route: Insurance Document Verification
 * POST /api/verify-insurance
 * 
 * Receives document info and triggers AI verification
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// OpenRouter API Configuration - loaded from environment
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Supabase client for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest) {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║       AI INSURANCE VERIFICATION - API REQUEST               ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // Debug: Check if API key is loaded
    const apiKeyLoaded = OPENROUTER_API_KEY && OPENROUTER_API_KEY.length > 0;
    console.log('[AI-API] OpenRouter API Key loaded:', apiKeyLoaded ? 'YES (' + OPENROUTER_API_KEY.substring(0, 15) + '...)' : 'NO - KEY IS EMPTY!');

    if (!apiKeyLoaded) {
        console.error('[AI-API] ERROR: OPENROUTER_API_KEY environment variable is not set!');
        console.error('[AI-API] Make sure OPENROUTER_API_KEY is defined in your .env file');
        return NextResponse.json(
            {
                error: 'API configuration error',
                message: 'OpenRouter API key not configured',
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

        // Perform AI verification
        console.log('[AI-API] Starting AI verification...');
        const verificationResult = await performAIVerification(publicUrl, fileName, mimeType);

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

        const updateData: any = {
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

    } catch (error: any) {
        console.error('[AI-API] Error:', error.message);
        console.error('[AI-API] Stack:', error.stack);

        return NextResponse.json(
            {
                error: 'Verification failed',
                message: error.message,
                status: 'pending_review'
            },
            { status: 500 }
        );
    }
}

/**
 * Perform AI verification using OpenRouter with OCR text extraction
 */
async function performAIVerification(documentUrl: string, fileName: string, mimeType: string) {
    console.log('\n[AI-LAYER1] ═══ Document Type Recognition ═══');
    console.log('[AI-LAYER1] Analyzing document type...');
    console.log('[AI-LAYER1] MIME Type:', mimeType);

    // Step 1: Extract text from the document using OCR
    let extractedText = '';

    try {
        console.log('[AI-OCR] ═══ Starting Text Extraction ═══');
        console.log('[AI-OCR] Downloading document from:', documentUrl);

        // Download the document
        const docResponse = await fetch(documentUrl);
        if (!docResponse.ok) {
            throw new Error(`Failed to download document: ${docResponse.status}`);
        }

        const contentBuffer = await docResponse.arrayBuffer();
        const buffer = Buffer.from(contentBuffer);
        // Convert to Uint8Array for unpdf compatibility
        const uint8Array = new Uint8Array(buffer);
        console.log('[AI-OCR] Document downloaded, size:', buffer.length, 'bytes');

        if (mimeType === 'application/pdf') {
            // Extract text from PDF using unpdf
            console.log('[AI-OCR] Extracting text from PDF using unpdf...');
            try {
                const { extractText } = await import('unpdf');
                // unpdf requires Uint8Array, not Buffer
                const result = await extractText(uint8Array);
                // unpdf returns text as array of pages, join them
                extractedText = Array.isArray(result.text) ? result.text.join('\n') : (result.text || '');
                console.log('[AI-OCR] PDF text extracted successfully!');
                console.log('[AI-OCR] Text length:', extractedText.length, 'characters');
                console.log('[AI-OCR] Number of pages:', result.totalPages);
            } catch (pdfError: any) {
                console.error('[AI-OCR] PDF extraction error:', pdfError.message);
                // Try alternative approach - read as text if extraction fails
                try {
                    extractedText = buffer.toString('utf8').replace(/[^\x20-\x7E\n]/g, ' ');
                    console.log('[AI-OCR] Fallback text extraction, length:', extractedText.length);
                } catch {
                    console.error('[AI-OCR] All extraction methods failed');
                }
            }
        } else if (mimeType?.startsWith('image/')) {
            // Extract text from image using node-tesseract-ocr (CLI-based)
            console.log('[AI-OCR] Image document detected');
            console.log('[AI-OCR] Extracting text using Tesseract OCR...');

            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const tesseract = require('node-tesseract-ocr');
                const fs = await import('fs');
                const path = await import('path');
                const os = await import('os');

                // Write buffer to temp file for tesseract
                const tempDir = os.tmpdir();
                const tempFile = path.join(tempDir, `ocr-${Date.now()}.${mimeType.split('/')[1] || 'png'}`);
                fs.writeFileSync(tempFile, buffer);
                console.log('[AI-OCR] Temp file created:', tempFile);

                // OCR config
                const config = {
                    lang: 'eng',
                    oem: 1,
                    psm: 3,
                };

                // Extract text
                extractedText = await tesseract.recognize(tempFile, config);
                console.log('[AI-OCR] Image OCR completed successfully!');
                console.log('[AI-OCR] Text length:', extractedText.length, 'characters');

                // Clean up temp file
                fs.unlinkSync(tempFile);
                console.log('[AI-OCR] Temp file cleaned up');

            } catch (ocrError: any) {
                console.error('[AI-OCR] Image OCR error:', ocrError.message);
                // Fallback to filename analysis
                const fileNameLower = fileName.toLowerCase();
                const insuranceKeywords = ['insurance', 'policy', 'certificate', 'coverage', 'auto'];
                const hasInsuranceKeyword = insuranceKeywords.some(k => fileNameLower.includes(k));

                if (hasInsuranceKeyword) {
                    extractedText = `[INSURANCE IMAGE - OCR FAILED]\nFilename: ${fileName}\nThis appears to be an insurance document based on filename.`;
                } else {
                    extractedText = `[IMAGE FILE: ${fileName}] - OCR failed, analyze based on filename.`;
                }
            }
        } else {
            console.log('[AI-OCR] Unknown document type, using filename analysis only');
        }

        // Log first 500 chars of extracted text
        if (extractedText) {
            console.log('[AI-OCR] Extracted text preview:');
            console.log('┌─────────────────────────────────────────────────────────────┐');
            console.log(extractedText.substring(0, 500).replace(/\n/g, ' ').trim() + (extractedText.length > 500 ? '...' : ''));
            console.log('└─────────────────────────────────────────────────────────────┘');
        }

    } catch (ocrError: any) {
        console.error('[AI-OCR] Text extraction failed:', ocrError.message);
        // Continue with filename-based analysis
    }

    // Step 2: Build prompt with extracted text
    const prompt = buildVerificationPromptWithText(fileName, mimeType, extractedText);

    const messages = [{
        role: 'user',
        content: prompt
    }];

    console.log('[AI-LAYER2] ═══ Sending to OpenRouter API ═══');
    console.log('[AI-LAYER2] Model: mistralai/mistral-7b-instruct:free');

    try {
        const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://drive247.com',
                'X-Title': 'Drive247 Insurance Verification'
            },
            body: JSON.stringify({
                model: 'mistralai/mistral-7b-instruct:free',
                messages: messages,
                temperature: 0.1,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[AI-LAYER2] API Error:', response.status, errorText);
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices?.[0]?.message?.content || '';

        console.log('\n[AI-LAYER2] Raw AI Response:');
        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log(aiResponse.substring(0, 500) + (aiResponse.length > 500 ? '...' : ''));
        console.log('└─────────────────────────────────────────────────────────────┘\n');

        console.log('[AI-LAYER3] ═══ Parsing Verification Results ═══');
        return parseVerificationResponse(aiResponse, fileName, extractedText);

    } catch (error: any) {
        console.error('[AI-LAYER2] Request failed:', error.message);

        // Return a pending review status on API failure
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
}

/**
 * Build verification prompt
 */
function buildVerificationPrompt(fileName: string, mimeType: string): string {
    return `You are an AI insurance document verification specialist. Your task is to analyze the uploaded document and determine if it's a VALID INSURANCE CERTIFICATE.

DOCUMENT INFO:
- Filename: ${fileName}
- File type: ${mimeType}

═══ VERIFICATION CHECKLIST ═══

**1. DOCUMENT TYPE CHECK:**
Is this an insurance document? Look for:
- "Certificate of Insurance", "Declarations Page", "Insurance Policy"
- Insurance company name/logo
- Policy number format
- Coverage limits

**2. REQUIRED FIELDS:**
- Policy Number
- Named Insured
- Insurance Company
- Effective Date
- Expiration Date
- Liability Limits

**3. VALIDITY CHECK:**
- Is the policy currently active?
- Are dates reasonable?
- Is this from a real insurance provider?

═══ CRITICAL RULES ═══
- If this is NOT an insurance document (receipt, random photo, ID card, etc.), REJECT it
- If essential insurance info is missing, REJECT it
- Be strict - only approve clear insurance documents

═══ RESPOND IN JSON FORMAT ═══
{
  "isInsuranceDocument": true/false,
  "confidence": 0.0-1.0,
  "documentType": "Insurance Certificate" | "Not Insurance",
  "extractedData": {
    "policyNumber": "value or null",
    "insurer": "company name or null",
    "namedInsured": "name or null",
    "effectiveDate": "YYYY-MM-DD or null",
    "expirationDate": "YYYY-MM-DD or null"
  },
  "validationResults": {
    "isDocumentValid": true/false,
    "isPolicyActive": true/false/null,
    "hasRequiredFields": true/false
  },
  "recommendation": "APPROVE" | "REJECT" | "MANUAL_REVIEW",
  "rejectionReason": "reason if rejected",
  "message": "Brief explanation"
}`;
}

/**
 * Build verification prompt with extracted text (OCR)
 */
function buildVerificationPromptWithText(fileName: string, mimeType: string, extractedText: string): string {
    const hasText = extractedText && extractedText.trim().length > 0;
    const isImage = mimeType?.startsWith('image/');
    const filenameHasInsuranceKeywords = /insurance|policy|certificate|coverage|declaration|auto|car|vehicle|liability/i.test(fileName);

    let prompt = `You are an AI insurance document verification specialist. Analyze the following document and determine if it's a VALID INSURANCE CERTIFICATE.

DOCUMENT INFO:
- Filename: ${fileName}
- File type: ${mimeType}
`;

    if (hasText) {
        prompt += `
═══ EXTRACTED DOCUMENT TEXT ═══
${extractedText.substring(0, 3000)}
═══ END OF DOCUMENT TEXT ═══
`;
    } else {
        prompt += `
Note: Could not extract text from this document. Analyze based on filename only.
`;
    }

    // Special handling for image files with insurance-related filenames
    if (isImage && filenameHasInsuranceKeywords) {
        prompt += `
═══ IMPORTANT ═══
This is an IMAGE file with a filename that suggests it's an insurance document.
Since we cannot read the actual image content, but the filename contains insurance-related keywords,
you should recommend MANUAL_REVIEW (not REJECT) to allow human verification.
`;
    }

    prompt += `
═══ YOUR TASK ═══
Based on the document text above, determine:
1. Is this an insurance document? (Look for: policy number, coverage limits, effective/expiration dates, insurer name)
2. If it IS insurance with readable content: APPROVE and extract the key fields
3. If it appears to be insurance but content cannot be verified: MANUAL_REVIEW
4. If it is clearly NOT insurance: REJECT

═══ RESPOND IN THIS JSON FORMAT ONLY ═══
{
  "isInsuranceDocument": true or false,
  "confidence": 0.0 to 1.0,
  "documentType": "Insurance Certificate" or "Not Insurance",
  "extractedData": {
    "policyNumber": "value or null",
    "insurer": "company name or null",
    "namedInsured": "name or null",
    "effectiveDate": "YYYY-MM-DD or null",
    "expirationDate": "YYYY-MM-DD or null"
  },
  "validationResults": {
    "isDocumentValid": true or false,
    "isPolicyActive": true or false or null,
    "hasRequiredFields": true or false
  },
  "recommendation": "APPROVE" or "REJECT" or "MANUAL_REVIEW",
  "rejectionReason": "reason if rejected, null otherwise",
  "message": "Brief human-readable summary"
}`;

    return prompt;
}

/**
 * Parse AI response
 */
function parseVerificationResponse(aiResponse: string, fileName: string, extractedText?: string) {
    try {
        // Try to extract JSON
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);

            console.log('[AI-LAYER3] Parsed JSON successfully');
            console.log('[AI-LAYER3] Is Insurance Document:', parsed.isInsuranceDocument);
            console.log('[AI-LAYER3] Recommendation:', parsed.recommendation);

            const status = parsed.recommendation === 'APPROVE' ? 'approved' :
                parsed.recommendation === 'REJECT' ? 'rejected' : 'pending_review';

            return {
                status,
                confidence: parsed.confidence || 0.5,
                message: parsed.message || (status === 'approved' ? 'Document verified' : 'Verification failed'),
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
                    policyActive: parsed.validationResults?.isPolicyActive ? 'PASS' :
                        parsed.validationResults?.isPolicyActive === false ? 'FAIL' : 'UNKNOWN',
                    coverageAdequate: 'UNKNOWN',
                    requiredFieldsPresent: parsed.validationResults?.hasRequiredFields ? 'PASS' : 'FAIL'
                }
            };
        }
    } catch (parseError) {
        console.error('[AI-LAYER3] JSON parsing failed, analyzing text...');
    }

    // Fallback: text analysis
    const lower = aiResponse.toLowerCase();
    const fileNameLower = fileName.toLowerCase();

    // Check for obvious rejection signals
    const rejectSignals = ['not an insurance', 'reject', 'invalid', 'not valid', 'unrelated'];
    const isRejected = rejectSignals.some(s => lower.includes(s));

    // Check filename for non-insurance indicators
    const nonInsuranceNames = ['receipt', 'photo', 'selfie', 'cat', 'dog', 'screenshot', 'test'];
    const badFilename = nonInsuranceNames.some(s => fileNameLower.includes(s));

    if (isRejected || badFilename) {
        console.log('[AI-LAYER3] Document REJECTED based on analysis');
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
    const approveSignals = ['valid', 'approved', 'insurance certificate', 'policy'];
    const isApproved = approveSignals.some(s => lower.includes(s)) && !isRejected;

    if (isApproved) {
        console.log('[AI-LAYER3] Document APPROVED based on analysis');
        return {
            status: 'approved',
            confidence: 0.7,
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
    console.log('[AI-LAYER3] Document requires MANUAL REVIEW');
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
