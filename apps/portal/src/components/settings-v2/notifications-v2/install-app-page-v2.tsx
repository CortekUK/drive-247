"use client";

/**
 * Settings › Install app (`?tab=install`), Ghulam, Nov 9 2026.
 *
 * The same install guide the push setup carries (`PushInstallGuide`: Install
 * app button, then iPhone / Android / Computer steps), as a Settings page of
 * its own so an operator who only wants the portal on their phone finds it
 * without going through Notifications. The button opens Chrome's install
 * dialog where there is one; on an iPhone it selects the Safari steps.
 *
 * Listed and usable by every role: installing changes nothing on the account,
 * so the page is never read-only (settings/page.tsx keeps it out of the
 * read-only fieldset).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { useTenant } from "@/contexts/TenantContext";
import { useEmailBrandingV2 } from "@/hooks/use-email-branding-v2";
import { PushInstallGuide } from "./push-install-guide";

export function InstallAppPageV2() {
  const { tenant } = useTenant();
  const branding = useEmailBrandingV2();
  const slug = branding.slug ?? tenant?.slug ?? null;
  const companyName = branding.companyName ?? tenant?.company_name ?? "";

  // The address the guide's pictures show: this portal's real host (a custom
  // domain included), read after mount so server and client HTML agree.
  const [host, setHost] = useState(`${slug ?? "your-company"}.portal.drive-247.com`);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.host) setHost(window.location.host);
  }, []);

  return (
    <div className="space-y-6" data-settings-page="install">
      <PushInstallGuide
        portalHost={host}
        appName={companyName || "Your company"}
        iconUrl={branding.iconUrl ?? null}
        title="On this device"
        intro="Pick your device to see the steps. Each person on your team installs it on their own phone or computer."
      />
      <p className="text-[13px] text-muted-foreground">
        Once installed, open the app from its icon and turn on alerts under{" "}
        <Link href="/settings?tab=push" className="font-medium text-primary underline-offset-2 hover:underline">
          Notifications › Push on this device
        </Link>
        .
      </p>
    </div>
  );
}
