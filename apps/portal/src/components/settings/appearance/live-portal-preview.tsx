'use client';

/**
 * A preview built from the portal's *real* components.
 *
 * The earlier version painted look-alike divs, which meant every future change
 * to Button or Table would silently drift away from what the preview promised.
 * This renders the actual `Button`, `Card`, `Badge`, `Input` and `Table` inside
 * a container that overrides the theme's CSS variables locally — because the
 * whole theme is variable-driven, real components repaint with no parallel
 * styling to maintain, and the preview is identical by construction.
 *
 * Scoping is the safety property: variables are set inline on this subtree
 * only, so hovering a preset can never repaint the surrounding portal or strand
 * a half-applied theme if the tenant navigates away mid-preview.
 */

import { Bell, Car, LayoutDashboard, Search, Settings, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { hexToHslTriplet, readableForegroundOn, shade } from '@/lib/appearance/color';
import { cn } from '@/lib/utils';

interface LivePortalPreviewProps {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  mode: 'light' | 'dark';
  /** Tenant logo to show in the preview sidebar. */
  logoUrl?: string | null;
  appName?: string;
  className?: string;
}

export function LivePortalPreview({
  primary,
  secondary,
  accent,
  background,
  mode,
  logoUrl,
  appName,
  className,
}: LivePortalPreviewProps) {
  const isDark = mode === 'dark';

  const surface = isDark ? shade(background, 0.07) : '#FFFFFF';
  const border = isDark ? shade(background, 0.16) : '#E9EDF2';
  const foreground = isDark ? '#F1F5F9' : '#0F172A';
  const muted = isDark ? shade(background, 0.12) : '#F1F5F9';
  const mutedFg = isDark ? '#94A3B8' : '#64748B';

  /**
   * Mirrors the variable names `use-dynamic-theme.ts` sets at runtime, so what
   * renders here is genuinely the same pipeline the live portal uses.
   */
  const themeVars = {
    '--background': hexToHslTriplet(background),
    '--foreground': hexToHslTriplet(foreground),
    '--card': hexToHslTriplet(surface),
    '--card-foreground': hexToHslTriplet(foreground),
    '--popover': hexToHslTriplet(surface),
    '--popover-foreground': hexToHslTriplet(foreground),
    '--primary': hexToHslTriplet(primary),
    '--primary-foreground': hexToHslTriplet(readableForegroundOn(primary)),
    '--secondary': hexToHslTriplet(muted),
    '--secondary-foreground': hexToHslTriplet(foreground),
    '--muted': hexToHslTriplet(muted),
    '--muted-foreground': hexToHslTriplet(mutedFg),
    '--accent': hexToHslTriplet(accent),
    '--accent-foreground': hexToHslTriplet(readableForegroundOn(accent)),
    '--border': hexToHslTriplet(border),
    '--input': hexToHslTriplet(border),
    '--ring': hexToHslTriplet(primary),
  } as React.CSSProperties;

  const onSidebar = readableForegroundOn(secondary);

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', active: true },
    { icon: Car, label: 'Vehicles', active: false },
    { icon: Users, label: 'Customers', active: false },
    { icon: Settings, label: 'Settings', active: false },
  ];

  return (
    <div
      style={themeVars}
      className={cn(
        'overflow-hidden rounded-lg border bg-background text-foreground shadow-sm',
        className
      )}
      aria-label={`Portal preview, ${mode} mode`}
    >
      <div className="flex min-h-[330px]">
        {/* Sidebar — painted directly, since it uses the deep brand surface */}
        <div
          className="flex w-[132px] shrink-0 flex-col gap-3 p-3"
          style={{ background: secondary, color: onSidebar }}
        >
          <div className="flex items-center gap-2 px-1">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="h-6 max-w-[96px] object-contain"
              />
            ) : (
              <>
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                  style={{ background: primary, color: readableForegroundOn(primary) }}
                >
                  {(appName || 'D').charAt(0).toUpperCase()}
                </div>
                <span className="truncate text-[11px] font-semibold">
                  {appName || 'Your portal'}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-col gap-0.5">
            {navItems.map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px]"
                style={
                  active
                    ? { background: primary, color: readableForegroundOn(primary) }
                    : { color: onSidebar, opacity: 0.72 }
                }
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="truncate">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Main column — everything below is real portal components */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                readOnly
                tabIndex={-1}
                placeholder="Search rentals…"
                className="h-7 pl-7 text-[11px]"
              />
            </div>
            <Button
              size="icon"
              variant="ghost"
              tabIndex={-1}
              className="h-7 w-7 shrink-0"
            >
              <Bell className="h-3 w-3" />
            </Button>
            <Button size="sm" tabIndex={-1} className="h-7 shrink-0 px-2.5 text-[11px]">
              New rental
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Active', value: '18', tinted: true },
              { label: 'Due today', value: '4', tinted: false },
              { label: 'Revenue', value: '£9.2k', tinted: false },
            ].map((stat) => (
              <Card key={stat.label} className="shadow-none">
                <CardContent className="p-2">
                  <p className="text-[9px] text-muted-foreground">{stat.label}</p>
                  <p
                    className={cn(
                      'text-sm font-semibold leading-tight',
                      stat.tinted && 'text-primary'
                    )}
                  >
                    {stat.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-7 px-2 text-[9px]">Customer</TableHead>
                  <TableHead className="h-7 px-2 text-[9px]">Vehicle</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[9px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { name: 'J. Okafor', car: 'Model 3', status: 'Active', variant: 'default' },
                  { name: 'A. Rahman', car: 'Corolla', status: 'Booked', variant: 'secondary' },
                  { name: 'M. Silva', car: 'Civic', status: 'Due', variant: 'outline' },
                ].map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="px-2 py-1.5 text-[10px] font-medium">
                      {row.name}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] text-muted-foreground">
                      {row.car}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-right">
                      <Badge
                        variant={row.variant as 'default' | 'secondary' | 'outline'}
                        className="h-4 px-1.5 text-[8px]"
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
