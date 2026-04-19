'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@drive247/ui';
import {
  RequiredDocumentType,
  type IdVerificationResponse,
  type IdVerificationSettingsResponse,
} from '@drive247/shared-types';
import { idVerificationApi } from '@/lib/api';
import { StartVerificationDialog } from './start-verification-dialog';
import { VerificationStatusBadge } from './verification-status-badge';

interface Props {
  customerId: string;
}

/**
 * Embedded inside the customer detail page — shows latest verification,
 * history, and "Start Verification" button. Invisible for tenants that
 * haven't enabled ID verification in settings.
 */
export function IdentityVerificationTab({ customerId }: Props) {
  const [settings, setSettings] = useState<IdVerificationSettingsResponse | null>(null);
  const [items, setItems] = useState<IdVerificationResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [settingsRes, listRes] = await Promise.all([
        idVerificationApi.getSettings(),
        idVerificationApi.list({ customerId, limit: 20 }),
      ]);
      if (settingsRes.data.success) setSettings(settingsRes.data.data);
      if (listRes.data.success) setItems(listRes.data.data.items);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to load verifications');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (!settings?.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity verification</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            ID verification is not enabled for your tenant.{' '}
            <Link
              href="/settings/id-verification"
              className="text-[#6366f1] hover:underline"
            >
              Enable in settings
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Identity verification</CardTitle>
        <StartVerificationDialog
          customerId={customerId}
          defaultDocumentType={
            settings.requiredDocumentType as RequiredDocumentType
          }
          onCompleted={fetchAll}
        />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No verifications yet. Start one to send the customer a QR code.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Decided</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <VerificationStatusBadge status={v.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {v.requiredDocumentType.replace('_', ' ')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {v.decidedAt
                      ? new Date(v.decidedAt).toLocaleString()
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/verifications/${v.id}`}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
