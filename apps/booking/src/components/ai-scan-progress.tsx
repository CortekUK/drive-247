'use client';

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, AlertCircle, FileCheck, Shield, AlertTriangle } from "lucide-react";

interface Props {
  documentId: string;
}

type ScanStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface ExtractedData {
  provider?: string;
  policyNumber?: string;
  policyHolderName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  coverageType?: string;
  coverageLimits?: {
    liability?: number;
    collision?: number;
    comprehensive?: number;
  };
  isValidDocument?: boolean;
  isExpired?: boolean;
  documentType?: string;
  validationNotes?: string[];
  needsManualReview?: boolean;
  reviewReasons?: string[];
  fraudRiskScore?: number;
  verificationDecision?: string;
  // Legacy field names for backwards compatibility
  startDate?: string;
  endDate?: string;
}

export default function AIScanProgress({ documentId }: Props) {
  const [status, setStatus] = useState<ScanStatus>('pending');
  const [progress, setProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [validationScore, setValidationScore] = useState<number | null>(null);
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);

  useEffect(() => {
    // Initial fetch
    fetchStatus();

    // Poll document status every 1.5 seconds
    const interval = setInterval(fetchStatus, 1500);

    return () => clearInterval(interval);
  }, [documentId]);

  const fetchStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('customer_documents')
        .select('ai_scan_status, ai_extracted_data, ai_scan_errors, ai_validation_score, ai_confidence_score')
        .eq('id', documentId)
        .single();

      if (error) {
        console.error('Error fetching scan status:', error);
        return;
      }

      if (data) {
        setStatus(data.ai_scan_status as ScanStatus);
        setExtractedData(data.ai_extracted_data as ExtractedData);
        setValidationScore(data.ai_validation_score);
        setConfidenceScore(data.ai_confidence_score);

        // Update progress based on status
        if (data.ai_scan_status === 'pending') {
          setProgress(10);
        } else if (data.ai_scan_status === 'processing') {
          setProgress(50);
        } else if (data.ai_scan_status === 'completed') {
          setProgress(100);
        } else if (data.ai_scan_status === 'failed') {
          setProgress(0);
        }
      }
    } catch (error) {
      console.error('Error in fetchStatus:', error);
    }
  };

  // Get score color based on value
  const getScoreColor = (score: number) => {
    if (score >= 0.85) return 'text-green-600';
    if (score >= 0.60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 0.85) return 'Verified';
    if (score >= 0.60) return 'Review Needed';
    return 'Low Confidence';
  };

  // Get verification decision display
  const getDecisionDisplay = () => {
    const decision = extractedData?.verificationDecision;
    switch (decision) {
      case 'auto_approved':
        return { label: 'Auto-Approved', color: 'text-green-600', bg: 'bg-green-100' };
      case 'auto_rejected':
        return { label: 'Rejected', color: 'text-red-600', bg: 'bg-red-100' };
      case 'pending_review':
        return { label: 'Pending Review', color: 'text-yellow-600', bg: 'bg-yellow-100' };
      default:
        return null;
    }
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'pending':
        return {
          icon: <FileCheck className="h-16 w-16 mx-auto text-primary animate-pulse" />,
          title: 'Preparing Document...',
          description: 'Getting ready to verify your insurance certificate',
          color: 'text-primary'
        };
      case 'processing':
        return {
          icon: <Loader2 className="h-16 w-16 mx-auto text-primary animate-spin" />,
          title: 'AI Verification in Progress...',
          description: 'Analyzing your document with GPT-5 AI verification',
          color: 'text-primary'
        };
      case 'completed':
        const isApproved = extractedData?.verificationDecision === 'auto_approved';
        const needsReview = extractedData?.needsManualReview || extractedData?.verificationDecision === 'pending_review';

        return {
          icon: isApproved
            ? <CheckCircle className="h-16 w-16 mx-auto text-green-600" />
            : needsReview
            ? <AlertTriangle className="h-16 w-16 mx-auto text-yellow-600" />
            : <CheckCircle className="h-16 w-16 mx-auto text-primary" />,
          title: isApproved
            ? 'Insurance Verified!'
            : needsReview
            ? 'Review Required'
            : 'Verification Complete',
          description: extractedData?.provider
            ? `${extractedData.provider}${extractedData.policyNumber ? ` • Policy: ${extractedData.policyNumber}` : ''}`
            : 'Your insurance document has been processed',
          color: isApproved ? 'text-green-600' : needsReview ? 'text-yellow-600' : 'text-primary'
        };
      case 'failed':
        return {
          icon: <AlertCircle className="h-16 w-16 mx-auto text-destructive" />,
          title: 'Verification Issue',
          description: extractedData?.reviewReasons?.[0] || 'Unable to verify document. Please try again or upload a clearer image.',
          color: 'text-destructive',
          showReupload: true
        };
      default:
        return {
          icon: <Shield className="h-16 w-16 mx-auto text-muted-foreground" />,
          title: 'Processing...',
          description: 'Please wait',
          color: 'text-muted-foreground'
        };
    }
  };

  const statusConfig = getStatusConfig();
  const decisionDisplay = getDecisionDisplay();

  // Format date for display
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  // Get effective/expiration dates (support both old and new field names)
  const effectiveDate = extractedData?.effectiveDate || extractedData?.startDate;
  const expirationDate = extractedData?.expirationDate || extractedData?.endDate;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center space-y-6">
        {/* Icon with animated background */}
        <div className="relative inline-block mb-4">
          <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl animate-pulse"></div>
          <div className="relative">
            {statusConfig.icon}
          </div>
        </div>

        {/* Title */}
        <h3 className={`text-2xl md:text-3xl font-bold ${statusConfig.color}`}>
          {statusConfig.title}
        </h3>

        {/* Description */}
        <p className="text-base md:text-lg text-muted-foreground max-w-lg mx-auto">
          {statusConfig.description}
        </p>

        {/* Verification Decision Badge */}
        {status === 'completed' && decisionDisplay && (
          <div className="flex justify-center">
            <span className={`px-4 py-2 rounded-full text-sm font-semibold ${decisionDisplay.bg} ${decisionDisplay.color}`}>
              {decisionDisplay.label}
            </span>
          </div>
        )}

        {/* Progress Bar */}
        {status !== 'failed' && (
          <div className="space-y-3 pt-2">
            <Progress value={progress} className="h-3 bg-muted" />
            <p className="text-sm font-medium text-muted-foreground">
              {progress}% complete
            </p>
          </div>
        )}

        {/* Validation Score Display (when completed) */}
        {status === 'completed' && validationScore !== null && (
          <div className="flex justify-center gap-6 pt-2">
            <div className="text-center">
              <div className={`text-3xl font-bold ${getScoreColor(validationScore)}`}>
                {Math.round(validationScore * 100)}%
              </div>
              <div className="text-sm text-muted-foreground">Validation Score</div>
              <div className={`text-xs font-medium ${getScoreColor(validationScore)}`}>
                {getScoreLabel(validationScore)}
              </div>
            </div>
            {confidenceScore !== null && (
              <div className="text-center">
                <div className={`text-3xl font-bold ${getScoreColor(confidenceScore)}`}>
                  {Math.round(confidenceScore * 100)}%
                </div>
                <div className="text-sm text-muted-foreground">Confidence</div>
              </div>
            )}
          </div>
        )}

        {/* Extracted Data Preview (if completed) */}
        {status === 'completed' && extractedData && (
          <div className="mt-6 p-6 bg-primary/5 border-2 border-primary/20 rounded-xl text-left">
            <p className="text-base font-bold mb-4 text-center text-primary">Extracted Information</p>
            <div className="space-y-3 text-sm md:text-base">
              {extractedData.provider && (
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Insurance Provider:</span>
                  <span className="font-semibold">{extractedData.provider}</span>
                </div>
              )}
              {extractedData.policyNumber && (
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Policy Number:</span>
                  <span className="font-semibold">{extractedData.policyNumber}</span>
                </div>
              )}
              {extractedData.policyHolderName && (
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Policy Holder:</span>
                  <span className="font-semibold">{extractedData.policyHolderName}</span>
                </div>
              )}
              {extractedData.coverageType && (
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Coverage Type:</span>
                  <span className="font-semibold">{extractedData.coverageType}</span>
                </div>
              )}
              {(effectiveDate || expirationDate) && (
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Coverage Period:</span>
                  <span className="font-semibold">
                    {formatDate(effectiveDate)} - {formatDate(expirationDate)}
                    {extractedData.isExpired && (
                      <span className="ml-2 text-red-600 text-xs font-bold">(EXPIRED)</span>
                    )}
                  </span>
                </div>
              )}
              {extractedData.documentType && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Document Type:</span>
                  <span className="font-semibold">{extractedData.documentType}</span>
                </div>
              )}
            </div>

            {/* Review Reasons (if any) */}
            {extractedData.reviewReasons && extractedData.reviewReasons.length > 0 && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm font-semibold text-yellow-800 mb-2">Review Notes:</p>
                <ul className="text-sm text-yellow-700 list-disc list-inside space-y-1">
                  {extractedData.reviewReasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Fraud Warning (if high risk) */}
            {extractedData.fraudRiskScore !== undefined && extractedData.fraudRiskScore >= 0.5 && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-semibold text-red-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Document flagged for additional verification
                </p>
              </div>
            )}
          </div>
        )}

        {/* Enhanced Loading Animation */}
        {(status === 'pending' || status === 'processing') && (
          <div className="flex items-center justify-center gap-3 pt-6">
            <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        )}
      </div>
    </div>
  );
}
