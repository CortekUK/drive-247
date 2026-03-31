'use client';

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, AlertCircle, FileCheck, AlertTriangle, Shield, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AIScanProgressProps {
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
  startDate?: string;
  endDate?: string;
}

export function AIScanProgress({ documentId }: AIScanProgressProps) {
  const [status, setStatus] = useState<ScanStatus>('pending');
  const [progress, setProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [validationScore, setValidationScore] = useState<number | null>(null);
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);

  useEffect(() => {
    fetchStatus();
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

      if (error || !data) return;

      setStatus(data.ai_scan_status as ScanStatus);
      setExtractedData(data.ai_extracted_data as ExtractedData);
      setValidationScore(data.ai_validation_score);
      setConfidenceScore(data.ai_confidence_score);

      if (data.ai_scan_status === 'pending') setProgress(10);
      else if (data.ai_scan_status === 'processing') setProgress(50);
      else if (data.ai_scan_status === 'completed') setProgress(100);
      else if (data.ai_scan_status === 'failed') setProgress(0);
    } catch (error) {
      console.error('Error fetching scan status:', error);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.85) return 'text-green-600';
    if (score >= 0.60) return 'text-amber-600';
    return 'text-red-600';
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const effectiveDate = extractedData?.effectiveDate || extractedData?.startDate;
  const expirationDate = extractedData?.expirationDate || extractedData?.endDate;

  // Pending / Processing
  if (status === 'pending' || status === 'processing') {
    return (
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-3 mb-3">
          {status === 'pending' ? (
            <FileCheck className="h-5 w-5 text-primary animate-pulse flex-shrink-0" />
          ) : (
            <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
          )}
          <div>
            <p className="text-sm font-medium">
              {status === 'pending' ? 'Preparing Document...' : 'AI Verification in Progress...'}
            </p>
            <p className="text-xs text-muted-foreground">
              {status === 'pending' ? 'Getting ready to verify the insurance certificate' : 'Analyzing document with AI verification'}
            </p>
          </div>
        </div>
        <Progress value={progress} className="h-2" />
        <div className="flex items-center justify-center gap-2 mt-3">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  // Failed
  if (status === 'failed') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-4">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-400">Verification Failed</p>
            <p className="text-xs text-red-600 dark:text-red-400/80">
              Unable to verify document. You can still proceed — try re-uploading a clearer copy if needed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Completed
  const decision = extractedData?.verificationDecision;
  const isApproved = decision === 'auto_approved';
  const isRejected = decision === 'auto_rejected';
  const needsReview = extractedData?.needsManualReview || decision === 'pending_review';

  const borderColor = isApproved
    ? 'border-green-200 dark:border-green-800'
    : isRejected
    ? 'border-red-200 dark:border-red-800'
    : 'border-amber-200 dark:border-amber-800';

  const bgColor = isApproved
    ? 'bg-green-50 dark:bg-green-950/20'
    : isRejected
    ? 'bg-red-50 dark:bg-red-950/20'
    : 'bg-amber-50 dark:bg-amber-950/20';

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-4 space-y-3`}>
      {/* Header with decision */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isApproved ? (
            <ShieldCheck className="h-5 w-5 text-green-600 flex-shrink-0" />
          ) : isRejected ? (
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
          )}
          <p className="text-sm font-medium">
            {isApproved ? 'Insurance Verified' : isRejected ? 'Insurance Rejected' : 'Review Required'}
          </p>
        </div>
        <Badge
          variant="secondary"
          className={
            isApproved
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : isRejected
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          }
        >
          {isApproved ? 'Auto-Approved' : isRejected ? 'Rejected' : 'Pending Review'}
        </Badge>
      </div>

      {/* Scores */}
      {validationScore !== null && (
        <div className="flex gap-4 text-xs">
          <div>
            <span className="text-muted-foreground">Validation: </span>
            <span className={`font-semibold ${getScoreColor(validationScore)}`}>
              {Math.round(validationScore * 100)}%
            </span>
          </div>
          {confidenceScore !== null && (
            <div>
              <span className="text-muted-foreground">Confidence: </span>
              <span className={`font-semibold ${getScoreColor(confidenceScore)}`}>
                {Math.round(confidenceScore * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Extracted data grid */}
      {extractedData && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs border-t pt-3">
          {extractedData.provider && (
            <div>
              <span className="text-muted-foreground">Provider: </span>
              <span className="font-medium">{extractedData.provider}</span>
            </div>
          )}
          {extractedData.policyNumber && (
            <div>
              <span className="text-muted-foreground">Policy #: </span>
              <span className="font-medium">{extractedData.policyNumber}</span>
            </div>
          )}
          {extractedData.policyHolderName && (
            <div>
              <span className="text-muted-foreground">Holder: </span>
              <span className="font-medium">{extractedData.policyHolderName}</span>
            </div>
          )}
          {extractedData.coverageType && (
            <div>
              <span className="text-muted-foreground">Coverage: </span>
              <span className="font-medium">{extractedData.coverageType}</span>
            </div>
          )}
          {(effectiveDate || expirationDate) && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Period: </span>
              <span className="font-medium">
                {formatDate(effectiveDate)} — {formatDate(expirationDate)}
              </span>
              {extractedData.isExpired && (
                <span className="ml-1.5 text-red-600 font-bold">(EXPIRED)</span>
              )}
            </div>
          )}
          {extractedData.documentType && (
            <div>
              <span className="text-muted-foreground">Doc Type: </span>
              <span className="font-medium">{extractedData.documentType}</span>
            </div>
          )}
        </div>
      )}

      {/* Review reasons */}
      {extractedData?.reviewReasons && extractedData.reviewReasons.length > 0 && (
        <div className="rounded-md bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-2.5">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-1">Review Notes:</p>
          <ul className="text-xs text-amber-700 dark:text-amber-400/80 list-disc list-inside space-y-0.5">
            {extractedData.reviewReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Fraud warning */}
      {extractedData?.fraudRiskScore !== undefined && extractedData.fraudRiskScore >= 0.5 && (
        <div className="rounded-md bg-red-100/50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-2.5">
          <p className="text-xs font-semibold text-red-800 dark:text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Document flagged for additional verification
          </p>
        </div>
      )}
    </div>
  );
}
