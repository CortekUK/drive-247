'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@drive247/ui';
import {
  IdVerificationStatus,
  type IdVerificationResponse,
} from '@drive247/shared-types';
import { idVerificationApi } from '@/lib/api';
import { VerificationStatusBadge } from '@/components/id-verification/verification-status-badge';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: IdVerificationStatus.REVIEW_REQUIRED, label: 'Review required' },
  { value: IdVerificationStatus.PROCESSING, label: 'Processing' },
  { value: IdVerificationStatus.APPROVED, label: 'Approved' },
  { value: IdVerificationStatus.REJECTED, label: 'Rejected' },
  { value: IdVerificationStatus.INITIATED, label: 'Initiated' },
  { value: IdVerificationStatus.IN_PROGRESS, label: 'In progress' },
  { value: IdVerificationStatus.EXPIRED, label: 'Expired' },
  { value: IdVerificationStatus.CANCELLED, label: 'Cancelled' },
];

export default function VerificationsPage() {
  const [items, setItems] = useState<IdVerificationResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [total, setTotal] = useState(0);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data: res } = await idVerificationApi.list({
        status:
          statusFilter === 'all'
            ? undefined
            : (statusFilter as IdVerificationStatus),
        limit: 50,
      });
      if (res.success) {
        setItems(res.data.items);
        setTotal(res.data.total);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[30px] font-medium text-[#080812]">
          ID Verifications
        </h2>
        <p className="text-sm text-muted-foreground">
          All customer identity verifications across the tenant.
        </p>
      </div>

      <Card>
        <CardContent className="py-4 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={fetchItems}>
              Refresh
            </Button>
            <span className="ml-auto text-sm text-muted-foreground">
              {total} verifications
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No verifications.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Face match</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Decided</TableHead>
                  <TableHead></TableHead>
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
                    <TableCell className="text-sm">
                      {v.faceMatch?.score !== null &&
                      v.faceMatch?.score !== undefined
                        ? `${v.faceMatch.score.toFixed(1)}%`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {v.decidedAt
                        ? new Date(v.decidedAt).toLocaleDateString()
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
    </div>
  );
}
