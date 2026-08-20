'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bell, BellOff, Share, PlusSquare, AlertCircle, Smartphone, Loader2 } from 'lucide-react';
import { usePushNotifications } from '@/hooks/use-push-notifications';

/**
 * Customer-facing control for lock-screen notifications.
 *
 * Deliberately renders NOTHING when the tenant has push switched off, so the
 * feature can roll out per operator without a code change.
 *
 * The iOS branch is not an edge case — it is the majority of the audience. On
 * iOS, push exists only inside a Home Screen install, so a plain "Enable"
 * button there does nothing and reads as broken. That path gets the install
 * steps instead of a dead control.
 */
export function PushNotificationCard() {
  const {
    isSupported,
    needsInstall,
    isEnabledForTenant,
    isSubscribed,
    isLoading,
    isBusy,
    error,
    permission,
    capability,
    enable,
    disable,
  } = usePushNotifications();

  const [justEnabled, setJustEnabled] = useState(false);

  if (!isEnabledForTenant) return null;

  const handleToggle = async (next: boolean) => {
    if (next) {
      const ok = await enable();
      if (ok) {
        setJustEnabled(true);
        setTimeout(() => setJustEnabled(false), 6000);
      }
    } else {
      await disable();
    }
  };

  // ---- iOS, not yet installed --------------------------------------------
  if (needsInstall) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="h-5 w-5" />
            Get notifications on your phone
          </CardTitle>
          <CardDescription>
            Add this app to your Home Screen and we can alert you about your bookings — even when
            the app is closed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">1</span>
              <span className="flex items-center gap-1.5 pt-0.5">
                Tap the Share button <Share className="h-4 w-4 shrink-0" /> in Safari&apos;s toolbar
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">2</span>
              <span className="flex items-center gap-1.5 pt-0.5">
                Choose <strong>Add to Home Screen</strong> <PlusSquare className="h-4 w-4 shrink-0" />
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">3</span>
              <span className="pt-0.5">Open the app from your Home Screen, then turn notifications on here</span>
            </li>
          </ol>
        </CardContent>
      </Card>
    );
  }

  // ---- Browser genuinely cannot do push -----------------------------------
  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BellOff className="h-5 w-5" />
            Push notifications
          </CardTitle>
          <CardDescription>
            This browser doesn&apos;t support push notifications. Try Chrome on Android, or Safari
            on iPhone after adding the app to your Home Screen.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isBlocked = permission === 'denied';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bell className="h-5 w-5" />
              Push notifications
              {isSubscribed && (
                <Badge variant="secondary" className="text-xs font-normal">On</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Booking confirmations, pickup reminders and payment updates — delivered to this device
              even when the app is closed.
            </CardDescription>
          </div>

          {isLoading ? (
            <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={isSubscribed}
              onCheckedChange={handleToggle}
              disabled={isBusy || isBlocked}
              aria-label="Toggle push notifications"
              className="mt-1 shrink-0"
            />
          )}
        </div>
      </CardHeader>

      {(error || isBlocked || justEnabled || (capability.platform === 'ios' && isSubscribed)) && (
        <CardContent className="space-y-3">
          {isBlocked && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Notifications are blocked for this site. Turn them back on in your browser settings,
                then reload this page.
              </AlertDescription>
            </Alert>
          )}

          {error && !isBlocked && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {justEnabled && (
            <Alert>
              <Bell className="h-4 w-4" />
              <AlertDescription>
                You&apos;re all set — this device will now receive notifications.
              </AlertDescription>
            </Alert>
          )}

          {/* Deleting the Home Screen icon silently destroys the subscription on
              iOS, with no event we can observe. Saying so up front is the only
              way the customer can connect the two later. */}
          {capability.platform === 'ios' && isSubscribed && (
            <p className="text-xs text-muted-foreground">
              Keep the app on your Home Screen — removing the icon turns notifications off.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
