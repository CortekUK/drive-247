"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Upload,
  History,
  CheckCircle,
  Clock,
  Loader2,
  FileText,
  Search,
} from "lucide-react";
import { LegalPageEditor } from "@/components/website-content/legal-page-editor";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import type { TermsOfServiceContent, SEOContent } from "@/types/cms";

export default function CMSTermsEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("terms");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("terms");
  const [activeTab, setActiveTab] = useState("content");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

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
            <p className="text-muted-foreground">Terms of Service page not found in CMS.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please ensure the "terms" page is set up in the database.
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

  const termsContent = getSectionContent<TermsOfServiceContent>("terms_content", {
    title: "",
    content: "",
    last_updated: "",
  });

  const seoContent = getSectionContent<SEOContent>("seo", {
    title: "",
    description: "",
    keywords: "",
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

      {/* Editor Tabs */}
      <Card>
        <CardContent className="pt-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="content" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Content
              </TabsTrigger>
              <TabsTrigger value="seo" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                SEO
              </TabsTrigger>
            </TabsList>

            <div className="mt-6">
              <TabsContent value="content" className="mt-0">
                <LegalPageEditor
                  content={termsContent}
                  onSave={(content) => updateSection({ sectionKey: "terms_content", content })}
                  isSaving={isUpdating}
                  pageTitle="Terms of Service Content"
                  pageDescription="Edit the terms of service page content using the rich text editor below."
                />
              </TabsContent>

              <TabsContent value="seo" className="mt-0">
                <SEOEditor
                  content={seoContent}
                  onSave={(content) => updateSection({ sectionKey: "seo", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>

      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="terms"
      />
    </div>
  );
}
