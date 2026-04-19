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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@drive247/ui';
import {
  RequiredDocumentType,
  REQUIRED_DOCUMENT_TYPE_LABELS,
  type IdVerificationSettingsResponse,
} from '@drive247/shared-types';
import { idVerificationApi } from '@/lib/api';

export default function IdVerificationSettingsPage() {
  const [settings, setSettings] = useState<IdVerificationSettingsResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // form state (strings so the inputs don't fight null/number)
  const [enabled, setEnabled] = useState(false);
  const [docType, setDocType] = useState<RequiredDocumentType>(
    RequiredDocumentType.DRIVING_LICENSE,
  );
  const [autoApprove, setAutoApprove] = useState<string>('');
  const [review, setReview] = useState<string>('');
  const [minOcr, setMinOcr] = useState<string>('');

  const fetchSettings = async () => {
    try {
      const { data: res } = await idVerificationApi.getSettings();
      if (res.success) {
        setSettings(res.data);
        setEnabled(res.data.enabled);
        setDocType(res.data.requiredDocumentType as RequiredDocumentType);
        setAutoApprove(
          res.data.faceMatchAutoApprovePct !== null
            ? String(res.data.faceMatchAutoApprovePct)
            : '',
        );
        setReview(
          res.data.faceMatchReviewPct !== null
            ? String(res.data.faceMatchReviewPct)
            : '',
        );
        setMinOcr(
          res.data.minOcrConfidence !== null
            ? String(res.data.minOcrConfidence)
            : '',
        );
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    const parsed = {
      autoApprove: autoApprove.trim() === '' ? null : Number(autoApprove),
      review: review.trim() === '' ? null : Number(review),
      minOcr: minOcr.trim() === '' ? null : Number(minOcr),
    };
    if (parsed.autoApprove !== null && !isValidPct(parsed.autoApprove)) {
      toast.error('Auto-approve must be between 0 and 100');
      return;
    }
    if (parsed.review !== null && !isValidPct(parsed.review)) {
      toast.error('Review floor must be between 0 and 100');
      return;
    }
    if (
      parsed.minOcr !== null &&
      (parsed.minOcr < 0 || parsed.minOcr > 1)
    ) {
      toast.error('Min OCR confidence must be between 0 and 1');
      return;
    }

    setSaving(true);
    try {
      const { data: res } = await idVerificationApi.updateSettings({
        enabled,
        requiredDocumentType: docType,
        faceMatchAutoApprovePct: parsed.autoApprove,
        faceMatchReviewPct: parsed.review,
        minOcrConfidence: parsed.minOcr,
      });
      if (res.success) {
        setSettings(res.data);
        toast.success('Settings saved');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-[30px] font-medium text-[#080812]">
          ID Verification Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure how ID verifications run for your tenant.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enabled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              id="enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="enabled">
              Allow staff to start verifications for customers
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Required document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="doc-type">
            Default document type for new sessions
          </Label>
          <Select
            value={docType}
            onValueChange={(v) => setDocType(v as RequiredDocumentType)}
          >
            <SelectTrigger id="doc-type" className="w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(REQUIRED_DOCUMENT_TYPE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Leave any threshold blank to use the platform default.
          </p>
          <Separator />
          <ThresholdRow
            label="Face match auto-approve (%)"
            placeholder={`Default: ${settings.effectiveFaceMatchAutoApprovePct}`}
            value={autoApprove}
            onChange={setAutoApprove}
            hint="At or above this score → verification is auto-approved"
          />
          <ThresholdRow
            label="Face match review floor (%)"
            placeholder={`Default: ${settings.effectiveFaceMatchReviewPct}`}
            value={review}
            onChange={setReview}
            hint="Below this score → auto-rejected. Between floor and auto-approve → review required."
          />
          <ThresholdRow
            label="Min OCR confidence (0–1)"
            placeholder={`Default: ${settings.effectiveMinOcrConfidence}`}
            value={minOcr}
            onChange={setMinOcr}
            hint="OCR confidence below this marks the verification for review regardless of face score"
          />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </div>
    </div>
  );
}

function ThresholdRow({
  label,
  placeholder,
  value,
  onChange,
  hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <div className="grid grid-cols-[280px_1fr] gap-4 items-start">
      <div>
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </div>
      <Input
        type="number"
        step="0.1"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-40"
      />
    </div>
  );
}

function isValidPct(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 100;
}
