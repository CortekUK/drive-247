'use client';

import { useState, useMemo } from 'react';
import { Loader2, Search, Send, Users, CheckCircle2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useSocket } from '@/contexts/SocketContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  profile_photo_url: string | null;
}

interface BulkMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkMessageModal({ open, onOpenChange }: BulkMessageModalProps) {
  const { tenant } = useTenant();
  const { sendBulkMessage } = useSocket();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Fetch customers
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['bulk-message-customers', tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error('No tenant context');

      const { data, error } = await supabase
        .from('customers')
        .select('id, name, email, phone, profile_photo_url')
        .eq('tenant_id', tenant.id)
        .eq('status', 'active')
        .order('name', { ascending: true });

      if (error) throw error;
      return data as Customer[];
    },
    enabled: !!tenant && open,
  });

  // Filter customers by search
  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers;

    const query = searchQuery.toLowerCase();
    return customers.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query)
    );
  }, [customers, searchQuery]);

  // Toggle selection
  const toggleCustomer = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // Select all visible
  const selectAll = () => {
    const newSelected = new Set(selectedIds);
    filteredCustomers.forEach((c) => newSelected.add(c.id));
    setSelectedIds(newSelected);
  };

  // Deselect all visible
  const deselectAll = () => {
    const newSelected = new Set(selectedIds);
    filteredCustomers.forEach((c) => newSelected.delete(c.id));
    setSelectedIds(newSelected);
  };

  // Send bulk message
  const handleSend = async () => {
    if (selectedIds.size === 0 || !message.trim()) return;

    setIsSending(true);
    try {
      sendBulkMessage(Array.from(selectedIds), message.trim());

      toast({
        title: 'Messages sent',
        description: `Message sent to ${selectedIds.size} customer${selectedIds.size > 1 ? 's' : ''}`,
      });

      // Reset and close
      setSelectedIds(new Set());
      setMessage('');
      setSearchQuery('');
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to send messages. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  // Reset state when modal closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedIds(new Set());
      setMessage('');
      setSearchQuery('');
    }
    onOpenChange(newOpen);
  };

  const allVisibleSelected =
    filteredCustomers.length > 0 &&
    filteredCustomers.every((c) => selectedIds.has(c.id));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            Send Bulk Message
          </DialogTitle>
          <DialogDescription>
            Select customers and compose a message to send to all of them at once.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Select all / Deselect all */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-primary font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  {selectedIds.size} selected
                </div>
              )}
              {selectedIds.size === 0 && (
                <span className="text-sm text-muted-foreground">
                  {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAll}
                className="h-8 text-xs"
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={deselectAll}
                className="h-8 text-xs"
                disabled={selectedIds.size === 0}
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Customer list */}
          <ScrollArea className="h-[220px] border rounded-xl">
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary/50 mb-2" />
                <p className="text-sm text-muted-foreground">Loading customers...</p>
              </div>
            )}

            {!isLoading && filteredCustomers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? 'No customers found' : 'No customers available'}
                </p>
              </div>
            )}

            {!isLoading &&
              filteredCustomers.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  isSelected={selectedIds.has(customer.id)}
                  onToggle={() => toggleCustomer(customer.id)}
                />
              ))}
          </ScrollArea>

          {/* Message input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Message</label>
            <textarea
              placeholder="Type your message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className={cn(
                'flex w-full rounded-xl border border-input bg-background px-4 py-3 text-sm',
                'placeholder:text-muted-foreground focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50',
                'disabled:cursor-not-allowed disabled:opacity-50 resize-none'
              )}
            />
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 bg-muted/30">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={selectedIds.size === 0 || !message.trim() || isSending}
            className="gap-2"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send to {selectedIds.size || 0}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CustomerRowProps {
  customer: Customer;
  isSelected: boolean;
  onToggle: () => void;
}

function CustomerRow({ customer, isSelected, onToggle }: CustomerRowProps) {
  const initials = customer.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <label
      className={cn(
        'flex items-center gap-3 p-3 cursor-pointer transition-colors',
        'hover:bg-accent/50',
        isSelected && 'bg-primary/5'
      )}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggle}
        className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
      />
      <Avatar className="h-9 w-9">
        <AvatarImage src={customer.profile_photo_url || undefined} alt={customer.name} />
        <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{customer.name}</p>
        <p className="text-xs text-muted-foreground truncate">{customer.email}</p>
      </div>
    </label>
  );
}
