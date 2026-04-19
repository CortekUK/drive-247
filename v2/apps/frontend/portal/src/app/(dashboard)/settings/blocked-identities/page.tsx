'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
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
  BlockedIdentityType,
  BLOCKED_IDENTITY_TYPE_LABELS,
  type BlockedIdentityResponse,
} from '@drive247/shared-types';
import { idVerificationApi } from '@/lib/api';

export default function BlockedIdentitiesPage() {
  const [items, setItems] = useState<BlockedIdentityResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const fetchItems = async () => {
    try {
      const { data: res } = await idVerificationApi.listBlocks();
      if (res.success) setItems(res.data.items);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleToggle = async (block: BlockedIdentityResponse) => {
    try {
      await idVerificationApi.updateBlock(block.id, {
        isActive: !block.isActive,
      });
      fetchItems();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Update failed');
    }
  };

  const handleDelete = async (block: BlockedIdentityResponse) => {
    if (
      !confirm(`Remove the block on ${block.identityValue}? This cannot be undone.`)
    ) {
      return;
    }
    try {
      await idVerificationApi.deleteBlock(block.id);
      toast.success('Block removed');
      fetchItems();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[30px] font-medium text-[#080812]">
            Blocked Identities
          </h2>
          <p className="text-sm text-muted-foreground">
            Customers with these identifiers are auto-rejected during ID
            verification. Scoped to your tenant only.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>Add block</Button>
          </DialogTrigger>
          <AddBlockDialog
            onClose={() => setAddOpen(false)}
            onCreated={() => {
              setAddOpen(false);
              fetchItems();
            }}
          />
        </Dialog>
      </div>

      <Card>
        <CardContent className="py-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No blocked identities yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {BLOCKED_IDENTITY_TYPE_LABELS[b.identityType] ??
                          b.identityType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {b.identityValue}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {b.reason}
                    </TableCell>
                    <TableCell>
                      {b.isActive ? (
                        <span className="text-[#16a34a] text-sm font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="text-[#737373] text-sm">Inactive</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(b.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggle(b)}
                      >
                        {b.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[#dc2626]"
                        onClick={() => handleDelete(b)}
                      >
                        Delete
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

function AddBlockDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [identityType, setIdentityType] = useState<BlockedIdentityType>(
    BlockedIdentityType.DRIVING_LICENSE,
  );
  const [identityValue, setIdentityValue] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!identityValue.trim()) {
      toast.error('Value is required');
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Reason must be at least 3 characters');
      return;
    }
    setSubmitting(true);
    try {
      await idVerificationApi.createBlock({
        identityType,
        identityValue: identityValue.trim(),
        reason: reason.trim(),
      });
      toast.success('Block added');
      onCreated();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Add failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Add blocked identity</DialogTitle>
        <DialogDescription>
          New verifications matching this identifier will be auto-rejected.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1">
          <Label>Type</Label>
          <Select
            value={identityType}
            onValueChange={(v) => setIdentityType(v as BlockedIdentityType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(BLOCKED_IDENTITY_TYPE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="value">Value</Label>
          <Input
            id="value"
            value={identityValue}
            onChange={(e) => setIdentityValue(e.target.value)}
            placeholder={
              identityType === BlockedIdentityType.EMAIL
                ? 'user@example.com'
                : 'D1234567'
            }
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="reason">Reason</Label>
          <textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[#e2e8f0] rounded-md bg-white focus:outline-none focus:border-[#6366f1]"
            placeholder="Outstanding damage fees from previous rental"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Adding...' : 'Add block'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
