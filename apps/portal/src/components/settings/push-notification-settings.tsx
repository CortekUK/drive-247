'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Bell, BellRing, Send, Smartphone, Monitor, AlertCircle, Loader2,
  Share, PlusSquare, CheckCircle2, XCircle, Users, UserCog,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { usePushNotifications, usePushLog, type SendPushInput } from '@/hooks/use-push-notifications';
import { useToast } from '@/hooks/use-toast';

interface Props {
  canEdit?: boolean;
}

const TARGET_LABELS: Record<SendPushInput['target'], string> = {
  self: 'Just my devices',
  staff: 'All staff devices',
  customers: 'All customer devices',
  all: 'Everyone (staff + customers)',
};

function platformIcon(platform: string) {
  return platform === 'desktop' ? Monitor : Smartphone;
}

export function PushNotificationSettings({ canEdit = true }: Props) {
  const {
    isSupported, needsInstall, isEnabledForTenant, isSubscribed, isLoading, isBusy,
    error, permission, capability, enable, disable,
    staffDevices, customerDevices, devicesLoading, sendPush,
  } = usePushNotifications();
  const { data: log } = usePushLog(10);
  const { toast } = useToast();

  const [target, setTarget] = useState<SendPushInput['target']>('self');
  const [title, setTitle] = useState('Test notification');
  const [body, setBody] = useState('If you can see this on your lock screen, push notifications are working.');
  const [url, setUrl] = useState('/');

  // The feature is per-tenant. Showing the screen to an operator who cannot use
  // it would just generate support questions.
  if (!isEnabledForTenant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Push notifications
          </CardTitle>
          <CardDescription>
            Push notifications are not enabled for this account yet. Contact Drive247 support to
            switch them on.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const handleToggle = async (next: boolean) => {
    const ok = next ? await enable() : await disable();
    if (ok) {
      toast({
        title: next ? 'Notifications enabled' : 'Notifications turned off',
        description: next
          ? 'This device will now receive push notifications.'
          : 'This device will no longer receive push notifications.',
      });
    }
  };

  const handleSend = async () => {
    if (!title.trim()) {
      toast({ title: 'A title is required', variant: 'destructive' });
      return;
    }
    try {
      const result = await sendPush.mutateAsync({
        target,
        title: title.trim(),
        body: body.trim() || undefined,
        url: url.trim() || undefined,
      });

      if (result.sent === 0) {
        // A zero-send is NOT an error — it almost always means no device is
        // enrolled yet, and reporting it as a failure sends the operator hunting
        // for a bug that isn't there.
        toast({
          title: 'Nothing to send to',
          description: result.message ?? 'No devices are enrolled for that target yet.',
        });
        return;
      }

      toast({
        title: `Sent to ${result.sent} device${result.sent === 1 ? '' : 's'}`,
        description: [
          result.failed ? `${result.failed} failed` : null,
          result.expired ? `${result.expired} expired and were removed` : null,
        ].filter(Boolean).join(' · ') || 'Check your lock screen.',
      });
    } catch (err) {
      toast({
        title: 'Could not send',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const isBlocked = permission === 'denied';
  const totalDevices = staffDevices.length + customerDevices.length;

  return (
    <div className="space-y-6">
      {/* ---- This device --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <BellRing className="h-5 w-5" />
                Notifications on this device
                {isSubscribed && <Badge variant="secondary" className="font-normal">Enabled</Badge>}
              </CardTitle>
              <CardDescription>
                Receive alerts on this device even when the portal is closed.
              </CardDescription>
            </div>
            {isLoading ? (
              <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : isSupported ? (
              <Switch
                checked={isSubscribed}
                onCheckedChange={handleToggle}
                disabled={isBusy || isBlocked || !canEdit}
                aria-label="Toggle push notifications on this device"
                className="mt-1 shrink-0"
              />
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* iOS is the majority of phones and push there exists ONLY inside a
              Home Screen install — a bare "Enable" switch would do nothing and
              read as broken, so that path gets the install steps instead. */}
          {needsInstall && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Smartphone className="h-4 w-4" />
                On iPhone or iPad, add the portal to your Home Screen first
              </p>
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-xs">1</span>
                  Tap Share <Share className="h-3.5 w-3.5" /> in Safari
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-xs">2</span>
                  Choose <strong className="text-foreground">Add to Home Screen</strong> <PlusSquare className="h-3.5 w-3.5" />
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-xs">3</span>
                  Open it from the Home Screen and come back to this page
                </li>
              </ol>
            </div>
          )}

          {!isSupported && !needsInstall && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This browser doesn&apos;t support push notifications. Try Chrome or Edge on desktop
                or Android, or Safari on iOS after installing to the Home Screen.
              </AlertDescription>
            </Alert>
          )}

          {isBlocked && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Notifications are blocked for this site in your browser. Re-enable them in your
                browser&apos;s site settings, then reload this page.
              </AlertDescription>
            </Alert>
          )}

          {error && !isBlocked && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Enrolled device counts, split by audience — customer devices are on
              a different origin entirely, so they can never be enrolled here. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserCog className="h-4 w-4" /> Staff devices
              </div>
              <p className="mt-1 text-2xl font-semibold">
                {devicesLoading ? '—' : staffDevices.length}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" /> Customer devices
              </div>
              <p className="mt-1 text-2xl font-semibold">
                {devicesLoading ? '—' : customerDevices.length}
              </p>
            </div>
          </div>

          {staffDevices.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                {staffDevices.slice(0, 5).map((device) => {
                  const Icon = platformIcon(device.platform);
                  return (
                    <div key={device.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="capitalize">{device.platform}</span>
                        {device.is_standalone && (
                          <Badge variant="outline" className="text-[10px] font-normal">Installed</Badge>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {device.last_success_at
                          ? `last received ${formatDistanceToNow(new Date(device.last_success_at), { addSuffix: true })}`
                          : 'no messages yet'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Send ---------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send a notification
          </CardTitle>
          <CardDescription>
            Send a push notification now. Start with &ldquo;Just my devices&rdquo; to check it works
            before sending to anyone else.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="push-target">Send to</Label>
            <Select
              value={target}
              onValueChange={(v) => setTarget(v as SendPushInput['target'])}
              disabled={!canEdit}
            >
              <SelectTrigger id="push-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TARGET_LABELS) as SendPushInput['target'][]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {TARGET_LABELS[key]}
                    {key === 'staff' && staffDevices.length > 0 && ` (${staffDevices.length})`}
                    {key === 'customers' && customerDevices.length > 0 && ` (${customerDevices.length})`}
                    {key === 'all' && totalDevices > 0 && ` (${totalDevices})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="push-title">Title</Label>
            <Input
              id="push-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="Your rental starts tomorrow"
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="push-body">Message</Label>
            <Textarea
              id="push-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="Pickup at 10:00 from Downtown Garage."
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">{body.length}/300</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="push-url">Opens this page when tapped</Label>
            <Input
              id="push-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/rentals"
              disabled={!canEdit}
            />
          </div>

          {/* Sending to customers is a different order of consequence from a
              self-test, so the button says who it is about to reach. */}
          {target !== 'self' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This will reach <strong>{TARGET_LABELS[target].toLowerCase()}</strong>
                {target === 'customers' && customerDevices.length > 0 && ` — ${customerDevices.length} customer device${customerDevices.length === 1 ? '' : 's'}`}
                . Notifications cannot be recalled once sent.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleSend}
            disabled={sendPush.isPending || !canEdit || !title.trim()}
            className="w-full sm:w-auto"
          >
            {sendPush.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
            ) : (
              <><Send className="mr-2 h-4 w-4" /> Send notification</>
            )}
          </Button>

          {!isSubscribed && target === 'self' && (
            <p className="text-xs text-muted-foreground">
              Turn notifications on for this device above, or nothing will arrive.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Delivery history ---------------------------------------------- */}
      {log && log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent sends</CardTitle>
            <CardDescription>
              Push services confirm delivery to the device, not that it was read.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {log.map((entry: any) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0">
                <div className="flex min-w-0 items-start gap-2">
                  {entry.status === 'sent' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{entry.title}</p>
                    {entry.error && (
                      <p className="truncate text-xs text-destructive">{entry.error}</p>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
