'use client';

import type { OcrResultSummary } from '@drive247/shared-types';
import { Card, CardContent, CardHeader, CardTitle } from '@drive247/ui';

interface Props {
  ocr: OcrResultSummary | null;
}

/**
 * Read-only display of OCR-extracted fields. Staff cannot edit these — the
 * source of truth is the document itself. Corrections happen via retry +
 * re-capture.
 */
export function OcrDataPanel({ ocr }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Extracted document data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!ocr ? (
          <p className="text-muted-foreground">
            OCR has not completed yet, or the document could not be read.
          </p>
        ) : (
          <>
            <Row label="First name" value={ocr.firstName} />
            <Row label="Last name" value={ocr.lastName} />
            <Row label="Date of birth" value={ocr.dateOfBirth} />
            <Row label="Document number" value={ocr.documentNumber} />
            <Row label="Document type" value={ocr.documentDetectedType} />
            <Row label="Country" value={ocr.documentCountry} />
            <Row label="Expiry" value={ocr.documentExpiryDate} />
            <Row
              label="OCR confidence"
              value={
                ocr.confidence !== null
                  ? `${(ocr.confidence * 100).toFixed(1)}%`
                  : null
              }
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? '—'}</span>
    </div>
  );
}
