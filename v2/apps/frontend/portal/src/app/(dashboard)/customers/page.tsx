'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogTrigger,
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
import { customersApi } from '@/lib/api';
import type { CustomerListItem } from '@drive247/shared-types';
import { AddCustomerDialog } from '@/components/customers/add-customer-dialog';
import { formatCents } from '@/lib/money';

const STATUS_ALL = 'all';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(STATUS_ALL);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchCustomers = async () => {
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (status !== STATUS_ALL) params.status = status;
      const { data: res } = await customersApi.list(params as never);
      if (res.success) setCustomers(res.data.items);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(fetchCustomers, 250);
    return () => clearTimeout(t);
  }, [search, status]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[30px] font-medium text-[#080812]">Customers</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Add Customer</Button>
          </DialogTrigger>
          <AddCustomerDialog
            onClose={() => setCreateOpen(false)}
            onCreated={() => {
              setCreateOpen(false);
              fetchCustomers();
            }}
          />
        </Dialog>
      </div>

      <div className="flex gap-3">
        <Input
          placeholder="Search by name, email, or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm bg-white"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff]">
                <TableHead className="text-[#6366f1]">Name</TableHead>
                <TableHead className="text-[#6366f1]">Email</TableHead>
                <TableHead className="text-[#6366f1]">Phone</TableHead>
                <TableHead className="text-[#6366f1]">Status</TableHead>
                <TableHead className="text-[#6366f1] text-right">Outstanding</TableHead>
                <TableHead className="text-[#6366f1]">Created</TableHead>
                <TableHead className="text-[#6366f1] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">Loading...</span>
                  </TableCell>
                </TableRow>
              ) : customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">No customers found</span>
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.email || '—'}</TableCell>
                    <TableCell>{c.phone || '—'}</TableCell>
                    <TableCell>
                      {c.status === 'active' ? (
                        <span className="text-[#16a34a] text-sm font-medium">Active</span>
                      ) : (
                        <span className="text-[#dc2626] text-sm font-medium">Inactive</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.outstandingBalance > 0 ? (
                        <span className="text-[#dc2626] font-medium">
                          {formatCents(c.outstandingBalance)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {formatCents(0)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/customers/${c.id}`}>View</Link>
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
