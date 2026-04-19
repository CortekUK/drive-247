'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@drive247/ui';
import { bonzahApi } from '@/lib/api';

export function AlertConfigForm() {
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState<string>('100');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data: res } = await bonzahApi.getAlertConfig();
      if (res.success) {
        setEnabled(res.data.enabled);
        setThreshold(String(res.data.threshold ?? 100));
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load alert config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await bonzahApi.updateAlertConfig({
        enabled,
        threshold: Number(threshold),
      });
      toast.success('Alert config updated');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading alert config...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Low Balance Alert</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <input
            id="alert-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <Label htmlFor="alert-enabled" className="cursor-pointer">
            Alert me when balance drops below threshold
          </Label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="alert-threshold">Threshold (USD)</Label>
          <Input
            id="alert-threshold"
            type="number"
            step="0.01"
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            disabled={!enabled}
            className="bg-white max-w-xs"
          />
          <p className="text-xs text-muted-foreground">
            At ≤50% of threshold the alert escalates to critical. A reminder is created in the
            Reminders list — not an email (emails deferred to Phase 2).
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  );
}
