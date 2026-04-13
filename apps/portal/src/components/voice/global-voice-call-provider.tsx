'use client';

import { useEffect, useState, useRef } from 'react';
import { useVoiceCall } from '@/hooks/use-voice-call';
import { VoiceCallBar } from '@/components/chat/VoiceCallBar';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

/**
 * GlobalVoiceCallProvider
 *
 * Mounted at the dashboard layout level so the Twilio Device is always
 * registered for inbound calls, regardless of which page the user is on.
 * Renders the VoiceCallBar overlay globally. Looks up customer name from
 * the incoming phone number. Shows browser notification when tab is not focused.
 */
export function GlobalVoiceCallProvider() {
  const voiceCall = useVoiceCall();
  const { tenant } = useTenant();
  const [callerName, setCallerName] = useState<string | null>(null);
  const notificationRef = useRef<Notification | null>(null);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Look up customer name when an incoming call arrives
  useEffect(() => {
    if (!voiceCall.incomingCall?.from || !tenant?.id) {
      setCallerName(null);
      return;
    }

    const phone = voiceCall.incomingCall.from;
    const normalized = (phone.startsWith('+') ? phone : `+${phone}`).replace(/[^+\d]/g, '');
    const digitsOnly = normalized.replace('+', '');

    async function lookupCustomer() {
      // Try exact match first
      const { data: customers } = await supabase
        .from('customers')
        .select('name')
        .eq('tenant_id', tenant!.id)
        .or(`phone.eq.${normalized},phone.eq.${digitsOnly},phone.eq.${phone}`)
        .limit(1);

      if (customers?.length) {
        setCallerName(customers[0].name);
        return;
      }

      // Fuzzy match — check if stored phone ends with the digits
      const { data: allCustomers } = await supabase
        .from('customers')
        .select('name, phone')
        .eq('tenant_id', tenant!.id)
        .not('phone', 'is', null);

      if (allCustomers?.length) {
        const match = allCustomers.find((c) => {
          if (!c.phone) return false;
          const stored = c.phone.replace(/[^+\d]/g, '');
          return stored === normalized || stored.endsWith(digitsOnly) || digitsOnly.endsWith(stored.replace('+', ''));
        });
        if (match) {
          setCallerName(match.name);
          return;
        }
      }

      setCallerName(null);
    }

    lookupCustomer();
  }, [voiceCall.incomingCall?.from, tenant?.id]);

  // Show browser notification for incoming calls (works when tab is not focused)
  useEffect(() => {
    if (voiceCall.incomingCall && voiceCall.status === 'idle') {
      // Show desktop notification
      if ('Notification' in window && Notification.permission === 'granted') {
        const callerDisplay = callerName || voiceCall.incomingCall.from || 'Unknown';
        notificationRef.current = new Notification('Incoming Call', {
          body: callerDisplay,
          icon: '/favicon.ico',
          tag: 'incoming-call',
          requireInteraction: true,
        });

        // Click notification to focus the tab
        notificationRef.current.onclick = () => {
          window.focus();
          notificationRef.current?.close();
        };
      }

      // Update page title to flash
      const originalTitle = document.title;
      let flashInterval: ReturnType<typeof setInterval> | null = null;
      let showingAlert = false;

      flashInterval = setInterval(() => {
        showingAlert = !showingAlert;
        document.title = showingAlert ? '📞 Incoming Call!' : originalTitle;
      }, 1000);

      return () => {
        if (flashInterval) clearInterval(flashInterval);
        document.title = originalTitle;
        notificationRef.current?.close();
        notificationRef.current = null;
      };
    }
  }, [voiceCall.incomingCall, voiceCall.status, callerName]);

  return (
    <VoiceCallBar
      status={voiceCall.status}
      duration={voiceCall.duration}
      isMuted={voiceCall.isMuted}
      isOnHold={voiceCall.isOnHold}
      callerNumber={voiceCall.callerNumber || voiceCall.incomingCall?.from || null}
      callerName={callerName}
      incomingCall={voiceCall.incomingCall}
      onEndCall={voiceCall.endCall}
      onToggleMute={voiceCall.toggleMute}
      onToggleHold={voiceCall.toggleHold}
      onAcceptCall={voiceCall.acceptCall}
      onRejectCall={voiceCall.rejectCall}
    />
  );
}
