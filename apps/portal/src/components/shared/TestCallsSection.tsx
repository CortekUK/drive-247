"use client";

// DevPanel "Test Call Forwarding" section.
//
// Tests the forwarded-call experience end to end: does the staff member's phone show
// the BUSINESS line as caller ID, and does it announce the CALLER NAME (via the
// twilio-voice-whisper leg). Two modes:
//   • Preview   — renders the EXACT TwiML twilio-voice-inbound would return for a
//                 simulated inbound call. No real call, no charges, no phone rings.
//   • Test call — places a REAL, billed call on the tenant's own Twilio account so the
//                 forwarding phone actually rings and plays the whisper announcement.
//
// Renders only inside DevPanel (NODE_ENV==='development'). The heavy lifting is in the
// role-gated manage-twilio-voice edge function (preview-forward-call / test-forward-call).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  ChevronDown,
  ChevronRight,
  Loader2,
  Eye,
  PhoneCall,
} from "lucide-react";
import { useTwilioVoice } from "@/hooks/use-twilio-voice";

export function TestCallsSection({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { status, previewForwardCall, testForwardCall } = useTwilioVoice();

  const [callerName, setCallerName] = useState("Test Customer");
  const [fromNumber, setFromNumber] = useState("+15551234567");
  const [ringNumber, setRingNumber] = useState("");
  const [twiml, setTwiml] = useState<string | null>(null);

  const forwardingNumber = status?.forwardingNumber ?? null;
  const effectiveRing = ringNumber.trim() || forwardingNumber || "";
  const isBusinessLine = status?.forwardingCallerIdMode === "business_line";

  const handlePreview = async () => {
    setTwiml(null);
    try {
      const res: any = await previewForwardCall.mutateAsync({
        fromNumber: fromNumber.trim() || undefined,
        callerName: callerName.trim() || undefined,
      });
      setTwiml(res?.twiml ?? "(no TwiML returned)");
    } catch {
      /* toast handled in the hook */
    }
  };

  const handleTestCall = async () => {
    if (!effectiveRing) return;
    const ok = window.confirm(
      `Place a REAL, billed call to ${effectiveRing}?\n\n` +
        `Your phone will ring showing your business number, and you'll hear ` +
        `"Business call from ${callerName.trim() || "Test Customer"}". ` +
        `This uses your own Twilio account and costs a normal call charge.`
    );
    if (!ok) return;
    try {
      await testForwardCall.mutateAsync({
        forwardingNumber: effectiveRing,
        callerName: callerName.trim() || undefined,
        confirm: true,
      });
    } catch {
      /* toast handled in the hook */
    }
  };

  const inputCls =
    "w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-orange-500";

  return (
    <div className="border border-border rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
      >
        <span className="flex items-center gap-2">
          <Phone className="h-3.5 w-3.5 text-orange-500" /> Test Call Forwarding
        </span>
        <span className="flex items-center gap-2">
          <Badge variant="outline" className="border-orange-500/50 text-orange-500 text-[10px]">
            TWILIO
          </Badge>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Checks the forwarded-call experience: does the phone show the{" "}
            <strong>business line</strong> and announce the <strong>caller name</strong>.{" "}
            <em>Preview</em> renders the exact TwiML (no ring). <em>Test call</em> rings your
            real phone via the tenant&apos;s Twilio account.
          </p>

          {/* Live status */}
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[10px] space-y-0.5">
            <div>
              Voice:{" "}
              <strong className={status?.isEnabled ? "text-green-600" : "text-red-500"}>
                {status?.isEnabled ? "enabled" : "disabled"}
              </strong>{" "}
              · Forwarding:{" "}
              <strong className={status?.callForwardingEnabled ? "text-green-600" : "text-amber-600"}>
                {status?.callForwardingEnabled ? "on" : "off"}
              </strong>
            </div>
            <div>
              Caller ID mode: <strong>{status?.forwardingCallerIdMode ?? "—"}</strong>
            </div>
            <div>
              Forwarding number: <strong>{forwardingNumber ?? "(none set)"}</strong>
            </div>
            {!isBusinessLine && (
              <div className="text-amber-600">
                ⚠ Name announcement only runs in <code>business_line</code> caller-ID mode.
              </div>
            )}
            {!status?.callForwardingEnabled && (
              <div className="text-amber-600">
                ⚠ Forwarding is off — preview will not show phone legs.
              </div>
            )}
          </div>

          {/* Inputs */}
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Caller name to announce</label>
            <input
              className={inputCls}
              value={callerName}
              onChange={(e) => setCallerName(e.target.value)}
              placeholder="Test Customer"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">
              Simulated customer number (preview)
            </label>
            <input
              className={inputCls}
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
              placeholder="+15551234567"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Ring this number (test call)</label>
            <input
              className={inputCls}
              value={ringNumber}
              onChange={(e) => setRingNumber(e.target.value)}
              placeholder={forwardingNumber ?? "+44..."}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-7"
            onClick={handlePreview}
            disabled={previewForwardCall.isPending || !status?.isEnabled}
          >
            {previewForwardCall.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Eye className="w-3 h-3 mr-1 text-orange-500" />
            )}
            Preview TwiML
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-7 border-orange-500/40"
            onClick={handleTestCall}
            disabled={testForwardCall.isPending || !status?.isEnabled || !effectiveRing}
          >
            {testForwardCall.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <PhoneCall className="w-3 h-3 mr-1 text-orange-500" />
            )}
            Place real test call{effectiveRing ? ` → ${effectiveRing}` : ""}
          </Button>

          {twiml && (
            <pre className="mt-1 max-h-52 overflow-auto rounded-md border border-border bg-background p-2 text-[10px] leading-snug whitespace-pre-wrap break-all">
              {twiml}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
