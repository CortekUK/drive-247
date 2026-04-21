'use client';

import { MessageSquare } from 'lucide-react';
import { CustomerChatWindow } from '@/components/customer-portal/chat';

export default function CustomerMessagesPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 sm:h-7 sm:w-7 text-primary shrink-0" />
          <h1 className="text-xl sm:text-2xl font-bold">Messages</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          Chat with our support team
        </p>
      </div>

      <div className="h-[calc(100dvh-200px)] sm:h-[calc(100vh-250px)] min-h-[400px]">
        <CustomerChatWindow />
      </div>
    </div>
  );
}
