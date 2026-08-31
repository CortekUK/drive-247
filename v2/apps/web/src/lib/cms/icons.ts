import {
  Award,
  BadgeCheck,
  Baby,
  CalendarDays,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CreditCard,
  DollarSign,
  Fuel,
  Gauge,
  Globe,
  Headphones,
  Heart,
  Key,
  Lock,
  Mail,
  Map,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Route,
  ShieldCheck,
  Shield,
  Sparkles,
  Star,
  Tag,
  ThumbsUp,
  Truck,
  UserRound,
  Users,
  Wifi,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The portal stores an icon as a kebab-case name string, chosen from its own
 * picker. This maps that vocabulary onto the icons v2 actually ships.
 *
 * An unknown name must never render an invisible box — the v2 fleet strip
 * already shipped that bug once, switching on six hardcoded slugs and
 * returning `null` for every real make. `resolveIcon` therefore always returns
 * something, and the caller chooses what "something" is.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  award: Award,
  baby: Baby,
  "badge-check": BadgeCheck,
  calendar: CalendarDays,
  "calendar-days": CalendarDays,
  car: Car,
  check: CheckCircle2,
  "check-circle": CheckCircle2,
  "clipboard-check": ClipboardCheck,
  clock: Clock,
  "credit-card": CreditCard,
  "dollar-sign": DollarSign,
  fuel: Fuel,
  gauge: Gauge,
  globe: Globe,
  headphones: Headphones,
  heart: Heart,
  key: Key,
  lock: Lock,
  mail: Mail,
  map: Map,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  navigation: Navigation,
  phone: Phone,
  route: Route,
  shield: Shield,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  tag: Tag,
  "thumbs-up": ThumbsUp,
  truck: Truck,
  user: UserRound,
  "user-round": UserRound,
  users: Users,
  wifi: Wifi,
  zap: Zap,
};

export function resolveIcon(
  name: string | undefined,
  fallback: LucideIcon = Sparkles,
): LucideIcon {
  if (!name) return fallback;
  return ICONS[name.trim().toLowerCase()] ?? fallback;
}
