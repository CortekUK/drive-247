'use client';

import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideProps } from 'lucide-react';
import { TONE_META, type AnnouncementTone } from '@/lib/announcements/contract';

const ICONS = { Info, CircleCheck, TriangleAlert, OctagonAlert } as const;

/** The lucide icon TONE_META names for a tone (the portal banner and dialog use the same mapping). */
export function ToneIcon({ tone, ...props }: LucideProps & { tone: AnnouncementTone }) {
  const Icon = ICONS[TONE_META[tone].icon];
  return <Icon {...props} />;
}
