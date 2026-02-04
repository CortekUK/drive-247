'use client';

import { useState, useMemo } from 'react';
import { Loader2, Search, Send, Users } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useSocket } from '@/contexts/SocketContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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

  const allVisibleSelected = filteredCustomers.length > 0 &&
    filteredCustomers.every((c) => selectedIds.has(c.id));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Send Bulk Message
          </DialogTitle>
          <DialogDescription>
            Select customers and compose a message to send to all of them.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Select all / Deselect all */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {selectedIds.size} customer{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <Button variant="link" size="sm" onClick={selectAll} className="h-auto p-0">
              Select all
            </Button>
            <span className="text-muted-foreground">|</span>
            <Button variant="link" size="sm" onClick={deselectAll} className="h-auto p-0">
              Deselect all
            </Button>
          </div>
        </div>

        {/* Customer list */}
        <ScrollArea className="h-[200px] border rounded-md">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && filteredCustomers.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              {searchQuery ? 'No customers found' : 'No customers available'}
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
        <Textarea
          placeholder="Type your message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className="resize-none"
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={selectedIds.size === 0 || !message.trim() || isSending}
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send to {selectedIds.size} customer{selectedIds.size !== 1 ? 's' : ''}
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
    <label className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer">
      <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      <Avatar className="h-8 w-8">
        <AvatarImage src={customer.profile_photo_url || undefined} alt={customer.name} />
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{customer.name}</p>
        <p className="text-xs text-muted-foreground truncate">{customer.email}</p>
      </div>
    </label>
  );
}
