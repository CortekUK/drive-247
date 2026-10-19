/**
 * Feedback categories as Super Admin draws them: label, icon and colour.
 * Shared by the Feedbacks page and a company's page.
 */

import type { ElementType } from 'react';
import { Bug, Sparkles, StickyNote, Wrench } from 'lucide-react';

export type Category = 'bug' | 'improvement' | 'feature_request' | 'note';

export const CATEGORY_META: Record<Category, { label: string; icon: ElementType; color: string }> = {
  bug: { label: 'Bug', icon: Bug, color: '#dc2626' },
  improvement: { label: 'Improvement', icon: Wrench, color: '#d97706' },
  feature_request: { label: 'Feature Request', icon: Sparkles, color: '#6366f1' },
  note: { label: 'Note', icon: StickyNote, color: '#737373' },
};
