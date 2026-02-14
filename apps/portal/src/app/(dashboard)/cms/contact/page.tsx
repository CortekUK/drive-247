"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Save,
  Upload,
  History,
  CheckCircle,
  Clock,
  Loader2,
  LayoutTemplate,
  Phone,
  MessageSquare,
  Shield,
  Search,
  Smartphone,
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
import { HeroSectionEditor } from "@/components/website-content/hero-section-editor";
import { ContactInfoEditor } from "@/components/website-content/contact-info-editor";
import { ContactFormEditor } from "@/components/website-content/contact-form-editor";
import { TrustBadgesEditor } from "@/components/website-content/trust-badges-editor";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { PWAInstallEditor } from "@/components/website-content/pwa-install-editor";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import type {
  HeroContent,
  ContactInfoContent,
  ContactFormContent,
  TrustBadgesContent,
  SEOContent,
  PWAInstallContent,
} from "@/types/cms";
import { CMS_DEFAULTS } from "@/constants/website-content";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

export default function CMSContactEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("contact");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("contact");
  const [activeTab, setActiveTab] = useState("hero");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { canEdit } = useManagerPermissions();

  const handleResetToDefaults = async () => {
    setIsResetting(true);
    try {
      const defaults = CMS_DEFAULTS.contact;
      await Promise.all([
        updateSection({ sectionKey: "hero", content: defaults.hero }),
        updateSection({ sectionKey: "contact_info", content: defaults.contact_info }),
        updateSection({ sectionKey: "contact_form", content: defaults.contact_form }),
        updateSection({ sectionKey: "trust_badges", content: defaults.trust_badges }),
        updateSection({ sectionKey: "seo", content: defaults.seo }),
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
            <p className="text-muted-foreground">Contact page not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get section content with defaults
  const getSectionContent = <T,>(key: string, defaultValue: T): T => {
    const section = page.cms_page_sections?.find((s) => s.section_key === key);
    return (section?.content as T) || defaultValue;
  };

  const heroContent = getSectionContent<HeroContent>("hero", {
    title: "",
    subtitle: "",
  });

  const contactInfoContent = getSectionContent<ContactInfoContent>("contact_info", {
    phone: { number: "", availability: "" },
    email: { address: "", response_time: "" },
    office: { address: "" },
    whatsapp: { number: "", description: "" },
  });

  const contactFormContent = getSectionContent<ContactFormContent>("contact_form", {
    title: "",
    subtitle: "",
    success_message: "",
    gdpr_text: "",
    submit_button_text: "",
    subject_options: [],
  });

  const trustBadgesContent = getSectionContent<TrustBadgesContent>("trust_badges", {
    badges: [],
  });

  const seoContent = getSectionContent<SEOContent>("seo", {
    title: "",
    description: "",
    keywords: "",
  });

  const pwaInstallContent = getSectionContent<PWAInstallContent>("pwa_install", {
    title: "",
    description: "",
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
              {page.name}
              <Badge
                variant={page.status === "published" ? "default" : "secondary"}
                className={
                  page.status === "published"
                    ? "bg-green-500/20 text-green-600"
                    : ""
                }
              >
                {page.status === "published" ? (
                  <CheckCircle className="h-3 w-3 mr-1" />
                ) : (
                  <Clock className="h-3 w-3 mr-1" />
                )}
                {page.status === "published" ? "Published" : "Draft"}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">{page.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit('cms') && (
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
                    This will replace all Contact page content with Drive 917 default content.
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
          <Button variant="outline" onClick={() => setVersionHistoryOpen(true)}>
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
          {canEdit('cms') && (
            <Button
              onClick={handlePublish}
              disabled={isPublishing || page.status === "published"}
            >
              {isPublishing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {page.status === "published" ? "Published" : "Publish"}
            </Button>
          )}
        </div>
      </div>

      {/* Editor Tabs */}
      <Card>
        <CardContent className="pt-6">
          {!canEdit('cms') && (
            <div className="mb-4 p-3 bg-muted/50 border rounded-lg flex items-center gap-2 text-sm text-muted-foreground">
              <Eye className="h-4 w-4 shrink-0" />
              You have view-only access to website content.
            </div>
          )}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="hero" className="flex items-center gap-2">
                <LayoutTemplate className="h-4 w-4" />
                <span className="hidden sm:inline">Hero</span>
              </TabsTrigger>
              <TabsTrigger value="contact_info" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                <span className="hidden sm:inline">Contact Info</span>
              </TabsTrigger>
              <TabsTrigger value="form" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Form</span>
              </TabsTrigger>
              <TabsTrigger value="badges" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline">Trust Badges</span>
              </TabsTrigger>
              <TabsTrigger value="seo" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">SEO</span>
              </TabsTrigger>
              <TabsTrigger value="pwa" className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                <span className="hidden sm:inline">PWA</span>
              </TabsTrigger>
            </TabsList>

            <div className={!canEdit('cms') ? "pointer-events-none select-none" : ""}>
            <div className="mt-6">
              <TabsContent value="hero" className="mt-0">
                <HeroSectionEditor
                  content={heroContent}
                  onSave={(content) => updateSection({ sectionKey: "hero", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="contact_info" className="mt-0">
                <ContactInfoEditor
                  content={contactInfoContent}
                  onSave={(content) => updateSection({ sectionKey: "contact_info", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="form" className="mt-0">
                <ContactFormEditor
                  content={contactFormContent}
                  onSave={(content) => updateSection({ sectionKey: "contact_form", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="badges" className="mt-0">
                <TrustBadgesEditor
                  content={trustBadgesContent}
                  onSave={(content) => updateSection({ sectionKey: "trust_badges", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="seo" className="mt-0">
                <SEOEditor
                  content={seoContent}
                  onSave={(content) => updateSection({ sectionKey: "seo", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="pwa" className="mt-0">
                <PWAInstallEditor
                  content={pwaInstallContent}
                  onSave={(content) => updateSection({ sectionKey: "pwa_install", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>
            </div>
            </div>
          </Tabs>
        </CardContent>
      </Card>

      {/* Version History Dialog */}
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="contact"
      />
    </div>
  );
}
