'use client';

import {
  ArrowRight, BadgeAlert, Ban, Banknote, BarChart3, Bell, BookOpen, Briefcase,
  Calculator, CalendarDays, CalendarPlus, Car, CircleDollarSign, ClipboardList,
  Clock, Compass, CreditCard, Crown, FileCheck, FileSignature, FileText,
  FlaskConical, Gift, Globe, GraduationCap, Hash, Heart, Inbox, LayoutDashboard,
  LifeBuoy, ListChecks, Lock, MessageSquare, Palette, PenLine, Quote, Receipt,
  Rocket, Route, ScanFace, ScrollText, Send, Shield, ShieldCheck, Sparkles,
  Star, Timer, TrendingUp, Users, Wallet, Workflow, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Icons a super admin may reference by name from the admin editor.
 *
 * An explicit allow-list rather than a dynamic lookup: the name comes from a
 * database column, and importing lucide by arbitrary string would pull the
 * whole icon set into the bundle. An unknown name degrades to BookOpen rather
 * than throwing — a typo in the editor must never break the page.
 */
const ICONS: Record<string, LucideIcon> = {
  ArrowRight, BadgeAlert, Ban, Banknote, BarChart3, Bell, BookOpen, Briefcase,
  Calculator, CalendarDays, CalendarPlus, Car, CircleDollarSign, ClipboardList,
  Clock, Compass, CreditCard, Crown, FileCheck, FileSignature, FileText,
  FlaskConical, Gift, Globe, GraduationCap, Hash, Heart, Inbox, LayoutDashboard,
  LifeBuoy, ListChecks, Lock, MessageSquare, Palette, PenLine, Quote, Receipt,
  Rocket, Route, ScanFace, ScrollText, Send, Shield, ShieldCheck, Sparkles,
  Star, Timer, TrendingUp, Users, Wallet, Workflow, Zap,
};

/** Every name the admin editor offers in its icon picker. */
export const WELCOME_ICON_NAMES = Object.keys(ICONS).sort();

export function WelcomeIcon({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || BookOpen;
  return <Icon className={className} />;
}
