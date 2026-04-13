'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  PhoneForwarded,
  Voicemail,
  Phone,
  Save,
  Loader2,
  CheckCircle2,
  User,
  Sparkles,
  Mic,
} from 'lucide-react';
import { useTwilioVoice, type ForwardingUser } from '@/hooks/use-twilio-voice';

function ForwardingNumberRow({
  user,
  onSave,
  isSaving,
}: {
  user: ForwardingUser;
  onSave: (userId: string, number: string | null) => void;
  isSaving: boolean;
}) {
  const [number, setNumber] = useState(user.forwardingNumber || '');
  const [dirty, setDirty] = useState(false);

  const handleChange = (val: string) => {
    setNumber(val);
    setDirty(val !== (user.forwardingNumber || ''));
  };

  const handleSave = () => {
    onSave(user.id, number.trim() || null);
    setDirty(false);
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-background">
      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
        <User className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{user.name || 'Unnamed User'}</p>
        <p className="text-xs text-muted-foreground capitalize">{user.role.replace('_', ' ')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="tel"
          placeholder="+44 7700 900123"
          value={number}
          onChange={(e) => handleChange(e.target.value)}
          className="w-[180px] h-8 text-sm"
        />
        {dirty && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={isSaving}
            className="h-8 px-2"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          </Button>
        )}
        {!dirty && user.forwardingNumber && (
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        )}
      </div>
    </div>
  );
}

export function CallForwardingSettings() {
  const {
    status,
    updateForwarding,
    setForwardingNumber,
  } = useTwilioVoice();

  const [tenantNumber, setTenantNumber] = useState('');
  const [tenantNumberDirty, setTenantNumberDirty] = useState(false);

  // Sync tenant forwarding number from server
  const serverTenantNumber = status?.forwardingNumber || '';
  if (!tenantNumberDirty && tenantNumber !== serverTenantNumber) {
    setTenantNumber(serverTenantNumber);
  }

  if (!status?.isEnabled) return null;

  const handleToggleForwarding = (enabled: boolean) => {
    updateForwarding.mutate({ callForwardingEnabled: enabled });
  };

  const handleToggleVoicemail = (enabled: boolean) => {
    updateForwarding.mutate({ voicemailEnabled: enabled });
  };

  const handleSaveNumber = (userId: string, number: string | null) => {
    setForwardingNumber.mutate({ userId, forwardingNumber: number });
  };

  const usersWithNumbers = status.forwardingUsers.filter((u) => u.forwardingNumber);

  return (
    <div className="space-y-4 mt-4">
      {/* Call Forwarding Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PhoneForwarded className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base">Call Forwarding</CardTitle>
              {status.callForwardingEnabled && (
                <Badge className="bg-green-600 hover:bg-green-700 text-xs">Active</Badge>
              )}
            </div>
            <Switch
              checked={status.callForwardingEnabled}
              onCheckedChange={handleToggleForwarding}
              disabled={updateForwarding.isPending}
            />
          </div>
          <CardDescription>
            Forward inbound calls to team members' personal phones. Calls will ring in the browser and on their phone simultaneously.
          </CardDescription>
        </CardHeader>
        {status.callForwardingEnabled && (
          <CardContent className="space-y-4 pt-0">
            {/* Main forwarding number */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Main Forwarding Number</Label>
              <p className="text-xs text-muted-foreground">
                Your primary phone number for receiving forwarded calls. Perfect if you're a solo operator or want a main fallback number.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="tel"
                  placeholder="+44 7700 900123"
                  value={tenantNumber}
                  onChange={(e) => {
                    setTenantNumber(e.target.value);
                    setTenantNumberDirty(true);
                  }}
                  className="flex-1"
                />
                {tenantNumberDirty && (
                  <Button
                    size="sm"
                    onClick={() => {
                      updateForwarding.mutate(
                        { forwardingNumber: tenantNumber.trim() || null },
                        {
                          onSuccess: () => setTenantNumberDirty(false),
                        }
                      );
                    }}
                    disabled={updateForwarding.isPending}
                  >
                    {updateForwarding.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <><Save className="h-4 w-4 mr-1" /> Save</>
                    )}
                  </Button>
                )}
                {!tenantNumberDirty && status.forwardingNumber && (
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                )}
              </div>
            </div>

            {/* Team forwarding numbers removed — use main forwarding number only */}

            <p className="text-xs text-muted-foreground">
              When a customer calls, their call will ring on both the browser and all configured phone numbers at the same time. The first person to answer gets connected.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Voicemail Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Voicemail className="h-5 w-5 text-purple-600" />
              <CardTitle className="text-base">Voicemail</CardTitle>
              {status.voicemailEnabled && (
                <Badge className="bg-green-600 hover:bg-green-700 text-xs">Active</Badge>
              )}
            </div>
            <Switch
              checked={status.voicemailEnabled}
              onCheckedChange={handleToggleVoicemail}
              disabled={updateForwarding.isPending}
            />
          </div>
          <CardDescription>
            When no one answers an inbound call, the caller can leave a voicemail. Recordings appear in the customer's conversation thread.
          </CardDescription>
        </CardHeader>
        {status.voicemailEnabled && (
          <CardContent className="space-y-3 pt-0">
            <div className="p-4 rounded-lg border bg-muted/50">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0 dark:bg-purple-900/30">
                  <Phone className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Default Greeting</p>
                  <p className="text-xs text-muted-foreground">
                    "You've reached [your business name]. No one is available right now. Please leave a message after the beep."
                  </p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Voicemails are limited to 2 minutes. They'll appear as messages in the customer's chat thread with an audio player.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Call Recording + AI Transcript Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-indigo-600" />
              <CardTitle className="text-base">Call Recording & AI Transcript</CardTitle>
              {status.callRecordingEnabled && (
                <Badge className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-xs border-0">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Active
                </Badge>
              )}
            </div>
            <Switch
              checked={status.callRecordingEnabled}
              onCheckedChange={(enabled) => updateForwarding.mutate({ callRecordingEnabled: enabled })}
              disabled={updateForwarding.isPending}
            />
          </div>
          <CardDescription>
            Record calls and automatically generate AI-powered transcripts, summaries, and action items. A consent notice plays before each call.
          </CardDescription>
        </CardHeader>
        {status.callRecordingEnabled && (
          <CardContent className="space-y-3 pt-0">
            <div className="p-4 rounded-lg border bg-gradient-to-r from-indigo-500/5 via-violet-500/5 to-fuchsia-500/5 border-indigo-500/20">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">How it works</p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>"This call may be recorded" plays before connecting</li>
                    <li>Both sides of the call are recorded</li>
                    <li>AI transcribes and generates a summary with action items</li>
                    <li>Results appear in the customer's conversation thread</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
