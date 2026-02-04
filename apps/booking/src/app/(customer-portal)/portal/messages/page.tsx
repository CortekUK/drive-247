'use client';

import { MessageSquare } from 'lucide-react';
import { CustomerChatWindow } from '@/components/customer-portal/chat';

export default function CustomerMessagesPage() {
  return (
    <div className="container max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">Messages</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Chat with our support team
        </p>
      </div>

      <div className="h-[calc(100vh-250px)] min-h-[400px]">
        <CustomerChatWindow />
      </div>
    </div>
  );
}
