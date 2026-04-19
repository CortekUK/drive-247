'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
} from '@drive247/ui';
import api from '@/lib/api';

interface TaxSettings {
  taxRate: string;
  taxLabel: string;
  taxInclusive: boolean;
}

export default function TaxSettingsPage() {
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [taxRate, setTaxRate] = useState('0');
  const [taxLabel, setTaxLabel] = useState('Tax');
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetch = async () => {
    try {
      const { data } = await api.get<{ success: boolean; data: TaxSettings }>(
        '/tenant-settings/tax',
      );
      if (data.success) {
        setSettings(data.data);
        setTaxRate(String(Number(data.data.taxRate)));
        setTaxLabel(data.data.taxLabel);
        setTaxInclusive(data.data.taxInclusive);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load tax settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.patch('/tenant-settings/tax', {
        taxRate: Number(taxRate),
        taxLabel: taxLabel.trim(),
        taxInclusive,
      });
      toast.success('Tax settings saved');
      fetch();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href="/" className="text-sm text-[#6366f1] hover:underline">
          ← Dashboard
        </Link>
        <h2 className="text-[30px] font-medium text-[#080812] mt-1">
          Tax Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          These apply to <strong>new invoices only</strong>. Existing invoices
          keep the rate they were created with.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="taxRate">Tax rate (%)</Label>
                <Input
                  id="taxRate"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxLabel">Label</Label>
                <Input
                  id="taxLabel"
                  value={taxLabel}
                  onChange={(e) => setTaxLabel(e.target.value)}
                  required
                  maxLength={30}
                  placeholder="VAT / GST / Tax"
                  className="bg-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="taxInclusive"
                type="checkbox"
                checked={taxInclusive}
                onChange={(e) => setTaxInclusive(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="taxInclusive" className="cursor-pointer">
                Prices are <strong>inclusive</strong> of tax
              </Label>
            </div>
            <p className="text-xs text-muted-foreground ml-7">
              {taxInclusive
                ? 'Line item prices already include tax. Customer pays the listed price.'
                : 'Line item prices are pre-tax. Tax is added on top.'}
            </p>

            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {settings && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Current applied settings (as returned by the server):{' '}
            <strong>{settings.taxLabel}</strong>{' '}
            at <strong>{Number(settings.taxRate)}%</strong>,{' '}
            {settings.taxInclusive ? 'inclusive' : 'exclusive'}.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
