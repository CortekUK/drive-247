'use client';

import { useState } from 'react';
import { TraxChatButton } from './TraxChatButton';
import { TraxChatPopup } from './TraxChatPopup';

export function TraxChatWidget() {
  const [isOpen, setIsOpen] = useState(false);

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
