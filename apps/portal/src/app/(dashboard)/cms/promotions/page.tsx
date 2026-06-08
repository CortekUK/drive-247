"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tile, StatusPill, EmptyState, Shimmer, KpiTile } from "@/components/bento";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  History,
  Loader2,
  ListOrdered,
  FileText,
  AlertCircle,
  Search,
  RotateCcw,
  Crown,
  Plus,
  Edit,
  Trash2,
  Tag,
  Calendar,
  Percent,
  DollarSign,
  Image,
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
import { HowItWorksEditor } from "@/components/website-content/how-it-works-editor";
import { TermsEditor } from "@/components/website-content/terms-editor";
import { EmptyStateEditor } from "@/components/website-content/empty-state-editor";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import type {
  HowItWorksContent,
  TermsContent,
  EmptyStateContent,
  SEOContent,
} from "@/types/cms";
import { CMS_DEFAULTS } from "@/constants/website-content";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { format, isBefore, isAfter } from "date-fns";

// Promotion types
interface Promotion {
  id: string;
  title: string;
  description: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  start_date: string;
  end_date: string;
  promo_code: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

const promotionSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  discount_type: z.enum(["percentage", "fixed"]),
  discount_value: z.number().min(0.01, "Discount value must be greater than 0"),
  start_date: z.string().min(1, "Start date is required"),
  end_date: z.string().min(1, "End date is required"),
  promo_code: z.string().optional(),
  image_url: z.string().optional(),
  is_active: z.boolean().default(true),
}).refine((data) => new Date(data.end_date) > new Date(data.start_date), {
  message: "End date must be after start date",
  path: ["end_date"],
});

type PromotionFormValues = z.infer<typeof promotionSchema>;

const defaultFormData: PromotionFormValues = {
  title: "",
  description: "",
  discount_type: "percentage",
  discount_value: 0,
  start_date: "",
  end_date: "",
  promo_code: "",
  image_url: "",
  is_active: true,
};

export default function CMSPromotionsEditor() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { data: page, isLoading } = useCMSPage("promotions");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("promotions");
  const [activeTab, setActiveTab] = useState("manage");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { canEdit } = useManagerPermissions();

  // Promotions management state
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const form = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionSchema),
    defaultValues: defaultFormData,
    mode: "onChange",
  });

  useEffect(() => {
    if (tenant) {
      loadPromotions();
    }
  }, [tenant]);

  const loadPromotions = async () => {
    setPromotionsLoading(true);
    let query = (supabase as any)
      .from("promotions")
      .select("*");

    if (tenant?.id) {
      query = query.eq("tenant_id", tenant.id);
    }

    query = query.order("created_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error("Failed to load promotions:", error);
      toast.error("Failed to load promotions");
    } else {
      setPromotions(data || []);
    }
    setPromotionsLoading(false);
  };

  const getPromotionStatus = (promo: Promotion) => {
    const now = new Date();
    const start = new Date(promo.start_date);
    const end = new Date(promo.end_date);

    if (!promo.is_active) return "inactive";
    if (isAfter(now, end)) return "expired";
    if (isBefore(now, start)) return "scheduled";
    return "active";
  };

  const handleToggleActive = async (id: string, value: boolean) => {
    const oldPromotions = [...promotions];
    setPromotions(promotions.map(p => p.id === id ? { ...p, is_active: value } : p));

    let query = (supabase as any)
      .from("promotions")
      .update({ is_active: value })
      .eq("id", id);

    if (tenant?.id) {
      query = query.eq("tenant_id", tenant.id);
    }

    const { error } = await query;

    if (error) {
      toast.error("Failed to update promotion");
      setPromotions(oldPromotions);
    } else {
      toast.success(`Promotion ${value ? 'activated' : 'deactivated'}`);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please upload an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `promo-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('cms-media')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('cms-media')
        .getPublicUrl(fileName);

      form.setValue("image_url", publicUrl);
      toast.success("Image uploaded");
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (data: PromotionFormValues) => {
    setSaving(true);

    const promoData = {
      title: data.title,
      description: data.description,
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      start_date: data.start_date,
      end_date: data.end_date,
      promo_code: data.promo_code || null,
      image_url: data.image_url || null,
      is_active: data.is_active,
    };

    if (editingPromotion) {
      let updateQuery = (supabase as any)
        .from("promotions")
        .update(promoData)
        .eq("id", editingPromotion.id);

      if (tenant?.id) {
        updateQuery = updateQuery.eq("tenant_id", tenant.id);
      }

      const { error } = await updateQuery;

      if (error) {
        console.error("Update error:", error);
        toast.error(`Failed to update: ${error.message}`);
        setSaving(false);
        return;
      }
      toast.success("Promotion updated");
    } else {
      const { error } = await (supabase as any)
        .from("promotions")
        .insert({
          ...promoData,
          tenant_id: tenant?.id || null,
        });

      if (error) {
        console.error("Insert error:", error);
        toast.error(`Failed to create: ${error.message}`);
        setSaving(false);
        return;
      }
      toast.success("Promotion created");
    }

    setSaving(false);
    setDialogOpen(false);
    resetForm();
    loadPromotions();
  };

  const confirmDelete = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    let deleteQuery = (supabase as any).from("promotions").delete().eq("id", deletingId);

    if (tenant?.id) {
      deleteQuery = deleteQuery.eq("tenant_id", tenant.id);
    }

    const { error } = await deleteQuery;

    if (error) {
      toast.error("Failed to delete promotion");
      return;
    }

    toast.success("Promotion deleted");
    setDeleteDialogOpen(false);
    setDeletingId(null);
    loadPromotions();
  };

  const handleEdit = (promo: Promotion) => {
    setEditingPromotion(promo);
    form.reset({
      title: promo.title,
      description: promo.description,
      discount_type: promo.discount_type as "percentage" | "fixed",
      discount_value: promo.discount_value,
      start_date: promo.start_date.split('T')[0],
      end_date: promo.end_date.split('T')[0],
      promo_code: promo.promo_code || "",
      image_url: promo.image_url || "",
      is_active: promo.is_active,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingPromotion(null);
    form.reset(defaultFormData);
  };

  const filteredPromotions = useMemo(() => {
    let filtered = promotions;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          (p.promo_code && p.promo_code.toLowerCase().includes(query))
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => getPromotionStatus(p) === statusFilter);
    }

    return filtered;
  }, [promotions, searchQuery, statusFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <StatusPill tone="success" dot>Active</StatusPill>;
      case "scheduled":
        return <StatusPill tone="info" dot>Scheduled</StatusPill>;
      case "expired":
        return <StatusPill tone="neutral">Expired</StatusPill>;
      case "inactive":
        return <StatusPill tone="neutral">Inactive</StatusPill>;
      default:
        return null;
    }
  };

  const stats = useMemo(() => {
    const active = promotions.filter(p => getPromotionStatus(p) === "active").length;
    const scheduled = promotions.filter(p => getPromotionStatus(p) === "scheduled").length;
    const expired = promotions.filter(p => getPromotionStatus(p) === "expired").length;
    return { total: promotions.length, active, scheduled, expired };
  }, [promotions]);

  const imageUrl = form.watch("image_url");
  const discountType = form.watch("discount_type");

  const handleResetToDefaults = async () => {
    setIsResetting(true);
    try {
      const defaults = CMS_DEFAULTS.promotions;
      await Promise.all([
        updateSection({ sectionKey: "how_it_works", content: defaults.how_it_works }),
        updateSection({ sectionKey: "empty_state", content: defaults.empty_state }),
        updateSection({ sectionKey: "terms", content: defaults.terms }),
        updateSection({ sectionKey: "seo", content: defaults.seo }),
      ]);
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Shimmer className="h-10 w-64" />
        <Tile noMotion className="space-y-4">
          <Shimmer className="h-10 w-full" />
          <Shimmer className="h-80 w-full" />
        </Tile>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Button variant="ghost" onClick={() => router.push("/cms")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to CMS
        </Button>
        <EmptyState
          icon={<Crown className="h-5 w-5" />}
          title="Promotions page not found in CMS"
          description='Please ensure the "promotions" page is set up in the database.'
        />
      </div>
    );
  }

  // Get section content with defaults
  const getSectionContent = <T,>(key: string, defaultValue: T): T => {
    const section = page.cms_page_sections?.find((s) => s.section_key === key);
    return (section?.content as T) || defaultValue;
  };

  const howItWorksContent = getSectionContent<HowItWorksContent>("how_it_works", {
    title: "",
    subtitle: "",
    steps: [],
  });

  const emptyStateContent = getSectionContent<EmptyStateContent>("empty_state", {
    title_active: "",
    title_default: "",
    description: "",
    button_text: "",
  });

  const termsContent = getSectionContent<TermsContent>("terms", {
    title: "",
    terms: [],
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
    <div className="container mx-auto space-y-6 pt-4 sm:pt-6 px-3 sm:px-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2 sm:gap-4 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push("/cms")} className="shrink-0 h-9 px-2 sm:px-3">
            <ArrowLeft className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl">
              {page.name}
              <StatusPill tone={page.status === "published" ? "success" : "warn"} dot>
                {page.status === "published" ? "Published" : "Draft"}
              </StatusPill>
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
                    This will replace all Promotions page content with Drive 917 default content.
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
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={isPublishing || page.status === "published"}
              className="flex-1 sm:flex-none"
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
      <Tile pad="roomy">
          {!canEdit('cms') && (
            <div className="mb-4 flex items-center gap-2 rounded-tile-sm border border-border [background:var(--bento-tile-2)] p-3 text-sm text-muted-foreground">
              <Eye className="h-4 w-4 shrink-0" />
              You have view-only access to website content.
            </div>
          )}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="manage" className="flex items-center gap-2">
                <Crown className="h-4 w-4" />
                <span className="hidden lg:inline">Manage</span>
              </TabsTrigger>
              <TabsTrigger value="how_it_works" className="flex items-center gap-2">
                <ListOrdered className="h-4 w-4" />
                <span className="hidden lg:inline">How It Works</span>
              </TabsTrigger>
              <TabsTrigger value="empty_state" className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span className="hidden lg:inline">Empty State</span>
              </TabsTrigger>
              <TabsTrigger value="terms" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="hidden lg:inline">Terms</span>
              </TabsTrigger>
              <TabsTrigger value="seo" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden lg:inline">SEO</span>
              </TabsTrigger>
            </TabsList>

            <div className={!canEdit('cms') ? "pointer-events-none select-none" : ""}>
            <div className="mt-6">
              {/* Manage Promotions Tab */}
              <TabsContent value="manage" className="mt-0 space-y-4">
                {/* Add Promotion Button */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Create and manage promotional offers for customers
                  </p>
                  <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                      <Button onClick={resetForm} size="sm" className="w-full sm:w-auto">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Promotion
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>
                          {editingPromotion ? "Edit Promotion" : "Create Promotion"}
                        </DialogTitle>
                      </DialogHeader>
                      <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <FormField
                              control={form.control}
                              name="title"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>Title <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <Input placeholder="Summer Sale - 20% Off" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="description"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>Description <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <Textarea placeholder="Get 20% off on all luxury vehicle rentals..." rows={3} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="discount_type"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Discount Type <span className="text-destructive">*</span></FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="percentage">
                                        <div className="flex items-center gap-2">
                                          <Percent className="h-4 w-4" />
                                          Percentage (%)
                                        </div>
                                      </SelectItem>
                                      <SelectItem value="fixed">
                                        <div className="flex items-center gap-2">
                                          <DollarSign className="h-4 w-4" />
                                          Fixed Amount ($)
                                        </div>
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="discount_value"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Discount Value <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        type="number"
                                        min="0"
                                        step={discountType === "percentage" ? "1" : "0.01"}
                                        className="pl-8"
                                        {...field}
                                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                      />
                                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                        {discountType === "percentage" ? "%" : "$"}
                                      </span>
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="start_date"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Start Date <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <Input type="date" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="end_date"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>End Date <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <Input type="date" min={form.watch("start_date")} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="promo_code"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>Promo Code (Optional)</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                      <Input
                                        placeholder="SUMMER20"
                                        className="pl-10 uppercase"
                                        {...field}
                                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                      />
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className="space-y-2 md:col-span-2">
                              <FormLabel>Promotion Image (Optional)</FormLabel>
                              {imageUrl ? (
                                <div className="relative">
                                  <img src={imageUrl} alt="Promotion" className="w-full h-32 object-cover rounded-lg border" />
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    className="absolute top-2 right-2"
                                    onClick={() => form.setValue("image_url", "")}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ) : (
                                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                                  <Image className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                                  <p className="text-sm text-muted-foreground mb-2">Upload promotion image</p>
                                  <Input
                                    id="promo-image"
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleImageUpload(file);
                                    }}
                                    disabled={uploading}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => document.getElementById('promo-image')?.click()}
                                    disabled={uploading}
                                  >
                                    {uploading ? (
                                      <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Uploading...
                                      </>
                                    ) : (
                                      "Choose File"
                                    )}
                                  </Button>
                                </div>
                              )}
                            </div>

                            <FormField
                              control={form.control}
                              name="is_active"
                              render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-2 space-y-0 md:col-span-2">
                                  <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                  </FormControl>
                                  <FormLabel>Active</FormLabel>
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="flex gap-3 pt-2">
                            <Button type="submit" disabled={!form.formState.isValid || saving}>
                              {saving ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                editingPromotion ? "Update Promotion" : "Create Promotion"
                              )}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                              Cancel
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <KpiTile label="Total" value={stats.total} icon={<Crown className="h-4 w-4" />} />
                  <KpiTile
                    label="Active"
                    value={stats.active}
                    sub={<span className="text-[color:var(--bento-success)]">Live now</span>}
                  />
                  <KpiTile
                    label="Scheduled"
                    value={stats.scheduled}
                    sub={<span className="text-[color:var(--bento-info)]">Upcoming</span>}
                  />
                  <KpiTile label="Expired" value={stats.expired} sub="Past" />
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search promotions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-48">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Promotions List */}
                {promotionsLoading ? (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[...Array(6)].map((_, i) => (
                      <Tile key={i} noMotion className="space-y-3">
                        <Shimmer className="aspect-video w-full" />
                        <Shimmer className="h-4 w-3/4" />
                        <Shimmer className="h-3 w-full" />
                        <Shimmer className="h-8 w-full" />
                      </Tile>
                    ))}
                  </div>
                ) : filteredPromotions.length === 0 ? (
                  <EmptyState
                    icon={<Crown className="h-5 w-5" />}
                    title="No promotions found"
                    description={
                      searchQuery || statusFilter !== "all"
                        ? "Try adjusting your filters"
                        : "Create your first promotion to get started"
                    }
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredPromotions.map((promo) => {
                      const status = getPromotionStatus(promo);
                      const discountLabel =
                        promo.discount_type === "percentage"
                          ? `${promo.discount_value}% OFF`
                          : `$${promo.discount_value} OFF`;
                      return (
                        <Tile key={promo.id} pad="none" className="flex flex-col overflow-hidden">
                          {promo.image_url ? (
                            <div className="relative aspect-video">
                              <img src={promo.image_url} alt={promo.title} className="h-full w-full object-cover" />
                              <div className="absolute top-2 right-2">{getStatusBadge(status)}</div>
                              <div className="absolute top-2 left-2">
                                <StatusPill tone="primary" className="font-mono">{discountLabel}</StatusPill>
                              </div>
                            </div>
                          ) : (
                            <div className="relative flex aspect-video items-center justify-center [background:var(--bento-tile-2)]">
                              <Crown className="h-12 w-12 text-[color:var(--bento-text-3)]/40" />
                              <div className="absolute top-2 right-2">{getStatusBadge(status)}</div>
                              <div className="absolute top-2 left-2">
                                <StatusPill tone="primary" className="font-mono">{discountLabel}</StatusPill>
                              </div>
                            </div>
                          )}
                          <div className="flex flex-1 flex-col p-4">
                            <h3 className="mb-1 line-clamp-1 font-bold tracking-tight">{promo.title}</h3>
                            <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{promo.description}</p>
                            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span className="font-mono tabular-nums">
                                {format(new Date(promo.start_date), "MMM d")} - {format(new Date(promo.end_date), "MMM d, yyyy")}
                              </span>
                            </div>
                            {promo.promo_code && (
                              <div className="mb-3 flex items-center gap-2">
                                <Tag className="h-3 w-3 text-primary" />
                                <code className="rounded-tile-sm [background:var(--bento-primary-weak)] px-2 py-1 font-mono text-xs text-[color:var(--bento-primary-weak-fg)]">{promo.promo_code}</code>
                              </div>
                            )}
                            <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={promo.is_active}
                                  onCheckedChange={(checked) => handleToggleActive(promo.id, checked)}
                                />
                                <span className="text-xs text-muted-foreground">
                                  {promo.is_active ? "Active" : "Inactive"}
                                </span>
                              </div>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEdit(promo)}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => confirmDelete(promo.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Tile>
                      );
                    })}
                  </div>
                )}

                {/* Delete Confirmation Dialog */}
                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this promotion?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This promotion will be permanently removed. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TabsContent>

              <TabsContent value="how_it_works" className="mt-0">
                <HowItWorksEditor
                  content={howItWorksContent}
                  onSave={(content) => updateSection({ sectionKey: "how_it_works", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="empty_state" className="mt-0">
                <EmptyStateEditor
                  content={emptyStateContent}
                  onSave={(content) => updateSection({ sectionKey: "empty_state", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="terms" className="mt-0">
                <TermsEditor
                  content={termsContent}
                  onSave={(content) => updateSection({ sectionKey: "terms", content })}
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
            </div>
            </div>
          </Tabs>
      </Tile>

      {/* Version History Dialog */}
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="promotions"
      />
    </div>
  );
}
