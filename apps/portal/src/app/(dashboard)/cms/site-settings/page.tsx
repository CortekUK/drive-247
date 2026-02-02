"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
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

export default function CMSSiteSettingsEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("site-settings");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("site-settings");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

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
    city: "Dallas",
    state: "TX",
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
    tagline: "Premium Car Rentals in Dallas",
  });

  const handlePublish = () => {
    if (page?.id) {
      publishPage(page.id);
    }
  };

  return (
    <div className="space-y-6 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push("/cms")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold flex items-center gap-2">
              <Settings className="h-6 w-6 text-primary" />
              {page.name}
              <Badge
                variant={page.status === "published" ? "default" : "secondary"}
                className={page.status === "published" ? "bg-green-500/20 text-green-600" : ""}
              >
                {page.status === "published" ? <CheckCircle className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                {page.status === "published" ? "Published" : "Draft"}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">{page.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={isResetting}>
                {isResetting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                Set to Default
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
          <Button variant="outline" onClick={() => setVersionHistoryOpen(true)}>
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
          <Button onClick={handlePublish} disabled={isPublishing || page.status === "published"}>
            {isPublishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {page.status === "published" ? "Published" : "Publish"}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <Card>
        <CardContent className="pt-6">
          <SiteSettingsEditor
            logo={logoContent}
            contact={contactContent}
            social={socialContent}
            footer={footerContent}
            onSaveLogo={(content) => updateSection({ sectionKey: "logo", content })}
            onSaveContact={(content) => updateSection({ sectionKey: "contact", content })}
            onSaveSocial={(content) => updateSection({ sectionKey: "social", content })}
            onSaveFooter={(content) => updateSection({ sectionKey: "footer", content })}
            isSaving={isUpdating}
          />
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
