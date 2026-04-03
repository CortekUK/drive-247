'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Pause,
  Play,
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

  const displayName = callerName || callerNumber || 'Unknown';
  const incomingDisplayName = incomingCall?.from || 'Unknown';

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

  // Show incoming call bar
  useEffect(() => {
    if (incomingCall && status === 'idle') {
      setVisible(true);
      setFadeOut(false);
    }
  }, [incomingCall, status]);

  if (!visible && !incomingCall) return null;

  // Incoming call state
  if (incomingCall && status === 'idle') {
    return (
      <div className="mx-3 mt-3 rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-3 animate-in slide-in-from-top-2 duration-300">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex items-center justify-center">
              <div className="absolute w-10 h-10 rounded-full bg-green-400/30 animate-ping" />
              <div className="relative w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                <Phone className="h-5 w-5 text-green-600" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-green-800 dark:text-green-300 truncate">
                Incoming call
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 truncate">
                {incomingDisplayName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white h-9 px-4"
              onClick={onAcceptCall}
            >
              <Phone className="h-4 w-4 mr-1.5" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-9 px-4"
              onClick={onRejectCall}
            >
              <PhoneOff className="h-4 w-4 mr-1.5" />
              Decline
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Connecting / Ringing state
  if (status === 'connecting' || status === 'ringing') {
    return (
      <div className="mx-3 mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 animate-in slide-in-from-top-2 duration-300">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
              <Phone className="h-5 w-5 text-amber-600 animate-pulse" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300 truncate">
                Calling{' '}
                <span className="inline-flex gap-0.5">
                  <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                </span>
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 truncate">
                {displayName}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="destructive"
            className="h-9 px-4 shrink-0"
            onClick={onEndCall}
          >
            <PhoneOff className="h-4 w-4 mr-1.5" />
            End
          </Button>
        </div>
      </div>
    );
  }

  // Connected state
  if (status === 'connected') {
    return (
      <div className="mx-3 mt-3 rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-3 animate-in slide-in-from-top-2 duration-300">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
              <Phone className="h-5 w-5 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-green-800 dark:text-green-300 truncate">
                {displayName}
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 font-mono tabular-nums">
                {formatDuration(duration)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className={`h-9 w-9 rounded-full ${
                isMuted
                  ? 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
                  : 'text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/50'
              }`}
              onClick={onToggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className={`h-9 w-9 rounded-full ${
                isOnHold
                  ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/50'
              }`}
              onClick={onToggleHold}
              title={isOnHold ? 'Resume' : 'Hold'}
            >
              {isOnHold ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="destructive"
              className="h-9 w-9 rounded-full"
              onClick={onEndCall}
              title="End call"
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Ended state (brief display before fade-out)
  if (status === 'ended' && visible) {
    return (
      <div
        className={`mx-3 mt-3 rounded-lg border border-border bg-muted/50 p-3 transition-opacity duration-1000 ${
          fadeOut ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <PhoneOff className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Call ended</p>
            <p className="text-xs text-muted-foreground font-mono tabular-nums">
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
