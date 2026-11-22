'use client';

/**
 * Settings → Branding → Theme (v2, northwind only).
 *
 * Two looks for the portal: Standard and Glass. Controlled by the Branding
 * page: a pick marks the page changed and Save changes keeps it, exactly like
 * the brand colour (Ghulam, Nov 2026: an instant switch beside a greyed-out
 * Save read as not saved). It is kept in this browser
 * (lib/appearance/portal-look.ts), not on the branding row.
 *
 * Glass is the booking site's Template 2 material (frosted, brand-tinted panes
 * with a bright rim, over one photograph). For now only the dashboard wears it.
 */

import { Check } from 'lucide-react';

import { SettingsPanel, SettingsSection } from '@/components/settings-v2/settings-kit';
import { useTenant } from '@/contexts/TenantContext';
import { isGlassTenant, type PortalLook } from '@/lib/appearance/portal-look';
import { cn } from '@/lib/utils';

const OPTIONS: { id: PortalLook; name: string; blurb: string }[] = [
  { id: 'standard', name: 'Standard', blurb: 'Clean cards on a soft wash of your brand colour.' },
  { id: 'glass', name: 'Glass', blurb: 'Frosted glass cards with a bright edge, on the same background.' },
];

export function PortalThemeSectionV2({
  value,
  onChange,
  disabled,
}: {
  value: PortalLook;
  onChange: (look: PortalLook) => void;
  disabled?: boolean;
}) {
  // Northwind only for now: no other tenant is offered the choice.
  const { tenant } = useTenant();
  if (!isGlassTenant(tenant?.slug)) return null;


  return (
    <SettingsSection
      anchor="theme"
      title="Theme"
      description="How your dashboard looks. Pick one and press Save changes. It is kept on this device."
    >
      <SettingsPanel>
        <div className="grid max-w-2xl gap-4 py-4 sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const selected = value === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onChange(option.id)}
                className={cn(
                  'flex flex-col gap-3 rounded-xl border bg-card p-3 text-left outline-none transition-[border-color,box-shadow] duration-200 ease-out',
                  'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                  selected ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]' : 'hover:border-foreground/20'
                )}
              >
                <ThemePreview look={option.id} />
                <div className="flex items-start gap-2 px-1 pb-0.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{option.name}</div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{option.blurb}</p>
                  </div>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200 ease-out',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                    )}
                  >
                    {selected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </SettingsPanel>
    </SettingsSection>
  );
}

/** A small picture of the dashboard in each look: a sidebar and three cards. */
function ThemePreview({ look }: { look: PortalLook }) {
  const glass = look === 'glass';

  const pane = glass
    ? {
        background: 'linear-gradient(150deg, rgb(255 255 255 / 0.62), rgb(255 255 255 / 0.36))',
        backdropFilter: 'blur(10px) saturate(140%)',
        WebkitBackdropFilter: 'blur(10px) saturate(140%)',
        border: '1px solid rgb(255 255 255 / 0.75)',
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.95), 0 10px 18px -12px rgb(30 30 80 / 0.55)',
      }
    : undefined;

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative flex h-28 gap-2 overflow-hidden rounded-lg border bg-background p-2'
      )}
      // Both looks sit on the same background: the brand wash.
      style={{
        backgroundImage:
          'radial-gradient(120% 90% at 100% 0%, hsl(var(--primary) / 0.12), transparent 60%)',
      }}
    >
      <div className={cn('w-[22%] rounded-md', !glass && 'border bg-card')} style={pane}>
        <div className="mx-1.5 mt-2 h-1.5 w-1/2 rounded-full bg-primary/70" />
        <div className="mx-1.5 mt-2 h-1 w-3/4 rounded-full bg-foreground/15" />
        <div className="mx-1.5 mt-1.5 h-1 w-2/3 rounded-full bg-foreground/15" />
        <div className="mx-1.5 mt-1.5 h-1 w-3/4 rounded-full bg-foreground/15" />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className={cn('h-[38%] rounded-md', !glass && 'border bg-card')} style={pane}>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full p-1.5">
            <path
              d="M0 24 C 15 20, 25 22, 38 15 S 62 14, 74 9 S 92 6, 100 4"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn('rounded-md p-1.5', !glass && 'border bg-card')} style={pane}>
              <div className="h-1 w-2/3 rounded-full bg-foreground/20" />
              <div className="mt-1.5 h-1 w-1/2 rounded-full bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
