'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Input,
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
import { invoicesApi } from '@/lib/api';
import type { InvoiceListItem } from '@drive247/shared-types';
import { formatCents } from '@/lib/money';
import { InvoiceStatusBadge } from '@/components/invoices/invoice-status-badge';

const STATUS_ALL = 'all';

export default function InvoicesPage() {
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(STATUS_ALL);

  const fetchInvoices = async () => {
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (status !== STATUS_ALL) params.status = status;
      const { data: res } = await invoicesApi.list(params as never);
      if (res.success) setItems(res.data.items);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(fetchInvoices, 250);
    return () => clearTimeout(t);
  }, [search, status]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[30px] font-medium text-[#080812]">Invoices</h2>
        <Button asChild>
          <Link href="/invoices/new">Manual Invoice</Link>
        </Button>
      </div>

      <div className="flex gap-3">
        <Input
          placeholder="Search by invoice number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm bg-white"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="partially_paid">Partially Paid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="void">Void</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff]">
                <TableHead className="text-[#6366f1]">Number</TableHead>
                <TableHead className="text-[#6366f1]">Customer</TableHead>
                <TableHead className="text-[#6366f1]">Rental</TableHead>
                <TableHead className="text-[#6366f1]">Due</TableHead>
                <TableHead className="text-[#6366f1] text-right">Total</TableHead>
                <TableHead className="text-[#6366f1] text-right">Paid</TableHead>
                <TableHead className="text-[#6366f1] text-right">Due</TableHead>
                <TableHead className="text-[#6366f1]">Status</TableHead>
                <TableHead className="text-[#6366f1] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">Loading...</span>
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">No invoices found</span>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                    <TableCell>{inv.customer.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {inv.rental
                        ? `${inv.rental.startDate} → ${inv.rental.endDate}`
                        : '—'}
                    </TableCell>
                    <TableCell>{inv.dueDate}</TableCell>
                    <TableCell className="text-right">{formatCents(inv.totalAmount)}</TableCell>
                    <TableCell className="text-right">{formatCents(inv.amountPaid)}</TableCell>
                    <TableCell className="text-right">{formatCents(inv.amountDue)}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/invoices/${inv.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
