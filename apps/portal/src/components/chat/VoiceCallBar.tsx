'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Mic,
  MicOff,
  Pause,
  Play,
  User,
} from 'lucide-react';
import type { CallStatus } from '@/hooks/use-voice-call';

interface VoiceCallBarProps {
  status: CallStatus;
  duration: number;
  isMuted: boolean;
  isOnHold: boolean;
  callerNumber: string | null;
  callerName?: string | null;
  incomingCall: { from: string } | null;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onAcceptCall: () => void;
  onRejectCall: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatPhoneNumber(phone: string): string {
  // Basic formatting for display
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+44') && cleaned.length === 13) {
    return `+44 ${cleaned.slice(3, 7)} ${cleaned.slice(7)}`;
  }
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    return `+1 (${cleaned.slice(2, 5)}) ${cleaned.slice(5, 8)}-${cleaned.slice(8)}`;
  }
  return phone;
}

export function VoiceCallBar({
  status,
  duration,
  isMuted,
  isOnHold,
  callerNumber,
  callerName,
  incomingCall,
  onEndCall,
  onToggleMute,
  onToggleHold,
  onAcceptCall,
  onRejectCall,
}: VoiceCallBarProps) {
  const [fadeOut, setFadeOut] = useState(false);
  const [visible, setVisible] = useState(false);

  const displayName = callerName || null;
  const displayNumber = callerNumber ? formatPhoneNumber(callerNumber) : 'Unknown';
  const incomingNumber = incomingCall?.from ? formatPhoneNumber(incomingCall.from) : 'Unknown';

  // Control visibility and fade-out for the "ended" state
  useEffect(() => {
    if (status === 'ended') {
      setVisible(true);
      setFadeOut(false);
      const fadeTimer = setTimeout(() => setFadeOut(true), 2000);
      const hideTimer = setTimeout(() => setVisible(false), 3000);
      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(hideTimer);
      };
    } else if (status !== 'idle') {
      setVisible(true);
      setFadeOut(false);
    } else if (!incomingCall) {
      setVisible(false);
      setFadeOut(false);
    }
  }, [status, incomingCall]);

  // Show incoming call dialog
  useEffect(() => {
    if (incomingCall && status === 'idle') {
      setVisible(true);
      setFadeOut(false);
    }
  }, [incomingCall, status]);

  if (!visible && !incomingCall) return null;

  // ─── Incoming call dialog ───
  if (incomingCall && status === 'idle') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="w-[340px] rounded-2xl bg-card border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
          {/* Header */}
          <div className="bg-green-600 px-6 py-4 text-center">
            <div className="flex items-center justify-center gap-2 text-green-100 text-sm mb-1">
              <PhoneIncoming className="h-4 w-4" />
              <span>Incoming Call</span>
            </div>
          </div>

          {/* Caller info */}
          <div className="px-6 pt-6 pb-4 text-center">
            <div className="relative mx-auto mb-4">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-green-400/20 animate-ping" />
              </div>
              <div className="relative w-20 h-20 mx-auto rounded-full bg-muted flex items-center justify-center">
                <User className="h-10 w-10 text-muted-foreground" />
              </div>
            </div>
            {callerName ? (
              <>
                <p className="text-xl font-semibold text-foreground">{callerName}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{incomingNumber}</p>
              </>
            ) : (
              <p className="text-xl font-semibold text-foreground">{incomingNumber}</p>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              Ringing...
            </p>
          </div>

          {/* Action buttons */}
          <div className="px-6 pb-6 flex items-center justify-center gap-6">
            <button
              onClick={onRejectCall}
              className="flex flex-col items-center gap-1.5 group"
            >
              <div className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors shadow-lg group-active:scale-95">
                <Phone className="h-6 w-6 text-white rotate-[135deg]" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Decline</span>
            </button>
            <button
              onClick={onAcceptCall}
              className="flex flex-col items-center gap-1.5 group"
            >
              <div className="w-14 h-14 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center transition-colors shadow-lg group-active:scale-95 animate-pulse">
                <Phone className="h-6 w-6 text-white" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Accept</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Connecting / Ringing dialog ───
  if (status === 'connecting' || status === 'ringing') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="w-[340px] rounded-2xl bg-card border shadow-2xl overflow-hidden">
          <div className="bg-amber-600 px-6 py-4 text-center">
            <p className="text-amber-100 text-sm">Calling</p>
          </div>

          <div className="px-6 pt-6 pb-4 text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-muted flex items-center justify-center mb-4">
              <User className="h-10 w-10 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              {displayName || displayNumber}
            </p>
            {displayName && (
              <p className="text-sm text-muted-foreground mt-0.5">{displayNumber}</p>
            )}
            <p className="text-sm text-amber-600 mt-2 flex items-center justify-center gap-1">
              Ringing
              <span className="inline-flex gap-0.5">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
              </span>
            </p>
          </div>

          <div className="px-6 pb-6 flex justify-center">
            <button onClick={onEndCall} className="flex flex-col items-center gap-1.5 group">
              <div className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors shadow-lg group-active:scale-95">
                <Phone className="h-6 w-6 text-white rotate-[135deg]" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">End</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Connected dialog ───
  if (status === 'connected') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="w-[340px] rounded-2xl bg-card border shadow-2xl overflow-hidden">
          <div className="bg-green-600 px-6 py-3 text-center">
            <p className="text-green-100 text-sm">Connected</p>
          </div>

          <div className="px-6 pt-6 pb-4 text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <User className="h-10 w-10 text-green-600" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              {displayName || displayNumber}
            </p>
            {displayName && (
              <p className="text-sm text-muted-foreground mt-0.5">{displayNumber}</p>
            )}
            <p className="text-2xl font-mono tabular-nums text-foreground mt-3">
              {formatDuration(duration)}
            </p>
          </div>

          {/* Controls */}
          <div className="px-6 pb-6 flex items-center justify-center gap-5">
            <button onClick={onToggleMute} className="flex flex-col items-center gap-1.5 group">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors shadow group-active:scale-95 ${
                isMuted
                  ? 'bg-red-100 text-red-600 dark:bg-red-900/30'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}>
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </div>
              <span className="text-[11px] text-muted-foreground">{isMuted ? 'Unmute' : 'Mute'}</span>
            </button>

            <button onClick={onEndCall} className="flex flex-col items-center gap-1.5 group">
              <div className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors shadow-lg group-active:scale-95">
                <Phone className="h-6 w-6 text-white rotate-[135deg]" />
              </div>
              <span className="text-[11px] text-muted-foreground">End</span>
            </button>

            <button onClick={onToggleHold} className="flex flex-col items-center gap-1.5 group">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors shadow group-active:scale-95 ${
                isOnHold
                  ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}>
                {isOnHold ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
              </div>
              <span className="text-[11px] text-muted-foreground">{isOnHold ? 'Resume' : 'Hold'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Ended state (brief display before fade-out) ───
  if (status === 'ended' && visible) {
    return (
      <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity duration-1000 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}>
        <div className="w-[340px] rounded-2xl bg-card border shadow-2xl overflow-hidden">
          <div className="px-6 py-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center mb-4">
              <PhoneOff className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold text-foreground">Call Ended</p>
            <p className="text-sm text-muted-foreground font-mono tabular-nums mt-1">
              {formatDuration(duration)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default VoiceCallBar;
