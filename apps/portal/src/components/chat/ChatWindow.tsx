'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, ChevronDown, MessageCircle, Send, ArrowLeft, Mail, Phone as PhoneIcon, Check, X } from 'lucide-react';
import { useChatMessages, type ChatMessage } from '@/hooks/use-chat-messages';
import { ChatMessageBubble, DateSeparator } from './ChatMessageBubble';
import { CustomerChatInput } from './CustomerChatInput';
import { TypingIndicator } from './TypingIndicator';
import { useSocket, type MessageChannel } from '@/contexts/RealtimeChatContext';
import { useAuthStore } from '@/stores/auth-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

/* ── Brand SVG Icons ─────────────────────────────────────── */

function TwilioIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 30" className={className} fill="currentColor">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 8.284 6.716 15 15 15 8.284 0 15-6.716 15-15 0-8.284-6.716-15-15-15zm0 26.25c-6.213 0-11.25-5.037-11.25-11.25S8.787 3.75 15 3.75 26.25 8.787 26.25 15 21.213 26.25 15 26.25zm6.036-14.786a2.536 2.536 0 1 1-5.072 0 2.536 2.536 0 0 1 5.072 0zm0 7.072a2.536 2.536 0 1 1-5.072 0 2.536 2.536 0 0 1 5.072 0zm-7.072 0a2.536 2.536 0 1 1-5.072 0 2.536 2.536 0 0 1 5.072 0zm0-7.072a2.536 2.536 0 1 1-5.072 0 2.536 2.536 0 0 1 5.072 0z" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/* ── Channel Configuration ───────────────────────────────── */

interface ChannelConfig {
  key: MessageChannel | 'call';
  label: string;
  icon: React.ReactNode;
  color: string;
  bgActive: string;
  bgHover: string;
  ringColor: string;
  sendBg: string;
  sendHover: string;
}

const CHANNELS: ChannelConfig[] = [
  {
    key: 'in_app',
    label: 'In-App',
    icon: <MessageCircle className="h-4 w-4" />,
    color: 'text-indigo-500',
    bgActive: 'bg-indigo-500/10 border-indigo-500/30',
    bgHover: 'hover:bg-indigo-500/5',
    ringColor: 'ring-indigo-500/20',
    sendBg: 'bg-indigo-500',
    sendHover: 'hover:bg-indigo-600',
  },
  {
    key: 'sms',
    label: 'SMS',
    icon: <TwilioIcon className="h-4 w-4" />,
    color: 'text-[#F22F46]',
    bgActive: 'bg-[#F22F46]/10 border-[#F22F46]/30',
    bgHover: 'hover:bg-[#F22F46]/5',
    ringColor: 'ring-[#F22F46]/20',
    sendBg: 'bg-[#F22F46]',
    sendHover: 'hover:bg-[#d91a32]',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: <WhatsAppIcon className="h-4 w-4" />,
    color: 'text-[#25D366]',
    bgActive: 'bg-[#25D366]/10 border-[#25D366]/30',
    bgHover: 'hover:bg-[#25D366]/5',
    ringColor: 'ring-[#25D366]/20',
    sendBg: 'bg-[#25D366]',
    sendHover: 'hover:bg-[#1da851]',
  },
  {
    key: 'email',
    label: 'Email',
    icon: <Mail className="h-4 w-4" />,
    color: 'text-blue-500',
    bgActive: 'bg-blue-500/10 border-blue-500/30',
    bgHover: 'hover:bg-blue-500/5',
    ringColor: 'ring-blue-500/20',
    sendBg: 'bg-blue-500',
    sendHover: 'hover:bg-blue-600',
  },
  {
    key: 'call',
    label: 'Call',
    icon: <PhoneIcon className="h-4 w-4" />,
    color: 'text-amber-500',
    bgActive: 'bg-amber-500/10 border-amber-500/30',
    bgHover: 'hover:bg-amber-500/5',
    ringColor: 'ring-amber-500/20',
    sendBg: 'bg-amber-500',
    sendHover: 'hover:bg-amber-600',
  },
];

/* ── Props ───────────────────────────────────────────────── */

/** Check if two phone numbers are from different countries based on prefix */
function isInternational(fromNumber: string | null, toNumber: string | null): boolean {
  if (!fromNumber || !toNumber) return false;
  const prefixes = ['+353', '+351', '+971', '+91', '+64', '+61', '+49', '+48', '+47', '+46', '+45', '+44', '+43', '+41', '+39', '+34', '+33', '+32', '+31', '+27', '+1'];
  const getPrefix = (num: string) => {
    const cleaned = num.replace(/\s/g, '');
    return prefixes.find(p => cleaned.startsWith(p)) || cleaned.slice(0, 3);
  };
  return getPrefix(fromNumber) !== getPrefix(toNumber);
}

interface ChatWindowProps {
  channelId: string | null;
  customerId: string | null;
  customerName: string;
  customerAvatar?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  twilioPhoneNumber?: string | null;
  onBack?: () => void;
  lastChannel?: MessageChannel;
  smsEnabled?: boolean;
  whatsappEnabled?: boolean;
}

export function ChatWindow({
  channelId,
  customerId,
  customerName,
  customerAvatar,
  customerEmail,
  customerPhone,
  twilioPhoneNumber,
  onBack,
  lastChannel = 'in_app',
  smsEnabled = false,
  whatsappEnabled = false,
}: ChatWindowProps) {
  const { messages, isLoading, loadMore, hasMore, isLoadingMore } = useChatMessages(channelId, customerId);
  const { onTyping, onPresenceUpdate } = useSocket();
  const { appUser } = useAuthStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [isCustomerOnline, setIsCustomerOnline] = useState(false);
  const [customerLastSeen, setCustomerLastSeen] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activeChannel, setActiveChannel] = useState<MessageChannel | 'call'>(lastChannel);

  // Phone number management for SMS
  const [phone, setPhone] = useState(customerPhone || '');
  const [isAddingPhone, setIsAddingPhone] = useState(false);
  const [isSavingPhone, setIsSavingPhone] = useState(false);

  // Email management
  const [email, setEmail] = useState(customerEmail || '');
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  useEffect(() => { setPhone(customerPhone || ''); }, [customerPhone]);
  useEffect(() => { setEmail(customerEmail || ''); }, [customerEmail]);
  useEffect(() => { setActiveChannel(lastChannel); }, [lastChannel]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Listen for typing events
  useEffect(() => {
    if (!customerId) return;
    const unsub = onTyping((payload) => {
      if (payload.customerId === customerId && payload.userType === 'customer') {
        setIsTyping(payload.isTyping);
        setTypingUserId(payload.userId);
      }
    });
    return unsub;
  }, [customerId, onTyping]);

  // Listen for presence updates
  useEffect(() => {
    if (!channelId) return;
    const unsub = onPresenceUpdate((payload) => {
      if (payload.channelId === channelId && payload.participantType === 'customer') {
        setIsCustomerOnline(payload.isOnline);
        setCustomerLastSeen(payload.lastSeenAt);
      }
    });
    return unsub;
  }, [channelId, onPresenceUpdate]);

  const handleSavePhone = useCallback(async () => {
    if (!phone.trim() || !customerId) return;
    setIsSavingPhone(true);
    try {
      const { error } = await supabase.from('customers').update({ phone: phone.trim() }).eq('id', customerId);
      if (error) throw error;
      toast({ title: 'Phone saved', description: 'Customer phone number updated.' });
      setIsAddingPhone(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSavingPhone(false);
    }
  }, [phone, customerId]);

  const handleSaveEmail = useCallback(async () => {
    if (!email.trim() || !customerId) return;
    setIsSavingEmail(true);
    try {
      const { error } = await supabase.from('customers').update({ email: email.trim() }).eq('id', customerId);
      if (error) throw error;
      toast({ title: 'Email saved', description: 'Customer email updated.' });
      setIsAddingEmail(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSavingEmail(false);
    }
  }, [email, customerId]);

  // Group messages by date
  const groupedMessages = groupMessagesByDate(messages);

  // Get customer initials
  const initials = customerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Determine which channels are enabled (all shown, disabled ones dimmed)
  const channelEnabled: Record<string, boolean> = {
    in_app: true,
    sms: smsEnabled,
    whatsapp: whatsappEnabled,
    email: true,
    call: true,
  };

  const activeChannelConfig = CHANNELS.find((ch) => ch.key === activeChannel) || CHANNELS[0];
  const hasPhone = !!(customerPhone || phone);
  const hasEmail = !!(customerEmail || email);
  const needsPhone = activeChannel === 'sms' && !hasPhone;

  if (!channelId || !customerId) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        {/* Top row: customer info */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Back button - mobile only */}
              {onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden h-9 w-9 shrink-0">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              {/* Avatar with status */}
              <div className="relative">
                <Avatar className="h-11 w-11 ring-2 ring-background">
                  <AvatarImage src={customerAvatar || undefined} alt={customerName} />
                  <AvatarFallback className="bg-primary/10 text-primary font-medium">{initials}</AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    'absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-background transition-colors',
                    isCustomerOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                  )}
                />
              </div>

              {/* Customer info */}
              <div>
                <h2 className="font-semibold text-base">{customerName}</h2>
                <div className="flex items-center gap-1.5 text-sm">
                  {isTyping ? (
                    <span className="text-primary font-medium flex items-center gap-1">
                      <span className="flex gap-0.5">
                        <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                      typing
                    </span>
                  ) : isCustomerOnline ? (
                    <span className="text-emerald-600 dark:text-emerald-400">Online</span>
                  ) : customerLastSeen ? (
                    <span className="text-muted-foreground">
                      Active {formatDistanceToNow(new Date(customerLastSeen), { addSuffix: true })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Offline</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Channel selector row — all channels shown, disabled ones dimmed */}
        <div className="px-6 pb-3">
          <div className="flex items-center gap-1.5">
            <TooltipProvider delayDuration={300}>
              {/* Sort: enabled channels first, then disabled */}
              {[...CHANNELS].sort((a, b) => {
                const aEnabled = channelEnabled[a.key] ?? false;
                const bEnabled = channelEnabled[b.key] ?? false;
                if (aEnabled === bEnabled) return 0;
                return aEnabled ? -1 : 1;
              }).map((ch, idx, sorted) => {
                const isEnabled = channelEnabled[ch.key] ?? false;
                const prevEnabled = idx > 0 ? (channelEnabled[sorted[idx - 1].key] ?? false) : isEnabled;
                const showSeparator = !isEnabled && prevEnabled;
                const isActive = activeChannel === ch.key;
                return (
                  <React.Fragment key={ch.key}>
                    {showSeparator && (
                      <div className="w-px h-5 bg-border/60 mx-1" />
                    )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          if (!isEnabled) return;
                          if (ch.key === 'call') {
                            const phoneToCall = customerPhone || phone;
                            if (phoneToCall) {
                              window.open(`tel:${phoneToCall}`, '_self');
                            } else {
                              toast({ title: 'No phone number', description: 'Add a phone number to call this customer.', variant: 'destructive' });
                            }
                            return;
                          }
                          setActiveChannel(ch.key);
                        }}
                        disabled={!isEnabled}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200',
                          isActive && isEnabled
                            ? cn(ch.bgActive, ch.color)
                            : isEnabled
                            ? cn('border-transparent', ch.color, 'opacity-60', ch.bgHover)
                            : cn('border-transparent cursor-not-allowed opacity-30', ch.color)
                        )}
                      >
                        <span className={ch.color}>
                          {ch.icon}
                        </span>
                        {ch.label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {!isEnabled
                        ? `${ch.label} not configured — enable in Settings`
                        : ch.key === 'call'
                        ? `Call ${customerName}`
                        : `Send via ${ch.label}`}
                    </TooltipContent>
                  </Tooltip>
                  </React.Fragment>
                );
              })}
            </TooltipProvider>
          </div>
        </div>

        {/* SMS phone bar */}
        {activeChannel === 'sms' && (
          <div className="px-6 pb-3">
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors',
              hasPhone && !isAddingPhone
                ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800'
                : 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800'
            )}>
              <TwilioIcon className="h-3.5 w-3.5 text-[#F22F46] shrink-0" />
              {hasPhone && !isAddingPhone ? (
                <div className="flex items-center justify-between flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">Sending to</span>
                    <span className="font-mono font-medium text-xs">{customerPhone || phone}</span>
                    <button
                      onClick={() => { setIsAddingPhone(true); setPhone(customerPhone || phone); }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                    >
                      Edit
                    </button>
                  </div>
                  {isInternational(twilioPhoneNumber, customerPhone || phone) && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">One-way — customer can't reply to international numbers</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  {!hasPhone && !isAddingPhone && (
                    <>
                      <span className="text-muted-foreground text-xs shrink-0">No phone —</span>
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setIsAddingPhone(true)}>
                        Add phone number
                      </Button>
                    </>
                  )}
                  {isAddingPhone && (
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="text-muted-foreground text-xs shrink-0">{hasPhone ? 'Edit number' : 'Add number'}</span>
                      <Input
                        placeholder="+44 7911 123456"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="h-6 text-xs flex-1 max-w-[200px]"
                        autoFocus
                      />
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleSavePhone} disabled={!phone.trim() || isSavingPhone}>
                        {isSavingPhone ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-emerald-500" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setIsAddingPhone(false); setPhone(customerPhone || ''); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Email bar */}
        {activeChannel === 'email' && (
          <div className="px-6 pb-3">
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors',
              hasEmail && !isAddingEmail
                ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800'
                : 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800'
            )}>
              <Mail className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              {hasEmail && !isAddingEmail ? (
                <>
                  <span className="text-muted-foreground text-xs">Sending to</span>
                  <span className="font-medium text-xs">{customerEmail || email}</span>
                  <button
                    onClick={() => { setIsAddingEmail(true); setEmail(customerEmail || email); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1 underline underline-offset-2"
                  >
                    Edit
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  {!hasEmail && !isAddingEmail && (
                    <>
                      <span className="text-muted-foreground text-xs shrink-0">No email —</span>
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setIsAddingEmail(true)}>
                        Add email address
                      </Button>
                    </>
                  )}
                  {isAddingEmail && (
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="text-muted-foreground text-xs shrink-0">{hasEmail ? 'Edit email' : 'Add email'}</span>
                      <Input
                        placeholder="customer@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-6 text-xs flex-1 max-w-[240px]"
                        autoFocus
                      />
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleSaveEmail} disabled={!email.trim() || isSavingEmail}>
                        {isSavingEmail ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-blue-500" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setIsAddingEmail(false); setEmail(customerEmail || ''); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Messages area ───────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="px-6 py-4">
            {/* Load more button */}
            {hasMore && (
              <div className="flex justify-center py-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {isLoadingMore ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading...</>
                  ) : (
                    'Load earlier messages'
                  )}
                </Button>
              </div>
            )}

            {/* Loading state */}
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary/50 mb-3" />
                <p className="text-sm text-muted-foreground">Loading messages...</p>
              </div>
            )}

            {/* Empty messages state */}
            {!isLoading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Send className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-medium text-foreground mb-1">Start the conversation</h3>
                <p className="text-sm text-muted-foreground max-w-[240px]">
                  Send a message to begin chatting with {customerName}
                </p>
              </div>
            )}

            {/* Messages */}
            {!isLoading &&
              groupedMessages.map((group) => (
                <div key={group.date}>
                  <DateSeparator date={group.date} />
                  {group.messages.map((message, index) => {
                    const prevMessage = group.messages[index - 1];
                    const nextMessage = group.messages[index + 1];
                    const isFirstInGroup = !prevMessage || prevMessage.sender_type !== message.sender_type;
                    const isLastInGroup = !nextMessage || nextMessage.sender_type !== message.sender_type;
                    return (
                      <ChatMessageBubble
                        key={message.id}
                        message={message}
                        isOwnMessage={message.sender_type === 'tenant'}
                        isFirstInGroup={isFirstInGroup}
                        isLastInGroup={isLastInGroup}
                        customerName={customerName}
                        customerAvatar={customerAvatar}
                      />
                    );
                  })}
                </div>
              ))}

            {/* Typing indicator */}
            {isTyping && <TypingIndicator name={customerName} avatar={customerAvatar} />}

            {/* Scroll anchor */}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        </ScrollArea>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <Button
            size="icon"
            variant="secondary"
            className="absolute bottom-4 right-6 h-10 w-10 rounded-full shadow-lg"
            onClick={scrollToBottom}
          >
            <ChevronDown className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* ── Input ───────────────────────────────────────────── */}
      <CustomerChatInput
        customerId={customerId}
        activeChannel={activeChannel === 'call' ? 'in_app' : activeChannel}
        channelConfig={activeChannelConfig}
        customerPhone={customerPhone || phone || null}
      />
    </div>
  );
}

/* ── Empty State ─────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-6">
        <MessageCircle className="h-12 w-12 text-primary/60" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">Select a conversation</h3>
      <p className="text-muted-foreground max-w-[280px]">
        Choose a conversation from the list to start messaging with your customers
      </p>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function groupMessagesByDate(messages: ChatMessage[]): { date: string; messages: ChatMessage[] }[] {
  const groups: { date: string; messages: ChatMessage[] }[] = [];
  let currentDate: string | null = null;
  let currentGroup: ChatMessage[] = [];

  for (const message of messages) {
    const messageDate = new Date(message.created_at).toDateString();
    if (messageDate !== currentDate) {
      if (currentDate && currentGroup.length > 0) {
        groups.push({ date: currentDate, messages: currentGroup });
      }
      currentDate = messageDate;
      currentGroup = [message];
    } else {
      currentGroup.push(message);
    }
  }

  if (currentDate && currentGroup.length > 0) {
    groups.push({ date: currentDate, messages: currentGroup });
  }

  return groups;
}
