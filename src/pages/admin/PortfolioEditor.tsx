import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Save,
  Eye,
  Upload,
  X,
  Star,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface PortfolioImage {
  id?: string;
  portfolio_id?: string;
  image_url: string;
  caption?: string;
  alt_text: string;
  display_order: number;
  is_cover: boolean;
  is_visible: boolean;
}

export default function PortfolioEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // Form state
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [serviceType, setServiceType] = useState("chauffeur");
  const [vehicleUsed, setVehicleUsed] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [duration, setDuration] = useState("");
  const [specialRequirements, setSpecialRequirements] = useState("");
  const [testimonialQuote, setTestimonialQuote] = useState("");
  const [testimonialAuthor, setTestimonialAuthor] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [status, setStatus] = useState("draft");
  const [isFeatured, setIsFeatured] = useState(false);
  const [isConfidential, setIsConfidential] = useState(false);
  const [hidePrice, setHidePrice] = useState(false);
  const [showOnChauffeurPage, setShowOnChauffeurPage] = useState(false);
  const [showOnCloseProtectionPage, setShowOnCloseProtectionPage] = useState(false);

  // Images state
  const [images, setImages] = useState<PortfolioImage[]>([]);
  const [editingImage, setEditingImage] = useState<PortfolioImage | null>(null);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);

  useEffect(() => {
    if (isEditMode) {
      loadPortfolioItem();
    }
  }, [id]);

  useEffect(() => {
    if (!isEditMode && title && !slug) {
      generateSlug(title);
    }
  }, [title]);

  const loadPortfolioItem = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("portfolio")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      setTitle(data.title);
      setSlug(data.slug);
      setSummary(data.summary);
      setFullDescription(data.full_description || "");
      setServiceType(data.service_type);
      setVehicleUsed(data.vehicle_used || "");
      setLocation(data.location);
      setEventDate(data.event_date);
      setDuration(data.duration || "");
      setSpecialRequirements(data.special_requirements || "");
      setTestimonialQuote(data.testimonial_quote || "");
      setTestimonialAuthor(data.testimonial_author || "");
      setPriceRange(data.price_range || "");
      setStatus(data.status || "draft");
      setIsFeatured(data.is_featured);
      setIsConfidential(data.is_confidential || false);
      setHidePrice(data.hide_price || false);
      setShowOnChauffeurPage(data.show_on_chauffeur_page || false);
      setShowOnCloseProtectionPage(data.show_on_close_protection_page || false);

      loadImages();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadImages = async () => {
    if (!id) return;
    
    try {
      const { data, error } = await supabase
        .from("portfolio_images")
        .select("*")
        .eq("portfolio_id", id)
        .order("display_order");

      if (error) throw error;
      setImages(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading images",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const generateSlug = (text: string) => {
    const newSlug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    setSlug(newSlug);
  };

  const handleImageUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadProgress(0);
    const uploadedImages: PortfolioImage[] = [];
    const totalFiles = files.length;

    try {
      const { data: { user } } = await supabase.auth.getUser();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(((i + 1) / totalFiles) * 100);
        
        // Validate file size (10MB max)
        if (file.size > 10 * 1024 * 1024) {
          toast({
            title: "File too large",
            description: `${file.name} exceeds 10MB limit`,
            variant: "destructive",
          });
          continue;
        }

        // Validate file type
        if (!file.type.startsWith("image/")) {
          toast({
            title: "Invalid file type",
            description: `${file.name} is not an image`,
            variant: "destructive",
          });
          continue;
        }

        const fileExt = file.name.split(".").pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("portfolio-images")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("portfolio-images")
          .getPublicUrl(filePath);

        uploadedImages.push({
          image_url: publicUrl,
          alt_text: file.name.replace(/\.[^/.]+$/, ""),
          display_order: images.length + i,
          is_cover: images.length === 0 && i === 0,
          is_visible: true,
        });
      }

      // If in edit mode, save images to database immediately
      if (isEditMode && id && uploadedImages.length > 0) {
        const imagesToInsert = uploadedImages.map((img) => ({
          portfolio_id: id,
          image_url: img.image_url,
          caption: img.caption || null,
          alt_text: img.alt_text,
          display_order: img.display_order,
          is_cover: img.is_cover,
          is_visible: img.is_visible,
          uploaded_by: user?.id,
        }));

        const { error: insertError } = await supabase
          .from("portfolio_images")
          .insert(imagesToInsert);

        if (insertError) throw insertError;

        // Reload images from database to get proper IDs
        await loadImages();

        toast({
          title: "Success",
          description: `Uploaded and saved ${uploadedImages.length} images`,
        });
      } else {
        // For new portfolio items, just add to local state
        setImages([...images, ...uploadedImages]);
        toast({
          title: "Success",
          description: `Uploaded ${uploadedImages.length} images (will be saved with portfolio)`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleSave = async (publish: boolean = false) => {
    // Validation
    if (!title || !slug || !summary || !serviceType || !location || !eventDate) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }


    if (images.filter(img => img.is_cover).length === 0 && images.length > 0) {
      toast({
        title: "Validation Error",
        description: "Please mark one image as cover image",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const portfolioData = {
        title,
        slug,
        summary,
        full_description: fullDescription,
        service_type: serviceType,
        vehicle_used: vehicleUsed || null,
        location,
        event_date: eventDate,
        duration: duration || null,
        special_requirements: specialRequirements || null,
        testimonial_quote: testimonialQuote || null,
        testimonial_author: testimonialAuthor || null,
        price_range: priceRange || null,
        status: publish ? "published" : status,
        is_featured: isFeatured,
        is_confidential: isConfidential,
        hide_price: hidePrice,
        show_on_chauffeur_page: showOnChauffeurPage,
        show_on_close_protection_page: showOnCloseProtectionPage,
        last_edited_by: user?.id,
        last_edited_at: new Date().toISOString(),
        published_at: publish ? new Date().toISOString() : null,
        cover_image_url: images.find(img => img.is_cover)?.image_url || images[0]?.image_url || "",
        is_active: true,
      };

      let portfolioId = id;

      if (isEditMode) {
        const { error } = await supabase
          .from("portfolio")
          .update(portfolioData)
          .eq("id", id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("portfolio")
          .insert(portfolioData)
          .select()
          .single();

        if (error) throw error;
        portfolioId = data.id;
      }

      // Save images
      if (portfolioId) {
        // Delete existing images if editing
        if (isEditMode) {
          await supabase
            .from("portfolio_images")
            .delete()
            .eq("portfolio_id", portfolioId);
        }

        // Insert new images
        if (images.length > 0) {
          const imagesToInsert = images.map((img, index) => ({
            portfolio_id: portfolioId,
            image_url: img.image_url,
            caption: img.caption || null,
            alt_text: img.alt_text,
            display_order: index,
            is_cover: img.is_cover,
            is_visible: img.is_visible,
            uploaded_by: user?.id,
          }));

          const { error: imagesError } = await supabase
            .from("portfolio_images")
            .insert(imagesToInsert);

          if (imagesError) throw imagesError;
        }
      }

      toast({
        title: "Success",
        description: publish ? "Portfolio item published" : "Portfolio item saved as draft",
      });

      navigate("/admin/portfolio");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const summaryCharCount = summary.length;

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6 space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </Card>
          </div>
          <div className="space-y-6">
            <Card className="p-6">
              <Skeleton className="h-48 w-full" />
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRight className="w-4 h-4" />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/portfolio">Portfolio</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRight className="w-4 h-4" />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbPage>{isEditMode ? "Edit" : "New"} Case Study</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/admin/portfolio")}
            className="hover:bg-accent/10"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-4xl font-display font-bold text-gradient-metal">
              {isEditMode ? "Edit" : "New"} Case Study
            </h1>
            <p className="text-base text-muted-foreground">
              {isEditMode ? "Update your portfolio showcase" : "Create a portfolio showcase"}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={saving}
            className="hover:bg-accent/10 hover:border-accent transition-all"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Draft
          </Button>
          <Button 
            onClick={() => handleSave(true)} 
            disabled={saving}
            className="shadow-glow hover:shadow-[0_0_40px_rgba(255,215,0,0.4)] transition-all"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            Publish
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 space-y-4 bg-card/50 backdrop-blur-sm border-border/50">
            <div className="flex items-center gap-2 pb-2 border-b border-accent/20">
              <div className="h-1 w-8 bg-gradient-to-r from-accent to-transparent" />
              <h2 className="text-xl font-display font-semibold">Basic Information</h2>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Royal Wedding Transportation"
                className="focus:ring-2 focus:ring-accent transition-all"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">
                URL Slug <span className="text-destructive">*</span>
              </Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="royal-wedding-transportation"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="summary">
                Summary <span className="text-destructive">*</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  ({summaryCharCount} chars)
                </span>
              </Label>
              <Textarea
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Brief summary for SEO and preview cards"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Full Description</Label>
              <Textarea
                id="description"
                value={fullDescription}
                onChange={(e) => setFullDescription(e.target.value)}
                placeholder="Detailed project description"
                rows={8}
              />
            </div>
          </Card>

          <Card className="p-6 space-y-4 bg-card/50 backdrop-blur-sm border-border/50">
            <div className="flex items-center gap-2 pb-2 border-b border-accent/20">
              <div className="h-1 w-8 bg-gradient-to-r from-accent to-transparent" />
              <h2 className="text-xl font-display font-semibold">Classification</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="serviceType">
                  Service Type <span className="text-destructive">*</span>
                </Label>
                <Select value={serviceType} onValueChange={setServiceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chauffeur">Chauffeur</SelectItem>
                    <SelectItem value="close_protection">
                      Close Protection
                    </SelectItem>
                    <SelectItem value="both">Both Services</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vehicle">Vehicle Used</Label>
                <Input
                  id="vehicle"
                  value={vehicleUsed}
                  onChange={(e) => setVehicleUsed(e.target.value)}
                  placeholder="e.g. Rolls-Royce Phantom"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">
                  Location <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. London, UK"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="eventDate">
                  Event Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="eventDate"
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration</Label>
              <Input
                id="duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 3 hours, Full day"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="requirements">Special Requirements</Label>
              <Textarea
                id="requirements"
                value={specialRequirements}
                onChange={(e) => setSpecialRequirements(e.target.value)}
                placeholder="Any special requirements or notes"
                rows={3}
              />
            </div>
          </Card>

          <Card className="p-6 space-y-4 bg-card/50 backdrop-blur-sm border-border/50">
            <div className="flex items-center gap-2 pb-2 border-b border-accent/20">
              <div className="h-1 w-8 bg-gradient-to-r from-accent to-transparent" />
              <h2 className="text-xl font-display font-semibold">Testimonial (Optional)</h2>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quote">Quote</Label>
              <Textarea
                id="quote"
                value={testimonialQuote}
                onChange={(e) => setTestimonialQuote(e.target.value)}
                placeholder="Customer testimonial"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="author">Author Name</Label>
              <Input
                id="author"
                value={testimonialAuthor}
                onChange={(e) => setTestimonialAuthor(e.target.value)}
                placeholder="e.g. John Smith, CEO"
              />
            </div>
          </Card>

          <Card className="p-6 space-y-4 bg-card/50 backdrop-blur-sm border-border/50">
            <div className="flex items-center gap-2 pb-2 border-b border-accent/20">
              <div className="h-1 w-8 bg-gradient-to-r from-accent to-transparent" />
              <h2 className="text-xl font-display font-semibold">Visibility & Features</h2>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Featured</Label>
                <p className="text-sm text-muted-foreground">
                  Show on homepage widget
                </p>
              </div>
              <Switch checked={isFeatured} onCheckedChange={setIsFeatured} />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Confidential</Label>
                <p className="text-sm text-muted-foreground">
                  Apply blur to sensitive details
                </p>
              </div>
              <Switch
                checked={isConfidential}
                onCheckedChange={setIsConfidential}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Hide Price</Label>
                <p className="text-sm text-muted-foreground">
                  Don't display pricing information
                </p>
              </div>
              <Switch checked={hidePrice} onCheckedChange={setHidePrice} />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Show on Chauffeur Page</Label>
                <p className="text-sm text-muted-foreground">
                  Display in chauffeur services carousel
                </p>
              </div>
              <Switch
                checked={showOnChauffeurPage}
                onCheckedChange={setShowOnChauffeurPage}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Show on Close Protection Page</Label>
                <p className="text-sm text-muted-foreground">
                  Display in close protection carousel
                </p>
              </div>
              <Switch
                checked={showOnCloseProtectionPage}
                onCheckedChange={setShowOnCloseProtectionPage}
              />
            </div>

            {!hidePrice && (
              <div className="space-y-2">
                <Label htmlFor="priceRange">Price Range</Label>
                <Input
                  id="priceRange"
                  value={priceRange}
                  onChange={(e) => setPriceRange(e.target.value)}
                  placeholder="e.g. $1,500 - $3,000"
                />
              </div>
            )}
          </Card>
        </div>

        {/* Right Panel - Images */}
        <div className="space-y-6">
          <Card className="p-6 space-y-4 bg-card/50 backdrop-blur-sm border-border/50">
            <div className="flex items-center gap-2 pb-2 border-b border-accent/20">
              <div className="h-1 w-8 bg-gradient-to-r from-accent to-transparent" />
              <h2 className="text-xl font-display font-semibold">Images</h2>
            </div>

            {/* Upload Zone */}
            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all duration-300 group"
              onClick={() => document.getElementById("image-upload")?.click()}
            >
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-accent to-accent/60 opacity-0 group-hover:opacity-20 blur-2xl rounded-full transition-all" />
                <Upload className="relative mx-auto h-12 w-12 text-muted-foreground group-hover:text-accent transition-colors mb-4" />
              </div>
              <p className="text-sm text-muted-foreground mb-2 group-hover:text-foreground transition-colors">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground">
                JPG, PNG, WEBP up to 10MB
              </p>
              <input
                id="image-upload"
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                  e.target.files && handleImageUpload(e.target.files)
                }
              />
            </div>

            {uploading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Uploading images...</span>
                  <span className="text-accent font-medium">{Math.round(uploadProgress)}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
              </div>
            )}

            {/* Helper Text */}
            {images.length === 0 && (
              <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-lg text-center">
                <p className="font-medium mb-1">Upload Portfolio Images</p>
                <p>Add multiple images - mark one with the star as your cover/thumbnail image</p>
              </div>
            )}

            {/* Image Gallery Sections */}
            {images.length > 0 && (
              <div className="space-y-6">
                {/* Cover Image Section */}
                {images.some(img => img.is_cover) && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Star className="h-4 w-4 text-accent fill-accent" />
                      Cover Image (Thumbnail)
                    </h4>
                    <div className="space-y-2">
                      {images.filter(img => img.is_cover).map((image, index) => (
                        <ImageCard key={index} image={image} index={images.indexOf(image)} isCover={true} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Gallery Images Section */}
                {images.filter(img => !img.is_cover).length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      Gallery Images ({images.filter(img => !img.is_cover).length})
                    </h4>
                    <div className="space-y-2">
                      {images.filter(img => !img.is_cover).map((image, index) => (
                        <ImageCard key={index} image={image} index={images.indexOf(image)} isCover={false} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Image Edit Dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Image Details</DialogTitle>
          </DialogHeader>
          {editingImage && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Alt Text *</Label>
                <Input
                  value={editingImage.alt_text}
                  onChange={(e) =>
                    setEditingImage({
                      ...editingImage,
                      alt_text: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Caption</Label>
                <Textarea
                  value={editingImage.caption || ""}
                  onChange={(e) =>
                    setEditingImage({
                      ...editingImage,
                      caption: e.target.value,
                    })
                  }
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Visible</Label>
                <Switch
                  checked={editingImage.is_visible}
                  onCheckedChange={(checked) =>
                    setEditingImage({ ...editingImage, is_visible: checked })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImageDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingImage) {
                  const index = images.findIndex(
                    (img) => img.image_url === editingImage.image_url
                  );
                  const newImages = [...images];
                  newImages[index] = editingImage;
                  setImages(newImages);
                }
                setImageDialogOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // Helper component for image cards
  function ImageCard({ image, index, isCover }: { image: any, index: number, isCover: boolean }) {
    return (
      <div className="flex items-center gap-2 p-3 border rounded-lg hover:border-primary transition-colors bg-card">
        <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
        <div className="relative">
          <img
            src={image.image_url}
            alt={image.alt_text}
            className="w-20 h-20 object-cover rounded"
          />
          {isCover && (
            <Badge className="absolute -top-2 -right-2 text-xs px-1.5 py-0.5 bg-accent">
              COVER
            </Badge>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {image.alt_text}
          </p>
          {image.caption && (
            <p className="text-xs text-muted-foreground truncate">
              {image.caption}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const newImages = images.map((img, i) => ({
                      ...img,
                      is_cover: i === index,
                    }));
                    setImages(newImages);
                  }}
                >
                  <Star
                    className={`h-5 w-5 ${
                      image.is_cover
                        ? "text-accent fill-accent"
                        : "text-muted-foreground"
                    }`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Set as Cover Image</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingImage(image);
                    setImageDialogOpen(true);
                  }}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Edit Details</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setImages(images.filter((_, i) => i !== index));
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Delete Image</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    );
  }
};
