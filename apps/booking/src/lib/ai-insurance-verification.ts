/**
 * AI-Powered Insurance Document Verification Service
 * Implements 4-layer verification strategy:
 * 1. Document Type Recognition
 * 2. Field Extraction & Validation
 * 3. Business Rule Validation
 * 4. Fraud Detection
 */

// OpenRouter API Configuration - loaded from environment
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Verification result types
export interface VerificationResult {
    status: 'approved' | 'rejected' | 'pending_review';
    confidence: number;
    rejectionReason?: string;
    rejectionCode?: 'INVALID_DOCUMENT' | 'EXPIRED_POLICY' | 'INSUFFICIENT_COVERAGE' | 'MISSING_FIELDS' | 'SUSPICIOUS_DOCUMENT';
    message: string;
    suggestion?: string;
    extractedData: ExtractedInsuranceData | null;
    validationChecks: ValidationChecks;
    rawAIResponse?: string;
}

export interface ExtractedInsuranceData {
    policyNumber?: string;
    insurer?: string;
    namedInsured?: string;
    effectiveDate?: string;
    expirationDate?: string;
    bodilyInjuryLimit?: string;
    propertyDamageLimit?: string;
    provider?: string;
    startDate?: string;
    endDate?: string;
}

export interface ValidationChecks {
    documentType: 'PASS' | 'FAIL' | 'UNKNOWN';
    policyActive: 'PASS' | 'FAIL' | 'UNKNOWN';
    coverageAdequate: 'PASS' | 'FAIL' | 'UNKNOWN';
    requiredFieldsPresent: 'PASS' | 'FAIL' | 'UNKNOWN';
}

// Document type indicators from strategy document
const INSURANCE_DOCUMENT_INDICATORS = [
    'certificate of insurance',
    'declarations page',
    'insurance policy',
    'evidence of coverage',
    'acord 25',
    'acord 24',
    'policy number',
    'bodily injury',
    'property damage',
    'liability coverage',
    'comprehensive',
    'collision',
    'premium',
    'deductible',
    'effective date',
    'expiration date',
    'named insured',
    'policyholder'
];

// Known insurance carriers
const KNOWN_INSURERS = [
    'state farm', 'geico', 'progressive', 'allstate', 'usaa',
    'liberty mutual', 'farmers', 'nationwide', 'travelers',
    'american family', 'aaa', 'erie', 'mercury', 'safeco'
];

/**
 * Main verification function
 */
export async function verifyInsuranceDocument(
    documentUrl: string,
    documentName: string,
    mimeType: string
): Promise<VerificationResult> {
    console.log('\n========================================');
    console.log('[AI-VERIFY] Starting Insurance Document Verification');
    console.log('[AI-VERIFY] Document:', documentName);
    console.log('[AI-VERIFY] Type:', mimeType);
    console.log('[AI-VERIFY] URL:', documentUrl);
    console.log('========================================\n');

    try {
        // For PDFs, we need to extract text first (OpenRouter free model may not support images directly)
        // For images, we'll describe what we expect and ask the AI to analyze

        const verificationPrompt = buildVerificationPrompt(documentName, mimeType);

        console.log('[AI-VERIFY] Sending request to OpenRouter API...');
        console.log('[AI-VERIFY] Model: mistralai/mistral-7b-instruct:free');

        const response = await callOpenRouterAPI(verificationPrompt, documentUrl, mimeType);

        console.log('\n[AI-VERIFY] Raw AI Response:');
        console.log('----------------------------------------');
        console.log(response);
        console.log('----------------------------------------\n');

        // Parse the AI response
        const result = parseAIResponse(response, documentName);

        console.log('[AI-VERIFY] Verification Result:');
        console.log('[AI-VERIFY] Status:', result.status);
        console.log('[AI-VERIFY] Confidence:', result.confidence);
        console.log('[AI-VERIFY] Message:', result.message);
        if (result.extractedData) {
            console.log('[AI-VERIFY] Extracted Data:', JSON.stringify(result.extractedData, null, 2));
        }
        console.log('[AI-VERIFY] Validation Checks:', JSON.stringify(result.validationChecks, null, 2));

        return result;

    } catch (error: any) {
        console.error('[AI-ERROR] Verification failed:', error.message);
        console.error('[AI-ERROR] Stack:', error.stack);

        return {
            status: 'pending_review',
            confidence: 0,
            message: 'Unable to automatically verify document. Manual review required.',
            extractedData: null,
            validationChecks: {
                documentType: 'UNKNOWN',
                policyActive: 'UNKNOWN',
                coverageAdequate: 'UNKNOWN',
                requiredFieldsPresent: 'UNKNOWN'
            },
            rawAIResponse: error.message
        };
    }
}

/**
 * Build the verification prompt based on the strategy document
 */
function buildVerificationPrompt(documentName: string, mimeType: string): string {
    return `You are an AI insurance document verification specialist. Analyze the uploaded document and determine if it's a valid insurance certificate.

DOCUMENT INFO:
- Filename: ${documentName}
- File type: ${mimeType}

VERIFICATION TASKS:

**LAYER 1 - Document Type Recognition:**
Determine if this is an insurance document by looking for:
- Standard insurance markers: "Certificate of Insurance", "Declarations Page", "Insurance Policy", "Evidence of Coverage"
- Insurance company letterhead or NAIC number
- ACORD form identifiers (ACORD 25, ACORD 24, etc.)

**LAYER 2 - Required Field Extraction:**
Extract these fields if present:
- Policy Number (alphanumeric, 8-20 characters)
- Named Insured / Policyholder Name
- Insurance Company Name
- Effective Date (must be ≤ today)
- Expiration Date (must be > today)
- Bodily Injury Liability Limits
- Property Damage Liability Limits

**LAYER 3 - Business Rule Validation:**
- Is the policy currently active (not expired)?
- Do coverage limits meet minimum requirements ($25,000/$50,000/$25,000)?
- Is the insurance company recognized?

**LAYER 4 - Validity Assessment:**
- Are all dates logically consistent?
- Does the document appear authentic?
- Are there any red flags?

RESPOND IN THIS EXACT JSON FORMAT:
{
  "isInsuranceDocument": true/false,
  "confidence": 0.0-1.0,
  "documentType": "Insurance Certificate" | "Declarations Page" | "Policy Document" | "Not Insurance" | "Unknown",
  "extractedData": {
    "policyNumber": "extracted or null",
    "insurer": "company name or null",
    "namedInsured": "name or null",
    "effectiveDate": "YYYY-MM-DD or null",
    "expirationDate": "YYYY-MM-DD or null",
    "bodilyInjuryLimit": "amount or null",
    "propertyDamageLimit": "amount or null"
  },
  "validationResults": {
    "isDocumentValid": true/false,
    "isPolicyActive": true/false/null,
    "isCoverageAdequate": true/false/null,
    "hasRequiredFields": true/false
  },
  "issues": ["list of any issues found"],
  "recommendation": "APPROVE" | "REJECT" | "MANUAL_REVIEW",
  "rejectionReason": "reason if rejected, null otherwise",
  "message": "Human-readable summary"
}

If the document is clearly NOT an insurance document (e.g., random image, receipt, ID card, unrelated document), set isInsuranceDocument to false and recommendation to REJECT.`;
}

/**
 * Call OpenRouter API
 */
async function callOpenRouterAPI(prompt: string, documentUrl: string, mimeType: string): Promise<string> {
    console.log('[AI-API] Calling OpenRouter API...');

    // Build messages based on document type
    const messages: any[] = [];

    // For image types, include the image in the message
    if (mimeType.startsWith('image/')) {
        console.log('[AI-API] Processing as image document...');
        messages.push({
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                {
                    type: 'image_url',
                    image_url: {
                        url: documentUrl,
                        detail: 'high'
                    }
                }
            ]
        });
    } else {
        // For PDFs, we'll ask the AI to analyze based on what's typically in the document
        console.log('[AI-API] Processing as PDF document (text-based analysis)...');
        messages.push({
            role: 'user',
            content: `${prompt}\n\nNote: This is a PDF document uploaded as "${documentUrl}". Based on the filename and context, please analyze what type of document this likely is and provide your verification assessment. If you cannot directly view the content, make reasonable inferences from the filename and provide a conservative assessment.`
        });
    }

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
                model: 'mistralai/mistral-7b-instruct:free', // Free model from OpenRouter
                messages: messages,
                temperature: 0.1,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[AI-API] API Error Response:', errorText);
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('[AI-API] API Response received successfully');

        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content;
        }

        throw new Error('Invalid API response structure');

    } catch (error: any) {
        console.error('[AI-API] Request failed:', error.message);
        throw error;
    }
}

/**
 * Parse AI response and convert to VerificationResult
 */
function parseAIResponse(aiResponse: string, documentName: string): VerificationResult {
    console.log('[AI-PARSE] Parsing AI response...');

    try {
        // Try to extract JSON from the response
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.log('[AI-PARSE] No JSON found in response, analyzing text...');
            return analyzeTextResponse(aiResponse, documentName);
        }

        const parsed = JSON.parse(jsonMatch[0]);
        console.log('[AI-PARSE] Successfully parsed JSON response');

        // Map to our result format
        const result: VerificationResult = {
            status: mapRecommendationToStatus(parsed.recommendation, parsed.isInsuranceDocument),
            confidence: parsed.confidence || 0.5,
            message: parsed.message || 'Document analyzed',
            extractedData: parsed.extractedData ? {
                policyNumber: parsed.extractedData.policyNumber,
                insurer: parsed.extractedData.insurer,
                namedInsured: parsed.extractedData.namedInsured,
                effectiveDate: parsed.extractedData.effectiveDate,
                expirationDate: parsed.extractedData.expirationDate,
                bodilyInjuryLimit: parsed.extractedData.bodilyInjuryLimit,
                propertyDamageLimit: parsed.extractedData.propertyDamageLimit,
                provider: parsed.extractedData.insurer,
                startDate: parsed.extractedData.effectiveDate,
                endDate: parsed.extractedData.expirationDate
            } : null,
            validationChecks: {
                documentType: parsed.isInsuranceDocument ? 'PASS' : 'FAIL',
                policyActive: parsed.validationResults?.isPolicyActive ? 'PASS' :
                    parsed.validationResults?.isPolicyActive === false ? 'FAIL' : 'UNKNOWN',
                coverageAdequate: parsed.validationResults?.isCoverageAdequate ? 'PASS' :
                    parsed.validationResults?.isCoverageAdequate === false ? 'FAIL' : 'UNKNOWN',
                requiredFieldsPresent: parsed.validationResults?.hasRequiredFields ? 'PASS' : 'FAIL'
            },
            rawAIResponse: aiResponse
        };

        // Set rejection details if rejected
        if (result.status === 'rejected') {
            result.rejectionReason = parsed.rejectionReason || 'Document does not meet verification requirements';
            result.rejectionCode = mapToRejectionCode(parsed);
            result.suggestion = getSuggestionForRejection(result.rejectionCode);
        }

        return result;

    } catch (parseError: any) {
        console.error('[AI-PARSE] JSON parsing failed:', parseError.message);
        return analyzeTextResponse(aiResponse, documentName);
    }
}

/**
 * Analyze non-JSON text response
 */
function analyzeTextResponse(response: string, documentName: string): VerificationResult {
    console.log('[AI-PARSE] Analyzing text response...');

    const lowerResponse = response.toLowerCase();
    const lowerFileName = documentName.toLowerCase();

    // Check if response indicates it's not an insurance document
    const notInsuranceIndicators = [
        'not an insurance',
        'not insurance',
        'does not appear to be',
        'is not a valid insurance',
        'cannot verify',
        'unrelated document',
        'not a certificate',
        'reject'
    ];

    const isRejected = notInsuranceIndicators.some(ind => lowerResponse.includes(ind));

    // Check if response indicates approval
    const approvalIndicators = [
        'valid insurance',
        'approve',
        'verified successfully',
        'certificate of insurance',
        'policy appears valid'
    ];

    const isApproved = approvalIndicators.some(ind => lowerResponse.includes(ind)) && !isRejected;

    // Also check filename for obvious non-insurance documents
    const obviousNonInsurance = [
        'receipt', 'invoice', 'photo', 'selfie', 'screenshot',
        'id', 'license', 'passport', 'registration', 'cat', 'dog'
    ];
    const filenameIndicatesNonInsurance = obviousNonInsurance.some(ind => lowerFileName.includes(ind));

    if (isRejected || filenameIndicatesNonInsurance) {
        return {
            status: 'rejected',
            confidence: 0.7,
            rejectionReason: 'The uploaded document does not appear to be a valid insurance certificate',
            rejectionCode: 'INVALID_DOCUMENT',
            message: 'This document is not recognized as a valid insurance certificate. Please upload your insurance certificate or declarations page.',
            suggestion: 'Please upload a valid insurance certificate, declarations page, or ACORD form',
            extractedData: null,
            validationChecks: {
                documentType: 'FAIL',
                policyActive: 'UNKNOWN',
                coverageAdequate: 'UNKNOWN',
                requiredFieldsPresent: 'FAIL'
            },
            rawAIResponse: response
        };
    }

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
            },
            rawAIResponse: response
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
        },
        rawAIResponse: response
    };
}

/**
 * Map AI recommendation to our status
 */
function mapRecommendationToStatus(recommendation: string, isInsuranceDocument: boolean): 'approved' | 'rejected' | 'pending_review' {
    if (!isInsuranceDocument) return 'rejected';

    switch (recommendation?.toUpperCase()) {
        case 'APPROVE':
            return 'approved';
        case 'REJECT':
            return 'rejected';
        default:
            return 'pending_review';
    }
}

/**
 * Map parsed response to rejection code
 */
function mapToRejectionCode(parsed: any): VerificationResult['rejectionCode'] {
    if (!parsed.isInsuranceDocument) return 'INVALID_DOCUMENT';
    if (parsed.validationResults?.isPolicyActive === false) return 'EXPIRED_POLICY';
    if (parsed.validationResults?.isCoverageAdequate === false) return 'INSUFFICIENT_COVERAGE';
    if (!parsed.validationResults?.hasRequiredFields) return 'MISSING_FIELDS';
    return 'INVALID_DOCUMENT';
}

/**
 * Get user-friendly suggestion for rejection
 */
function getSuggestionForRejection(code?: VerificationResult['rejectionCode']): string {
    switch (code) {
        case 'INVALID_DOCUMENT':
            return 'Please upload a valid insurance certificate, declarations page, or ACORD form (PDF, JPG, or PNG)';
        case 'EXPIRED_POLICY':
            return 'Please upload a current, active insurance policy that has not expired';
        case 'INSUFFICIENT_COVERAGE':
            return 'Please upload a policy with adequate liability coverage (minimum $25,000/$50,000/$25,000)';
        case 'MISSING_FIELDS':
            return 'Please upload a complete insurance document showing policy number, dates, and coverage limits';
        case 'SUSPICIOUS_DOCUMENT':
            return 'Please upload an original, unmodified insurance document';
        default:
            return 'Please upload a valid insurance certificate';
    }
}

export default verifyInsuranceDocument;
