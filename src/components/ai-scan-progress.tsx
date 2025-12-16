'use client';

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, AlertCircle, FileCheck, Shield } from "lucide-react";

interface Props {
  documentId: string;
}

type ScanStatus = 'pending' | 'processing' | 'completed' | 'failed';

export default function AIScanProgress({ documentId }: Props) {
  const [status, setStatus] = useState<ScanStatus>('pending');
  const [progress, setProgress] = useState(0);
  const [extractedData, setExtractedData] = useState<any>(null);

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
        .select('ai_scan_status, ai_extracted_data, ai_scan_errors')
        .eq('id', documentId)
        .single();

      if (error) {
        console.error('Error fetching scan status:', error);
        return;
      }

      if (data) {
        setStatus(data.ai_scan_status as ScanStatus);
        setExtractedData(data.ai_extracted_data);

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

  const getStatusConfig = () => {
    switch (status) {
      case 'pending':
        return {
          icon: <FileCheck className="h-16 w-16 mx-auto text-primary animate-pulse" />,
          title: 'Preparing Document...',
          description: 'Getting ready to review your insurance certificate',
          color: 'text-primary'
        };
      case 'processing':
        return {
          icon: <Loader2 className="h-16 w-16 mx-auto text-primary animate-spin" />,
          title: 'Reviewing Insurance Document...',
          description: 'Our team is verifying your policy details',
          color: 'text-primary'
        };
      case 'completed':
        return {
          icon: <CheckCircle className="h-16 w-16 mx-auto text-primary" />,
          title: 'Review Complete!',
          description: extractedData
            ? `Policy verified: ${extractedData.provider || 'Insurance provider'} - ${extractedData.policyNumber || 'Policy number detected'}`
            : 'Your insurance document has been verified successfully',
          color: 'text-primary'
        };
      case 'failed':
        return {
          icon: <AlertCircle className="h-16 w-16 mx-auto text-destructive" />,
          title: 'Review Completed with Warnings',
          description: 'We couldn\'t automatically verify all details, but you can proceed. Our team will review manually.',
          color: 'text-destructive'
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

        {/* Progress Bar */}
        {status !== 'failed' && (
          <div className="space-y-3 pt-2">
            <Progress value={progress} className="h-3 bg-muted" />
            <p className="text-sm font-medium text-muted-foreground">
              {progress}% complete
            </p>
          </div>
        )}

        {/* Extracted Data Preview (if completed) */}
        {status === 'completed' && extractedData && (
          <div className="mt-8 p-6 bg-primary/5 border-2 border-primary/20 rounded-xl text-left">
            <p className="text-base font-bold mb-4 text-center text-primary">Verified Details</p>
            <div className="space-y-3 text-sm md:text-base">
              {extractedData.provider && (
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Provider:</span>
                  <span className="font-semibold">{extractedData.provider}</span>
                </div>
              )}
              {extractedData.policyNumber && (
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Policy #:</span>
                  <span className="font-semibold">{extractedData.policyNumber}</span>
                </div>
              )}
              {extractedData.startDate && extractedData.endDate && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Coverage:</span>
                  <span className="font-semibold">
                    {new Date(extractedData.startDate).toLocaleDateString()} - {new Date(extractedData.endDate).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
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
