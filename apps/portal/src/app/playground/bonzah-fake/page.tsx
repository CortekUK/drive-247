"use client";

/**
 * Bonzah — DESIGN SANDBOX. The Integrations board's Bonzah dialog on its own,
 * for the landing page's Insurance story (turning Bonzah on, filling in its form).
 *
 * It mounts the board's real Bonzah panel (`_panels/bonzah.tsx`) in a frame
 * drawn like the board's dialog. The panel reads and writes real rows, so this
 * page is only ever opened by the landing-page capture script, which answers
 * the panel's reads with a demo, never-applied account and stops every write
 * before it leaves the browser. Do not open it by hand on a real session.
 */

import BonzahPanel, { BonzahStatus } from "@/app/(dashboard)/integrations/_panels/bonzah";
import type { PanelTenant } from "@/app/(dashboard)/integrations/_panels/_kit";
import { useTenant } from "@/contexts/TenantContext";

const WASH = [
  "radial-gradient(40rem 26rem at 105% -10%, hsl(var(--v2-wash) / 0.30), transparent 62%)",
  "radial-gradient(34rem 24rem at -8% -6%, hsl(var(--chart-3) / 0.24), transparent 58%)",
  "radial-gradient(36rem 22rem at 50% 118%, hsl(var(--v2-wash) / 0.20), transparent 62%)",
  "linear-gradient(180deg, hsl(var(--v2-wash) / 0.08) 0%, transparent 45%)",
].join(", ");

export default function BonzahFake() {
  const { tenant } = useTenant();

  return (
    <main className="flex min-h-screen items-stretch justify-center bg-app-gradient sm:items-center sm:p-10">
      <div
        className="flex w-full max-w-5xl flex-col bg-background px-5 pb-10 pt-8 sm:block sm:rounded-[28px] sm:p-6 sm:shadow-xl sm:ring-1 sm:ring-foreground/5"
        style={{ backgroundImage: WASH }}
      >
        <div className="-mt-2 flex h-12 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bonzah-logo.svg" alt="Bonzah" className="w-auto" style={{ height: 30 }} />
          <div className="ml-auto flex items-center gap-2 [&>*]:inline-flex [&>*]:h-6 [&>*]:min-w-[4.5rem] [&>*]:items-center [&>*]:justify-center [&>*]:rounded-full [&>*]:px-2.5 [&>*]:text-[11px] [&>*]:font-medium [&>*]:normal-case [&>*]:leading-none [&>*]:tracking-normal">
            {tenant && <BonzahStatus tenant={tenant as unknown as PanelTenant} />}
          </div>
        </div>
        {/* On a phone the screen sits in the middle of the page, under the logo. */}
        <div className="flex flex-1 flex-col justify-center sm:block">
          {tenant ? <BonzahPanel tenant={tenant as unknown as PanelTenant} onClose={() => {}} /> : null}
        </div>
      </div>
    </main>
  );
}
