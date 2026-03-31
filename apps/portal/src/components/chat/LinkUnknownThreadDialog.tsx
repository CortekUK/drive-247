'use client';

import { useState, useMemo } from 'react';
import { Search, Loader2, UserPlus, Phone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';

interface LinkUnknownThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  phoneNumber: string;
}

interface CustomerResult {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  profile_photo_url: string | null;
}

export function LinkUnknownThreadDialog({
  open,
  onOpenChange,
  threadId,
  phoneNumber,
}: LinkUnknownThreadDialogProps) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  const handleSearch = async () => {
    if (!tenant || !searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const query = searchQuery.trim().toLowerCase();
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, email, phone, profile_photo_url')
        .eq('tenant_id', tenant.id)
        .or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);

      if (error) throw error;
      setCustomers(data || []);
    } catch (err: any) {
      toast({ title: 'Search failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsSearching(false);
    }
  };

  const handleLink = async (customerId: string) => {
    if (!tenant) return;

    setIsLinking(true);
    try {
      // 1. Update the unknown thread with the linked customer
      await supabase
        .from('sms_unknown_threads')
        .update({
          linked_customer_id: customerId,
          linked_at: new Date().toISOString(),
        })
        .eq('id', threadId);

      // 2. Get or create chat channel for this customer
      let channelId: string;
      const { data: existingChannel } = await supabase
        .from('chat_channels')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', customerId)
        .single();

      if (existingChannel) {
        channelId = existingChannel.id;
      } else {
        const { data: newChannel, error: createError } = await supabase
          .from('chat_channels')
          .insert({
            tenant_id: tenant.id,
            customer_id: customerId,
          })
          .select('id')
          .single();

        if (createError) throw createError;
        channelId = newChannel!.id;
      }

      // 3. Move unknown messages to the customer's channel
      const { data: unknownMessages } = await supabase
        .from('sms_unknown_messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

      if (unknownMessages && unknownMessages.length > 0) {
        // Insert messages into chat_channel_messages
        const messagesToInsert = unknownMessages.map((msg) => ({
          channel_id: channelId,
          sender_type: msg.direction === 'inbound' ? 'customer' : 'tenant',
          sender_id: msg.direction === 'inbound' ? customerId : (msg.sender_id || customerId),
          content: msg.content,
          channel: 'sms' as const,
          external_id: msg.external_id,
          external_status: msg.external_status,
          from_number: msg.direction === 'inbound' ? phoneNumber : null,
          created_at: msg.created_at,
        }));

        await supabase.from('chat_channel_messages').insert(messagesToInsert);

        // Update channel last_message_at
        const lastMsg = unknownMessages[unknownMessages.length - 1];
        await supabase
          .from('chat_channels')
          .update({
            last_message_at: lastMsg.created_at,
            last_channel: 'sms',
            updated_at: new Date().toISOString(),
          })
          .eq('id', channelId);
      }

      // 4. Also update the customer's phone if they don't have one
      const { data: customer } = await supabase
        .from('customers')
        .select('phone')
        .eq('id', customerId)
        .single();

      if (!customer?.phone) {
        await supabase
          .from('customers')
          .update({ phone: phoneNumber })
          .eq('id', customerId);
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['chat-channels'] });
      queryClient.invalidateQueries({ queryKey: ['sms-unknown-threads'] });

      toast({
        title: 'Thread linked',
        description: 'Messages have been moved to the customer\'s conversation.',
      });

      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Link failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Link to Customer
          </DialogTitle>
          <DialogDescription>
            Link <span className="font-mono font-medium">{phoneNumber}</span> to an existing customer. All messages will be moved to their conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="flex gap-2">
            <Input
              placeholder="Search by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={isSearching || !searchQuery.trim()}>
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {/* Results */}
          <ScrollArea className="max-h-64">
            <div className="space-y-1">
              {customers.map((customer) => {
                const initials = customer.name
                  ?.split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2) || '?';

                return (
                  <button
                    key={customer.id}
                    onClick={() => handleLink(customer.id)}
                    disabled={isLinking}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 transition-colors text-left"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={customer.profile_photo_url || undefined} />
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{customer.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{customer.email}</p>
                      {customer.phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {customer.phone}
                        </p>
                      )}
                    </div>
                    {isLinking && <Loader2 className="h-4 w-4 animate-spin" />}
                  </button>
                );
              })}

              {customers.length === 0 && searchQuery && !isSearching && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No customers found
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
