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
} from '@drive247/ui';
import type { BonzahConnectionStatus } from '@drive247/shared-types';
import { bonzahApi } from '@/lib/api';

interface Props {
  connection: BonzahConnectionStatus;
  onChanged: () => void;
}

export function BrochureUrlForm({ connection, onChanged }: Props) {
  const [url, setUrl] = useState(connection.brochureUrl ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await bonzahApi.updateSettings({
        brochureUrl: url.trim() || null,
      });
      toast.success('Brochure URL updated');
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
        <CardTitle className="text-base">Coverage Brochure URL</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="brochure-url">Link shown to customers at checkout</Label>
          <Input
            id="brochure-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="bg-white"
          />
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  );
}
