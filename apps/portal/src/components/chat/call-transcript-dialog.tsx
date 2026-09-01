'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Copy,
  Download,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  PhoneIncoming,
  PhoneOutgoing,
  FileText,
  ListChecks,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface CallTranscriptDialogProps {
  callSid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CallTranscriptData {
  direction: string;
  duration_seconds: number;
  transcript: string | null;
  ai_summary: string | null;
  ai_action_items: string[] | null;
  from_number: string | null;
  to_number: string | null;
  created_at: string;
}

export function CallTranscriptDialog({ callSid, open, onOpenChange }: CallTranscriptDialogProps) {
  const [data, setData] = useState<CallTranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !callSid) return;

    async function fetchTranscript() {
      setLoading(true);
      const { data: callLog } = await (supabase as any)
        .from('call_logs')
        .select('direction, duration_seconds, transcript, ai_summary, ai_action_items, from_number, to_number, created_at')
        .eq('twilio_call_sid', callSid)
        .single();

      setData(callLog || null);
      setLoading(false);
    }

    fetchTranscript();
  }, [open, callSid]);

  const handleCopy = async () => {
    if (!data) return;
    const text = [
      `Call Summary`,
      `Direction: ${data.direction === 'inbound' ? 'Inbound' : 'Outbound'}`,
      `Duration: ${Math.floor((data.duration_seconds || 0) / 60)}m ${(data.duration_seconds || 0) % 60}s`,
      '',
      '--- Summary ---',
      data.ai_summary || 'No summary available',
      '',
      '--- Action Items ---',
      ...(data.ai_action_items || []).map((item, i) => `${i + 1}. ${item}`),
      '',
      '--- Full Transcript ---',
      data.transcript || 'No transcript available',
    ].join('\n');

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copied to clipboard' });
  };

  const handleExport = () => {
    if (!data) return;
    const text = [
      `CALL TRANSCRIPT`,
      `${'='.repeat(50)}`,
      `Direction: ${data.direction === 'inbound' ? 'Inbound' : 'Outbound'}`,
      `Duration: ${Math.floor((data.duration_seconds || 0) / 60)}m ${(data.duration_seconds || 0) % 60}s`,
      `From: ${data.from_number || 'Unknown'}`,
      `To: ${data.to_number || 'Unknown'}`,
      `Date: ${data.created_at ? new Date(data.created_at).toLocaleString() : 'Unknown'}`,
      '',
      `SUMMARY`,
      `${'-'.repeat(50)}`,
      data.ai_summary || 'No summary available',
      '',
      `ACTION ITEMS`,
      `${'-'.repeat(50)}`,
      ...(data.ai_action_items || []).map((item, i) => `${i + 1}. ${item}`),
      '',
      `FULL TRANSCRIPT`,
      `${'-'.repeat(50)}`,
      data.transcript || 'No transcript available',
    ].join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-transcript-${callSid.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isInbound = data?.direction === 'inbound';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden">
        {/* Gradient header */}
        <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-4">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Call Summary
            </DialogTitle>
          </DialogHeader>
          {data && (
            <div className="flex items-center gap-3 mt-2 text-white/80 text-sm">
              <div className="flex items-center gap-1.5">
                {isInbound ? <PhoneIncoming className="h-3.5 w-3.5" /> : <PhoneOutgoing className="h-3.5 w-3.5" />}
                <span>{isInbound ? 'Inbound' : 'Outbound'}</span>
              </div>
              <span>-</span>
              <span>{Math.floor((data.duration_seconds || 0) / 60)}m {(data.duration_seconds || 0) % 60}s</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-6 text-center text-muted-foreground">Loading transcript...</div>
        ) : !data?.ai_summary ? (
          <div className="p-6 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <p>AI summary is being generated...</p>
            <p className="text-xs mt-1">This usually takes 30-60 seconds after the call ends.</p>
          </div>
        ) : (
          <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
            {/* Summary section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-indigo-500" />
                <h3 className="text-sm font-semibold">Summary</h3>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed bg-indigo-500/5 border border-indigo-500/15 rounded-lg p-3">
                {data.ai_summary}
              </p>
            </div>

            {/* Action items */}
            {data.ai_action_items && data.ai_action_items.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ListChecks className="h-4 w-4 text-violet-500" />
                  <h3 className="text-sm font-semibold">Action Items</h3>
                </div>
                <ul className="space-y-2">
                  {data.ai_action_items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm bg-violet-500/5 border border-violet-500/15 rounded-lg p-2.5">
                      <CheckCircle2 className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Full transcript (collapsible) */}
            {data.transcript && (
              <div>
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="flex items-center gap-2 text-sm font-semibold hover:text-indigo-500 transition-colors w-full"
                >
                  <FileText className="h-4 w-4" />
                  Full Transcript
                  {showTranscript ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                </button>
                {showTranscript && (
                  <div className="mt-2 bg-muted/50 border rounded-lg p-3 max-h-[200px] overflow-y-auto">
                    <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                      {data.transcript}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        {data?.ai_summary && (
          <div className="border-t px-6 py-3 flex items-center justify-end gap-2 bg-muted/30">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <CheckCircle2 className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1.5" />
              Export
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
