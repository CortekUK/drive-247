'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  MessageCircle,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Phone,
  Unplug,
  Send,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useWhatsAppMeta } from '@/hooks/use-whatsapp-meta';

declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: any;
  }
}

export function WhatsAppMetaSettings() {
  const { config, status, isLoading, completeSignup, sendTest, disconnect } = useWhatsAppMeta();

  const [isConnecting, setIsConnecting] = useState(false);
  const [fbSdkLoaded, setFbSdkLoaded] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  // Session info from Embedded Signup callback
  const [sessionInfo, setSessionInfo] = useState<{ wabaId: string; phoneNumberId: string } | null>(null);

  // Load Facebook SDK
  useEffect(() => {
    if (!config?.appId || fbSdkLoaded) return;

    // Set up sessionInfoListener before loading SDK
    window.fbAsyncInit = () => {
      window.FB.init({
        appId: config.appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: 'v21.0',
      });
      setFbSdkLoaded(true);
    };

    // Check if SDK is already loaded
    if (window.FB) {
      window.FB.init({
        appId: config.appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: 'v21.0',
      });
      setFbSdkLoaded(true);
      return;
    }

    // Load SDK script
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    document.body.appendChild(script);

    return () => {
      // Cleanup not strictly necessary for SDK script
    };
  }, [config?.appId, fbSdkLoaded]);

  const handleConnect = useCallback(() => {
    if (!window.FB || !config?.configId) return;

    setIsConnecting(true);

    // Set up session info listener
    const sessionInfoListener = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;

      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH') {
            setSessionInfo({
              wabaId: data.data?.waba_id || '',
              phoneNumberId: data.data?.phone_number_id || '',
            });
          } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
            setIsConnecting(false);
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    window.addEventListener('message', sessionInfoListener);

    window.FB.login(
      (response: any) => {
        window.removeEventListener('message', sessionInfoListener);

        if (response.authResponse?.code) {
          // We have the code, now wait for sessionInfo or use what we got
          const code = response.authResponse.code;

          // Use a small delay to ensure sessionInfoListener has fired
          setTimeout(() => {
            setSessionInfo((info) => {
              if (info?.wabaId && info?.phoneNumberId) {
                completeSignup.mutate(
                  { code, wabaId: info.wabaId, phoneNumberId: info.phoneNumberId },
                  { onSettled: () => setIsConnecting(false) }
                );
              } else {
                setIsConnecting(false);
              }
              return null;
            });
          }, 500);
        } else {
          setIsConnecting(false);
        }
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          sessionInfoVersion: 2,
        },
      }
    );
  }, [config, completeSignup]);

  // Handle when sessionInfo arrives after FB.login callback
  useEffect(() => {
    // This effect is handled inline in handleConnect via setTimeout
  }, [sessionInfo]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageCircle className="h-5 w-5" />
            WhatsApp Business
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading WhatsApp configuration...
          </div>
        </CardContent>
      </Card>
    );
  }

  // Connected state
  if (status?.isConfigured) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageCircle className="h-5 w-5" />
                WhatsApp Business
              </CardTitle>
              <CardDescription>Send WhatsApp messages to customers</CardDescription>
            </div>
            <Badge variant="default" className="bg-green-600 hover:bg-green-600">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status info */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Phone Number:</span>
              <span className="font-medium">{status.phoneNumber}</span>
            </div>
            {status.wabaId && (
              <div className="flex items-center gap-2 text-sm">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">WABA ID:</span>
                <span className="font-mono text-xs">
                  {status.wabaId.substring(0, 8)}...{status.wabaId.slice(-4)}
                </span>
              </div>
            )}
          </div>

          {/* Test message */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Send Test Message</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Phone number (e.g. +447xxx)"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
              <Button
                onClick={() => sendTest.mutate(testPhone)}
                disabled={!testPhone || sendTest.isPending}
                size="sm"
              >
                {sendTest.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Disconnect */}
          <div className="pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDisconnectDialog(true)}
              className="text-red-600 hover:text-red-700"
            >
              <Unplug className="h-4 w-4 mr-2" />
              Disconnect WhatsApp
            </Button>
          </div>

          <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove your WhatsApp Business connection. WhatsApp notifications will stop being sent to customers.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    disconnect.mutate();
                    setShowDisconnectDialog(false);
                  }}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    );
  }

  // Not connected state
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageCircle className="h-5 w-5" />
              WhatsApp Business
            </CardTitle>
            <CardDescription>
              Connect your WhatsApp Business account to send collection confirmations and signing notifications to customers.
            </CardDescription>
          </div>
          <Badge variant="secondary">
            <AlertCircle className="h-3 w-3 mr-1" />
            Not Connected
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="rounded-lg border border-dashed p-6 text-center">
            <MessageCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Connect your WhatsApp Business account via Meta to start sending WhatsApp messages. You'll be guided through Meta's setup flow.
            </p>
            <Button
              onClick={handleConnect}
              disabled={isConnecting || !config?.configId || completeSignup.isPending}
            >
              {isConnecting || completeSignup.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Connecting...
                </>
              ) : (
                <>
                  <MessageCircle className="h-4 w-4 mr-2" />
                  Connect WhatsApp
                </>
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            You'll need a Meta Business Account and a phone number to register for WhatsApp Business. The setup takes about 2 minutes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
