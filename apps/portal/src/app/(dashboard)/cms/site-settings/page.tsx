"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
import { useTenant } from "@/contexts/TenantContext";
import { syncTenantLogoColumns } from "@/lib/tenant-logo-sync";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Upload,
  History,
  CheckCircle,
  Clock,
  Loader2,
  Settings,
  RotateCcw,
  Eye,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SiteSettingsEditor } from "@/components/website-content/site-settings-editor";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import type { LogoContent, SiteContactContent, SocialLinksContent, FooterContent } from "@/types/cms";
import { CMS_DEFAULTS } from "@/constants/website-content";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

export default function CMSSiteSettingsEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("site-settings");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, updateSectionAsync, isUpdating } = useCMSPageSections("site-settings");
  const { tenant, refetchTenant } = useTenant();
  const queryClient = useQueryClient();
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { canEdit } = useManagerPermissions();

  /**
   * Save a section WITHOUT knocking the page off the live site.
   *
   * updateSection unconditionally demotes cms_pages.status to "draft"
   * (use-cms-page-sections.ts), and the booking site only applies this page when
   * it is published — so editing one field used to silently revert every other
   * published field (footer tagline, copyright, formatted phone) until someone
   * noticed the Draft badge and pressed Publish. Re-publishing here restores it.
   *
   * A page that was already a draft STAYS a draft: publishing content the tenant
   * never chose to publish would be a worse bug than the one being fixed.
   *
   * Deliberately not fixed by removing the demotion from the shared hook —
   * version snapshots are only written on publish, so saves must keep flowing
   * through it or History/restore silently stops accumulating.
   */
  // `Record<string, any>` mirrors updateSection's own parameter type. `unknown`
  // would reject the CMS content interfaces, which have no index signature.
  const saveSection = async (sectionKey: string, content: Record<string, any>) => {
    // Row identity matters, not just status: `page` may be the SHARED GLOBAL row while the write lands on a freshly created tenant row. Publishing off the global row's status would push live a page this tenant never chose to publish.
    const wasPublished =
      page?.status === "published" && page?.tenant_id === (tenant?.id ?? null);
    // Publish the row that was ACTUALLY written, not the one this component
    // happens to be rendering. getPageBySlug may resolve (or newly create) a
    // tenant-owned row that differs from `page`, and publishing the wrong id
    // updates zero rows while still reporting success — leaving the row that
    // holds the new content stuck in draft forever.
    const savedPageId = await updateSectionAsync({ sectionKey, content });
    if (wasPublished && savedPageId) {
      publishPage(savedPageId);
    }
  };

  const handleResetToDefaults = async () => {
    setIsResetting(true);
    try {
      const defaults = CMS_DEFAULTS.siteSettings;
      await Promise.all([
        updateSection({ sectionKey: "logo", content: defaults.logo }),
        updateSection({ sectionKey: "contact", content: defaults.contact }),
        updateSection({ sectionKey: "social", content: defaults.social }),
        updateSection({ sectionKey: "footer", content: defaults.footer }),
      ]);
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push("/cms")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to CMS
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Site Settings page not found in CMS.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please run the SQL migration to set up the "site-settings" page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getSectionContent = <T,>(key: string, defaultValue: T): T => {
    const section = page.cms_page_sections?.find((s) => s.section_key === key);
    return (section?.content as T) || defaultValue;
  };

  const logoContent = getSectionContent<LogoContent>("logo", {
    logo_url: "",
    logo_alt: "Drive 247",
    favicon_url: "",
  });

  const contactContent = getSectionContent<SiteContactContent>("contact", {
    phone: "+19725156635",
    phone_display: "(972) 515-6635",
    email: "info@drive247.com",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
    country: "USA",
    google_maps_url: "",
  });

  const socialContent = getSectionContent<SocialLinksContent>("social", {
    facebook: "",
    instagram: "",
    twitter: "",
    linkedin: "",
    youtube: "",
    tiktok: "",
  });

  const footerContent = getSectionContent<FooterContent>("footer", {
    copyright_text: `© ${new Date().getFullYear()} Drive 247. All rights reserved.`,
    tagline: "Premium Car Rentals",
  });

  const handlePublish = () => {
    if (page?.id) {
      publishPage(page.id);
    }
  };

  return (
    <div className="container mx-auto space-y-6 pt-4 sm:pt-6 px-3 sm:px-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2 sm:gap-4 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push("/cms")} className="shrink-0 h-9 px-2 sm:px-3">
            <ArrowLeft className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-display font-bold flex flex-wrap items-center gap-2">
              <Settings className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
              {page.name}
              <Badge
                variant={page.status === "published" ? "default" : "secondary"}
                className={page.status === "published" ? "bg-green-500/20 text-green-600" : ""}
              >
                {page.status === "published" ? <CheckCircle className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                {page.status === "published" ? "Published" : "Draft"}
              </Badge>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">{page.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit('cms') && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={isResetting} className="flex-1 sm:flex-none">
                  {isResetting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                  <span className="hidden sm:inline">Set to Default</span>
                  <span className="sm:hidden">Default</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset to Default Content?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will replace all Site Settings with Drive 247 default content.
                    This action cannot be undone, but you can restore previous versions from the History.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetToDefaults}>
                    Reset to Defaults
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="outline" size="sm" onClick={() => setVersionHistoryOpen(true)} className="flex-1 sm:flex-none">
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
          {canEdit('cms') && (
            <Button size="sm" onClick={handlePublish} disabled={isPublishing || page.status === "published"} className="flex-1 sm:flex-none">
              {isPublishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {page.status === "published" ? "Published" : "Publish"}
            </Button>
          )}
        </div>
      </div>

      {/* Editor */}
      <Card>
        <CardContent className="pt-6">
          {!canEdit('cms') && (
            <div className="mb-4 p-3 bg-muted/50 border rounded-lg flex items-center gap-2 text-sm text-muted-foreground">
              <Eye className="h-4 w-4 shrink-0" />
              You have view-only access to website content.
            </div>
          )}
          <div className={!canEdit('cms') ? "pointer-events-none select-none" : ""}>
          <SiteSettingsEditor
            logo={logoContent}
            contact={contactContent}
            social={socialContent}
            footer={footerContent}
            onSaveLogo={async (content) => {
              // Remember whether the page was LIVE before we write.
              //
              // updateSection unconditionally demotes the page to draft
              // (use-cms-page-sections.ts:73). That is fine for a page that was
              // already a draft, but on a published page it would take the whole
              // site-settings override off the live site as a side effect of
              // uploading a logo — the tenant's footer tagline and copyright
              // would silently revert while they were only changing an image.
              // Re-publishing below restores it. Deliberately NOT fixed by
              // removing the demotion in the shared hook: version snapshots are
              // only written on publish, so saves must keep going through it.
              // Row identity matters, not just status: `page` may be the SHARED GLOBAL row while the write lands on a freshly created tenant row. Publishing off the global row's status would push live a page this tenant never chose to publish.
              const wasPublished =
                page?.status === "published" && page?.tenant_id === (tenant?.id ?? null);

              // Capture the row actually written — getPageBySlug may resolve or
              // create a tenant-owned row different from the rendered `page`.
              const savedPageId = await updateSectionAsync({ sectionKey: "logo", content });

              // Write through to the tenants row as well.
              //
              // The CMS section alone is not enough to change the visible logo:
              // the booking site only reads this page when it is PUBLISHED, and
              // even then its header/footer resolve `dark_logo_url || logo_url`,
              // so a stale dark column shadows the CMS value. Every other
              // branded surface (portal sidebar, login, invoices, e-sign PDFs,
              // emails, favicon) reads tenants.* and never looks at the CMS at
              // all. Mirroring here is what makes uploading from this screen
              // behave the same as uploading from Settings -> Branding.
              if (tenant?.id && content.logo_url) {
                const result = await syncTenantLogoColumns(tenant.id, content.logo_url);
                if (result.ok) {
                  queryClient.invalidateQueries({ queryKey: ["tenant-branding", tenant.id] });
                  await refetchTenant();
                } else {
                  // The CMS section still saved; only the mirror failed. Say so
                  // rather than letting the logo look updated everywhere.
                  toast({
                    title: "Logo saved, but not applied everywhere",
                    description: `Your site content was saved, but the site-wide logo could not be updated (${result.reason}). Try Settings → Branding.`,
                    variant: "destructive",
                  });
                }
              }

              // Put the page back live if it was live. A logo upload must never
              // be the reason a tenant's published content disappears.
              if (wasPublished && savedPageId) {
                publishPage(savedPageId);
              }
            }}
            onSaveContact={(content) => saveSection("contact", content)}
            onSaveSocial={(content) => saveSection("social", content)}
            onSaveFooter={(content) => saveSection("footer", content)}
            isSaving={isUpdating}
          />
          </div>
        </CardContent>
      </Card>

      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="site-settings"
      />
    </div>
  );
}
