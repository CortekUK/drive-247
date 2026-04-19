'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@drive247/ui';
import { BonzahMode } from '@drive247/shared-types';
import type { BonzahConnectionStatus } from '@drive247/shared-types';
import { bonzahApi } from '@/lib/api';

interface Props {
  connection: BonzahConnectionStatus;
  onChanged: () => void;
}

export function CredentialsForm({ connection, onChanged }: Props) {
  const [mode, setMode] = useState<BonzahMode>(connection.mode);
  const [username, setUsername] = useState(
    connection.mode === BonzahMode.LIVE ? connection.username ?? '' : '',
  );
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);

  const isLive = mode === BonzahMode.LIVE;

  const handleVerify = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error('Enter both username and password to verify');
      return;
    }
    setVerifying(true);
    try {
      const { data: res } = await bonzahApi.verifyCredentials({
        username: username.trim(),
        password,
        mode,
      });
      if (res.success && res.data.valid) {
        toast.success(`Verified: ${res.data.email || username}`);
      } else {
        toast.error(res.data?.error || 'Verification failed');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { mode };
      if (username.trim()) payload.username = username.trim();
      if (password) payload.password = password;

      await bonzahApi.updateSettings(payload as never);
      toast.success('Bonzah settings saved');
      setPassword('');
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Credentials</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Mode</Label>
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as BonzahMode)}
          >
            <SelectTrigger className="bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BonzahMode.TEST}>
                Test (uses platform sandbox)
              </SelectItem>
              <SelectItem value={BonzahMode.LIVE}>Live (your own Bonzah account)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!isLive && (
          <p className="text-xs text-muted-foreground">
            In test mode, your tenant uses Drive247&apos;s shared sandbox credentials.
            No action needed. Switch to Live when you have your own Bonzah account.
          </p>
        )}

        {isLive && (
          <>
            <div className="space-y-2">
              <Label htmlFor="bonzah-user">Bonzah email</Label>
              <Input
                id="bonzah-user"
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="you@example.com"
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bonzah-pwd">Bonzah password</Label>
              <Input
                id="bonzah-pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  connection.connected && !password
                    ? 'Leave blank to keep existing'
                    : 'Enter password'
                }
                className="bg-white"
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted at rest (AES-256-GCM). Never returned in any API response.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleVerify}
                disabled={verifying}
              >
                {verifying ? 'Verifying...' : 'Verify only'}
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Saving in Live mode triggers a verify-before-persist — invalid credentials are rejected.
            </p>
          </>
        )}

        {!isLive && (
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save mode'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
