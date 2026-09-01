'use client';

import { useState } from 'react';
import { TraxChatButton } from './TraxChatButton';
import { TraxChatPopup } from './TraxChatPopup';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export function TraxChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const { customerUser } = useCustomerAuthStore();

  // Only show chat widget to logged-in customers
  if (!customerUser) return null;

  return (
    <>
      {/* Floating button - always visible when popup is closed */}
      {!isOpen && (
        <TraxChatButton onClick={() => setIsOpen(true)} />
      )}

      {/* Chat popup */}
      {isOpen && (
        <TraxChatPopup onClose={() => setIsOpen(false)} />
      )}
    </>
  );
}
