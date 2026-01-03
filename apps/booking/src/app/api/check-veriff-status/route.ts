import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Generate HMAC-SHA256 signature for Veriff API
function generateVeriffSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

interface VeriffResult {
    status?: string;
    code?: number;
    decision?: string | null;
    person?: {
        firstName?: string;
        lastName?: string;
    };
    document?: {
        number?: string;
    };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');

        if (!sessionId) {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }

        const VERIFF_API_KEY = process.env.NEXT_PUBLIC_VERIFF_API_KEY || process.env.VERIFF_API_KEY;
        const VERIFF_API_SECRET = process.env.VERIFF_API_SECRET;

        if (!VERIFF_API_KEY) {
            console.error('VERIFF_API_KEY not configured');
            return NextResponse.json({ error: 'Veriff API key not configured' }, { status: 500 });
        }

        console.log('🔍 Checking Veriff session status for:', sessionId);

        // Try different Veriff API endpoints
        const headers: Record<string, string> = {
            'X-AUTH-CLIENT': VERIFF_API_KEY,
            'Content-Type': 'application/json',
        };

        // Add HMAC signature if secret is available
        if (VERIFF_API_SECRET) {
            const signature = generateVeriffSignature(sessionId, VERIFF_API_SECRET);
            headers['X-HMAC-SIGNATURE'] = signature;
        }

        let result: VeriffResult | null = null;
        let statusCode = 9000; // default to session created
        let decision: string | null = null;

        // Try attempts endpoint
        try {
            const attemptsUrl = `https://stationapi.veriff.com/v1/sessions/${sessionId}/attempts`;
            const attemptsResponse = await fetch(attemptsUrl, {
                method: 'GET',
                headers,
            });

            if (attemptsResponse.ok) {
                const attemptsData = await attemptsResponse.json();
                console.log('📋 Veriff attempts response:', JSON.stringify(attemptsData, null, 2));

                if (attemptsData.verifications && attemptsData.verifications.length > 0) {
                    const latestVerification = attemptsData.verifications[0];
                    statusCode = latestVerification.code || 9000;
                    decision = latestVerification.decision;
                    result = {
                        status: latestVerification.status,
                        code: statusCode,
                        decision: decision,
                        person: latestVerification.person,
                        document: latestVerification.document,
                    };
                }
            } else {
                console.log('❌ Attempts endpoint failed:', attemptsResponse.status);
            }
        } catch (err) {
            console.error('Error fetching attempts:', err);
        }

        // If attempts didn't work, try the decision endpoint
        if (!result) {
            try {
                const decisionUrl = `https://stationapi.veriff.com/v1/sessions/${sessionId}/decision`;
                const decisionResponse = await fetch(decisionUrl, {
                    method: 'GET',
                    headers,
                });

                if (decisionResponse.ok) {
                    const decisionData = await decisionResponse.json();
                    console.log('📋 Veriff decision response:', JSON.stringify(decisionData, null, 2));

                    if (decisionData.verification) {
                        statusCode = decisionData.verification.code || 9000;
                        decision = decisionData.verification.decision || decisionData.verification.status;
                        result = {
                            status: decisionData.verification.status,
                            code: statusCode,
                            decision: decision,
                            person: decisionData.verification.person,
                            document: decisionData.verification.document,
                        };
                    }
                } else {
                    console.log('❌ Decision endpoint failed:', decisionResponse.status);
                }
            } catch (err) {
                console.error('Error fetching decision:', err);
            }
        }

        // Map Veriff codes to our format
        // 9001 = approved, 9102 = declined, 9103 = resubmission, 9104 = expired
        let review_result: string | null = null;
        if (statusCode === 9001 || decision === 'approved') {
            review_result = 'GREEN';
        } else if (statusCode === 9102 || decision === 'declined') {
            review_result = 'RED';
        } else if (statusCode === 9103 || decision === 'resubmission_requested') {
            review_result = 'RETRY';
        }

        console.log('📋 Final result - code:', statusCode, 'decision:', decision, 'review_result:', review_result);

        return NextResponse.json({
            ok: true,
            sessionId,
            review_result,
            status_code: statusCode,
            decision,
            person: result?.person || null,
            document: result?.document || null,
        });
    } catch (error: unknown) {
        console.error('Error checking Veriff status:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: 'Failed to check verification status', detail: errorMessage },
            { status: 500 }
        );
    }
}
