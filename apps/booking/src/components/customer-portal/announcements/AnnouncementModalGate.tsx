'use client';

import { useEffect, useState } from 'react';
import { useCustomerAnnouncements } from '@/hooks/use-customer-announcements';
import { AnnouncementModal } from './AnnouncementModal';

export function AnnouncementModalGate() {
  const { pendingMajorModal, markSeen, dismiss } = useCustomerAnnouncements();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingMajorModal && pendingMajorModal.id !== activeId) {
      setActiveId(pendingMajorModal.id);
      setOpen(true);
      // Mark seen on first render so the unread badge updates immediately.
      // Dismissal (click outside / Got it / ESC) writes dismissed_at later.
      markSeen.mutate(pendingMajorModal.id);
    }
  }, [pendingMajorModal, activeId, markSeen]);

  if (!pendingMajorModal || !open) return null;

  return (
    <AnnouncementModal
      announcement={pendingMajorModal}
      open={open}
      onDismiss={() => {
        setOpen(false);
        dismiss.mutate(pendingMajorModal.id);
      }}
    />
  );
}
