'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@drive247/ui';
import { bonzahApi } from '@/lib/api';

interface Props {
  policyId: string;
  dataId: number;
  label: string;
}

export function PdfDownloadButton({ policyId, dataId, label }: Props) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { data: res } = await bonzahApi.downloadPdf(policyId, dataId);
      if (!res.success) throw new Error('Download failed');

      // Decode base64 → blob → trigger browser download
      const byteChars = atob(res.data.contentBase64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: res.data.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.data.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'PDF download failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={loading}
    >
      {loading ? 'Downloading...' : label}
    </Button>
  );
}
