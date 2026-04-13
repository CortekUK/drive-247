'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTwilioVoice } from '@/hooks/use-twilio-voice';

export type CallStatus = 'idle' | 'connecting' | 'ringing' | 'connected' | 'ended';

interface IncomingCallInfo {
  from: string;
  callInstance: any; // Twilio Call object
}

export interface VoiceCallState {
  status: CallStatus;
  duration: number;
  isMuted: boolean;
  isOnHold: boolean;
  activeCall: any | null;
  incomingCall: IncomingCallInfo | null;
  callerNumber: string | null;
}

export function useVoiceCall() {
  const { getToken, status: voiceStatus } = useTwilioVoice();
  const deviceRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [callState, setCallState] = useState<VoiceCallState>({
    status: 'idle',
    duration: 0,
    isMuted: false,
    isOnHold: false,
    activeCall: null,
    incomingCall: null,
    callerNumber: null,
  });

  // Start the call duration timer
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setCallState((prev) => ({
        ...prev,
        duration: Math.floor((Date.now() - startTime) / 1000),
      }));
    }, 1000);
  }, []);

  // Stop the call duration timer
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Attach event listeners to a Twilio Call object
  const attachCallListeners = useCallback(
    (call: any) => {
      call.on('accept', () => {
        setCallState((prev) => ({ ...prev, status: 'connected' }));
        startTimer();
      });

      call.on('ringing', () => {
        setCallState((prev) => ({ ...prev, status: 'ringing' }));
      });

      call.on('disconnect', () => {
        stopTimer();
        setCallState((prev) => ({
          ...prev,
          status: 'ended',
          activeCall: null,
          isMuted: false,
          isOnHold: false,
        }));
        // Auto-reset to idle after 3 seconds
        setTimeout(() => {
          setCallState((prev) =>
            prev.status === 'ended'
              ? { ...prev, status: 'idle', duration: 0, callerNumber: null }
              : prev
          );
        }, 3000);
      });

      call.on('cancel', () => {
        stopTimer();
        setCallState((prev) => ({
          ...prev,
          status: 'idle',
          activeCall: null,
          incomingCall: null,
          duration: 0,
          callerNumber: null,
          isMuted: false,
          isOnHold: false,
        }));
      });

      call.on('error', (error: any) => {
        console.error('[VoiceCall] Call error:', error);
        stopTimer();
        setCallState((prev) => ({
          ...prev,
          status: 'ended',
          activeCall: null,
          isMuted: false,
          isOnHold: false,
        }));
        setTimeout(() => {
          setCallState((prev) =>
            prev.status === 'ended'
              ? { ...prev, status: 'idle', duration: 0, callerNumber: null }
              : prev
          );
        }, 3000);
      });
    },
    [startTimer, stopTimer]
  );

  // Initialize the Twilio Device with a fresh token
  const initializeDevice = useCallback(async () => {
    try {
      const result = await getToken.mutateAsync();
      const token = result?.token;
      if (!token) {
        console.error('[VoiceCall] No token received');
        return null;
      }

      // Dynamically import the Twilio Voice SDK (client-side only)
      const { Device } = await import('@twilio/voice-sdk');

      // Destroy existing device if any
      if (deviceRef.current) {
        deviceRef.current.destroy();
      }

      const device = new Device(token, {
        edge: 'ashburn',
        closeProtection: true,
      });

      // Handle incoming calls
      device.on('incoming', (call: any) => {
        const from = call.parameters?.From || 'Unknown';
        setCallState((prev) => ({
          ...prev,
          incomingCall: { from, callInstance: call },
        }));
      });

      device.on('error', (error: any) => {
        console.error('[VoiceCall] Device error:', error);
      });

      device.on('tokenWillExpire', async () => {
        // Auto-refresh the token before it expires
        try {
          const refreshResult = await getToken.mutateAsync();
          if (refreshResult?.token) {
            device.updateToken(refreshResult.token);
          }
        } catch (err) {
          console.error('[VoiceCall] Failed to refresh token:', err);
        }
      });

      await device.register();
      deviceRef.current = device;

      // Schedule a token refresh before the default 1-hour expiry
      // Refresh at 50 minutes to be safe
      if (tokenExpiryRef.current) clearTimeout(tokenExpiryRef.current);
      tokenExpiryRef.current = setTimeout(async () => {
        try {
          const refreshResult = await getToken.mutateAsync();
          if (refreshResult?.token && deviceRef.current) {
            deviceRef.current.updateToken(refreshResult.token);
          }
        } catch (err) {
          console.error('[VoiceCall] Scheduled token refresh failed:', err);
        }
      }, 50 * 60 * 1000);

      return device;
    } catch (err) {
      console.error('[VoiceCall] Failed to initialize device:', err);
      return null;
    }
  }, [getToken]);

  // Make an outbound call
  const makeCall = useCallback(
    async (phoneNumber: string) => {
      if (callState.status !== 'idle') return;

      setCallState((prev) => ({
        ...prev,
        status: 'connecting',
        duration: 0,
        callerNumber: phoneNumber,
        isMuted: false,
        isOnHold: false,
      }));

      try {
        let device = deviceRef.current;
        if (!device) {
          device = await initializeDevice();
        }
        if (!device) {
          setCallState((prev) => ({
            ...prev,
            status: 'idle',
            callerNumber: null,
          }));
          return;
        }

        const call = await device.connect({
          params: { To: phoneNumber },
        });

        setCallState((prev) => ({
          ...prev,
          activeCall: call,
        }));

        attachCallListeners(call);
      } catch (err) {
        console.error('[VoiceCall] makeCall error:', err);
        setCallState((prev) => ({
          ...prev,
          status: 'idle',
          callerNumber: null,
        }));
      }
    },
    [callState.status, initializeDevice, attachCallListeners]
  );

  // End the active call
  const endCall = useCallback(() => {
    if (callState.activeCall) {
      callState.activeCall.disconnect();
    }
  }, [callState.activeCall]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (!callState.activeCall) return;
    const newMuted = !callState.isMuted;
    callState.activeCall.mute(newMuted);
    setCallState((prev) => ({ ...prev, isMuted: newMuted }));
  }, [callState.activeCall, callState.isMuted]);

  // Toggle hold (mute + sendDigits to trigger server-side hold, or just mute locally)
  const toggleHold = useCallback(() => {
    if (!callState.activeCall) return;
    const newHold = !callState.isOnHold;
    // Hold is implemented as a mute on the client side
    // For server-side hold, you'd need to update the call via the REST API
    callState.activeCall.mute(newHold);
    setCallState((prev) => ({
      ...prev,
      isOnHold: newHold,
      isMuted: newHold ? true : prev.isMuted,
    }));
  }, [callState.activeCall, callState.isOnHold]);

  // Accept an incoming call
  const acceptCall = useCallback(() => {
    if (!callState.incomingCall) return;
    const call = callState.incomingCall.callInstance;
    call.accept();

    setCallState((prev) => ({
      ...prev,
      status: 'connecting',
      activeCall: call,
      callerNumber: prev.incomingCall?.from || null,
      incomingCall: null,
      duration: 0,
      isMuted: false,
      isOnHold: false,
    }));

    attachCallListeners(call);
  }, [callState.incomingCall, attachCallListeners]);

  // Reject an incoming call
  const rejectCall = useCallback(() => {
    if (!callState.incomingCall) return;
    callState.incomingCall.callInstance.reject();
    setCallState((prev) => ({
      ...prev,
      incomingCall: null,
    }));
  }, [callState.incomingCall]);

  // Auto-initialize device when voice is enabled so we can receive inbound calls
  const deviceInitializedRef = useRef(false);

  useEffect(() => {
    if (voiceStatus?.isEnabled && !deviceRef.current && !deviceInitializedRef.current) {
      deviceInitializedRef.current = true;
      console.log('[VoiceCall] Auto-initializing device for inbound calls');
      initializeDevice().then((device) => {
        if (device) {
          console.log('[VoiceCall] Device registered and ready for inbound calls');
        } else {
          // Reset so it can retry
          deviceInitializedRef.current = false;
        }
      });
    }
  }, [voiceStatus?.isEnabled, initializeDevice]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      if (tokenExpiryRef.current) clearTimeout(tokenExpiryRef.current);
      if (deviceRef.current) {
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
    };
  }, [stopTimer]);

  return {
    ...callState,
    makeCall,
    endCall,
    toggleMute,
    toggleHold,
    acceptCall,
    rejectCall,
    initializeDevice,
    isDeviceReady: !!deviceRef.current,
  };
}
