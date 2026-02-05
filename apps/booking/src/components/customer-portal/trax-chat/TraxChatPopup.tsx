'use client';

import { useState } from 'react';
import { X, Bot, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TraxAIChatWindow } from './TraxAIChatWindow';
import { CustomerChatWindowCompact } from '../chat/CustomerChatWindowCompact';
import { useCustomerChat } from '@/hooks/use-customer-chat';
import { cn } from '@/lib/utils';

interface TraxChatPopupProps {
  onClose: () => void;
}

export function TraxChatPopup({ onClose }: TraxChatPopupProps) {
  const [activeTab, setActiveTab] = useState<'trax' | 'chat'>('trax');

  // Get unread count from admin chat
  const { messages } = useCustomerChat();
  const unreadCount = messages.filter(
    (msg) => msg.sender_type === 'tenant' && !msg.is_read
  ).length;

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50',
        'w-[380px] h-[550px]',
        'bg-background border rounded-xl shadow-2xl',
        'flex flex-col overflow-hidden',
        'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <h2 className="font-semibold">Trax Assistant</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'trax' | 'chat')}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 p-0 h-auto shrink-0">
          <TabsTrigger
            value="trax"
            className={cn(
              'flex-1 rounded-none border-b-2 border-transparent',
              'data-[state=active]:border-primary data-[state=active]:bg-transparent',
              'py-3 px-4'
            )}
          >
            <Bot className="h-4 w-4 mr-2" />
            Trax
          </TabsTrigger>
          <TabsTrigger
            value="chat"
            className={cn(
              'flex-1 rounded-none border-b-2 border-transparent relative',
              'data-[state=active]:border-primary data-[state=active]:bg-transparent',
              'py-3 px-4'
            )}
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Chat
            {unreadCount > 0 && (
              <span
                className={cn(
                  'absolute top-1.5 right-3',
                  'flex h-4 min-w-4 items-center justify-center',
                  'rounded-full bg-destructive px-1',
                  'text-[10px] font-medium text-destructive-foreground'
                )}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trax" className="flex-1 mt-0 overflow-hidden min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
          <TraxAIChatWindow />
        </TabsContent>

        <TabsContent value="chat" className="flex-1 mt-0 overflow-hidden min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
          <CustomerChatWindowCompact />
        </TabsContent>
      </Tabs>
    </div>
  );
}
