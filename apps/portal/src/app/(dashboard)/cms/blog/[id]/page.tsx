"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useBlogPost, useBlogPosts } from "@/hooks/use-blog-posts";
import { useBlogCategories } from "@/hooks/use-blog-categories";
import { useBlogVersions } from "@/hooks/use-blog-versions";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { BlogEditor, getWordCount, getReadingTime } from "@/components/website-content/blog-editor";
import { HeroImageUpload } from "@/components/website-content/hero-image-upload";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tile, SectionCard, StatusPill, Shimmer } from "@/components/bento";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  ArrowLeft,
  Save,
  Loader2,
  Send,
  History,
  FileText,
  Search,
  Eye,
  Lock,
  AlertTriangle,
  CalendarIcon,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { BlogPost, CreateBlogPostInput } from "@/types/blog";

export default function BlogPostEditorPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;
  const isNew = postId === "new";

  const { canEdit } = useManagerPermissions();
  const hasEditAccess = canEdit("cms");

  const { data: existingPost, isLoading: isLoadingPost } = useBlogPost(
    isNew ? undefined : postId
  );
  const {
    createPost,
    updatePost,
    publishPost,
    unpublishPost,
    generateUniqueSlug,
    isCreating,
    isUpdating,
    isPublishing,
  } = useBlogPosts();
  const { categories } = useBlogCategories();
  const { versions, rollback, isRollingBack } = useBlogVersions(
    isNew ? undefined : postId
  );

  // Form state
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [featuredImage, setFeaturedImage] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isFeatured, setIsFeatured] = useState(false);
  const [authorName, setAuthorName] = useState("");
  // SEO
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [metaKeywords, setMetaKeywords] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [noindex, setNoindex] = useState(false);

  const [publishDate, setPublishDate] = useState<Date>(new Date());
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);
  const [savedPostId, setSavedPostId] = useState<string | null>(
    isNew ? null : postId
  );

  // Dirty state tracking
  const [isDirty, setIsDirty] = useState(false);
  const lastSavedRef = useRef<string>("");

  // Populate form from existing post
  useEffect(() => {
    if (existingPost) {
      setTitle(existingPost.title || "");
      setSlug(existingPost.slug || "");
      setExcerpt(existingPost.excerpt || "");
      setContent(existingPost.content || "");
      setFeaturedImage(existingPost.featured_image_url || null);
      setCategoryId(existingPost.category_id || null);
      setIsFeatured(existingPost.is_featured || false);
      setAuthorName(existingPost.author_name || "");
      setMetaTitle(existingPost.meta_title || "");
      setMetaDescription(existingPost.meta_description || "");
      setMetaKeywords(existingPost.meta_keywords || "");
      setCanonicalUrl(existingPost.canonical_url || "");
      setNoindex(existingPost.noindex || false);
      setPublishDate(
        existingPost.published_at
          ? new Date(existingPost.published_at)
          : new Date()
      );
      setSlugManuallyEdited(true);
      // Store snapshot for dirty checking
      lastSavedRef.current = JSON.stringify({
        title: existingPost.title,
        slug: existingPost.slug,
        excerpt: existingPost.excerpt,
        content: existingPost.content,
        featured_image_url: existingPost.featured_image_url,
        category_id: existingPost.category_id,
        is_featured: existingPost.is_featured,
        author_name: existingPost.author_name,
        meta_title: existingPost.meta_title,
        meta_description: existingPost.meta_description,
        meta_keywords: existingPost.meta_keywords,
        canonical_url: existingPost.canonical_url,
        noindex: existingPost.noindex,
        published_at: existingPost.published_at,
      });
      setIsDirty(false);
    }
  }, [existingPost]);

  // Track dirty state
  useEffect(() => {
    if (!lastSavedRef.current && isNew) {
      // For new posts, dirty if title has content
      setIsDirty(!!title.trim());
      return;
    }
    if (!lastSavedRef.current) return;

    const current = JSON.stringify({
      title,
      slug,
      excerpt,
      content,
      featured_image_url: featuredImage,
      category_id: categoryId,
      is_featured: isFeatured,
      author_name: authorName,
      meta_title: metaTitle,
      meta_description: metaDescription,
      meta_keywords: metaKeywords,
      canonical_url: canonicalUrl,
      noindex,
      published_at: publishDate.toISOString(),
    });
    setIsDirty(current !== lastSavedRef.current);
  }, [
    title, slug, excerpt, content, featuredImage, categoryId, isFeatured,
    authorName, metaTitle, metaDescription, metaKeywords, canonicalUrl, noindex, publishDate, isNew,
  ]);

  // Browser beforeunload warning for unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Auto-generate slug from title
  useEffect(() => {
    if (!slugManuallyEdited && title) {
      const generated = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 100);
      setSlug(generated);
    }
  }, [title, slugManuallyEdited]);

  const isSaving = isCreating || isUpdating;
  const post = existingPost;
  const isPublished = post?.status === "published";
  const isLocked = isPublished; // Published posts are locked for editing

  // Fields disabled when: no edit access OR post is published (locked)
  const fieldsDisabled = !hasEditAccess || isLocked;

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    try {
      if (isNew && !savedPostId) {
        const post = await createPost({
          title,
          slug: slug || undefined,
          excerpt,
          content,
          featured_image_url: featuredImage,
          category_id: categoryId,
          is_featured: isFeatured,
          author_name: authorName || undefined,
          meta_title: metaTitle || undefined,
          meta_description: metaDescription || undefined,
          meta_keywords: metaKeywords || undefined,
          canonical_url: canonicalUrl || undefined,
          noindex,
          published_at: publishDate.toISOString(),
        });
        setSavedPostId(post.id);
        // Update saved snapshot
        lastSavedRef.current = JSON.stringify({
          title, slug, excerpt, content,
          featured_image_url: featuredImage, category_id: categoryId,
          is_featured: isFeatured, author_name: authorName,
          meta_title: metaTitle, meta_description: metaDescription,
          meta_keywords: metaKeywords, canonical_url: canonicalUrl, noindex,
          published_at: publishDate.toISOString(),
        });
        setIsDirty(false);
        router.replace(`/cms/blog/${post.id}`);
        toast.success("Post created as draft");
      } else {
        const id = savedPostId || postId;
        await updatePost({
          id,
          title,
          slug,
          excerpt,
          content,
          featured_image_url: featuredImage,
          category_id: categoryId,
          is_featured: isFeatured,
          author_name: authorName || undefined,
          meta_title: metaTitle || undefined,
          meta_description: metaDescription || undefined,
          meta_keywords: metaKeywords || undefined,
          canonical_url: canonicalUrl || undefined,
          noindex,
          published_at: publishDate.toISOString(),
        });
        // Update saved snapshot
        lastSavedRef.current = JSON.stringify({
          title, slug, excerpt, content,
          featured_image_url: featuredImage, category_id: categoryId,
          is_featured: isFeatured, author_name: authorName,
          meta_title: metaTitle, meta_description: metaDescription,
          meta_keywords: metaKeywords, canonical_url: canonicalUrl, noindex,
          published_at: publishDate.toISOString(),
        });
        setIsDirty(false);
        toast.success("Post saved");
      }
    } catch (err: any) {
      // Error toast already shown by hook
    }
  }, [
    isNew, savedPostId, postId, title, slug, excerpt, content,
    featuredImage, categoryId, isFeatured, authorName,
    metaTitle, metaDescription, metaKeywords, canonicalUrl, noindex, publishDate,
    createPost, updatePost, router,
  ]);

  const handlePublish = async () => {
    const id = savedPostId || postId;
    if (!id || isNew) {
      toast.error("Save the post first before publishing");
      return;
    }

    // Publish validation warnings (non-blocking)
    if (!excerpt?.trim()) {
      toast.warning("Consider adding an excerpt for better listing display", { duration: 4000 });
    }
    if (!featuredImage) {
      toast.warning("Consider adding a featured image", { duration: 4000 });
    }
    if (!metaDescription?.trim()) {
      toast.warning("Consider adding a meta description for SEO", { duration: 4000 });
    }

    // Save latest changes first, then publish
    await handleSave();
    await publishPost(id);
  };

  const handleUnpublish = async () => {
    const id = savedPostId || postId;
    if (!id) return;
    await unpublishPost(id);
    setShowUnpublishConfirm(false);
  };

  const handleBack = () => {
    if (isDirty) {
      toast.warning("You have unsaved changes", {
        description: "Save your draft or your changes will be lost.",
        duration: 3000,
      });
    }
    router.push("/cms/blog");
  };

  if (isLoadingPost && !isNew) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Shimmer className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Tile noMotion className="space-y-3">
              <Shimmer className="h-10 w-full" />
              <Shimmer className="h-10 w-full" />
              <Shimmer className="h-20 w-full" />
            </Tile>
            <Tile noMotion><Shimmer className="h-64 w-full" /></Tile>
          </div>
          <div className="space-y-6">
            <Tile noMotion><Shimmer className="h-48 w-full" /></Tile>
            <Tile noMotion><Shimmer className="h-32 w-full" /></Tile>
          </div>
        </div>
      </div>
    );
  }

  const wordCount = getWordCount(content);
  const readingTime = getReadingTime(wordCount);
  const metaTitleLength = metaTitle.length;
  const metaDescriptionLength = metaDescription.length;

  return (
    <div className="container mx-auto space-y-4 md:space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {isNew ? "New Post" : "Edit Post"}
          </h1>
          {isPublished && (
            <StatusPill tone="success" dot>Published</StatusPill>
          )}
          {isDirty && !isPublished && (
            <StatusPill tone="warn" dot>Unsaved</StatusPill>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowVersionHistory(true)}
            >
              <History className="h-4 w-4 mr-2" />
              History
            </Button>
          )}
          {hasEditAccess && (
            <>
              {!isLocked && (
                <Button
                  variant="outline"
                  onClick={handleSave}
                  disabled={isSaving || !title.trim()}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Draft
                </Button>
              )}
              {isPublished ? (
                <Button
                  variant="secondary"
                  onClick={() => setShowUnpublishConfirm(true)}
                >
                  Unpublish
                </Button>
              ) : (
                <Button
                  onClick={handlePublish}
                  disabled={isPublishing || !title.trim()}
                >
                  {isPublishing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Publish
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* View-only banner */}
      {!hasEditAccess && (
        <div className="flex items-center gap-2 rounded-tile-sm border border-border [background:var(--bento-tile-2)] p-3 text-sm text-muted-foreground">
          <Eye className="h-4 w-4" />
          You have view-only access to this page.
        </div>
      )}

      {/* Published lock banner */}
      {isPublished && hasEditAccess && (
        <Tile
          variant="warn"
          pad="compact"
          className="flex items-center gap-2 text-sm [color:var(--bento-warn-fg)]"
        >
          <Lock className="h-4 w-4 flex-shrink-0" />
          <span>
            This post is live on your website. <strong>Unpublish it first</strong> to make changes.
          </span>
        </Tile>
      )}

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Content
          </TabsTrigger>
          <TabsTrigger value="seo" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            SEO
          </TabsTrigger>
        </TabsList>

        {/* CONTENT TAB */}
        <TabsContent value="content" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main content */}
            <div className="lg:col-span-2 space-y-6">
              <Tile pad="roomy">
                <div className="space-y-4">
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Post title"
                      disabled={fieldsDisabled}
                      className="text-lg"
                    />
                  </div>
                  <div>
                    <Label>Slug</Label>
                    <Input
                      value={slug}
                      onChange={(e) => {
                        setSlug(e.target.value);
                        setSlugManuallyEdited(true);
                      }}
                      placeholder="post-url-slug"
                      disabled={fieldsDisabled}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      /blog/{slug || "..."}
                    </p>
                  </div>
                  <div>
                    <Label>Excerpt</Label>
                    <Textarea
                      value={excerpt}
                      onChange={(e) => setExcerpt(e.target.value)}
                      placeholder="A short summary shown on blog listing cards..."
                      rows={3}
                      disabled={fieldsDisabled}
                    />
                  </div>
                </div>
              </Tile>

              <SectionCard icon={<FileText className="h-4 w-4" />} title="Content">
                  <BlogEditor
                    content={content}
                    onChange={setContent}
                    placeholder="Write your blog post..."
                    editable={!fieldsDisabled}
                  />
              </SectionCard>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <SectionCard title="Settings">
                <div className="space-y-4">
                  <div>
                    <Label>Category</Label>
                    <Select
                      value={categoryId || "none"}
                      onValueChange={(v) => setCategoryId(v === "none" ? null : v)}
                      disabled={fieldsDisabled}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No category</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Author Name</Label>
                    <Input
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      placeholder="Author display name"
                      disabled={fieldsDisabled}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="featured">Featured Post</Label>
                    <Switch
                      id="featured"
                      checked={isFeatured}
                      onCheckedChange={setIsFeatured}
                      disabled={fieldsDisabled}
                    />
                  </div>

                  {/* Publish Date */}
                  <div>
                    <Label>Publish Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal mt-1"
                          disabled={fieldsDisabled}
                        >
                          <CalendarIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                          {format(publishDate, "MMM d, yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={publishDate}
                          onSelect={(date) => date && setPublishDate(date)}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground mt-1">
                      Date shown on the published post
                    </p>
                  </div>

                  <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                    <p><span className="font-mono tabular-nums">{wordCount.toLocaleString()}</span> words</p>
                    <p><span className="font-mono tabular-nums">{readingTime}</span> min read</p>
                    {post?.created_at && (
                      <p>Created <span className="font-mono tabular-nums">{new Date(post.created_at).toLocaleDateString()}</span></p>
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Featured Image">
                  {isLocked ? (
                    featuredImage ? (
                      <img
                        src={featuredImage}
                        alt="Featured"
                        className="w-full max-h-48 object-cover rounded-lg border"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">No featured image</p>
                    )
                  ) : (
                    <HeroImageUpload
                      currentImageUrl={featuredImage || undefined}
                      onImageChange={(url) => setFeaturedImage(url)}
                      label=""
                      description="The main image for your blog post"
                      bucket="cms-media"
                      recommendedSize="1200x630px"
                    />
                  )}
              </SectionCard>
            </div>
          </div>
        </TabsContent>

        {/* SEO TAB */}
        <TabsContent value="seo" className="space-y-6 mt-6">
          <SectionCard icon={<Search className="h-4 w-4" />} title="SEO Settings">
            <div className="space-y-6">
              <div>
                <Label>Meta Title</Label>
                <Input
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder={title || "Post title"}
                  disabled={fieldsDisabled}
                />
                <p className="text-xs text-muted-foreground mt-1 flex justify-between">
                  <span>Override the title shown in search results</span>
                  <span className={"font-mono tabular-nums " + (metaTitleLength > 60 ? "text-[color:var(--bento-warn-accent)]" : "")}>
                    {metaTitleLength}/70
                  </span>
                </p>
              </div>

              <div>
                <Label>Meta Description</Label>
                <Textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder={excerpt || "A brief summary for search results..."}
                  rows={3}
                  disabled={fieldsDisabled}
                />
                <p className="text-xs text-muted-foreground mt-1 flex justify-between">
                  <span>Shown below the title in search results</span>
                  <span className={"font-mono tabular-nums " + (metaDescriptionLength > 150 ? "text-[color:var(--bento-warn-accent)]" : "")}>
                    {metaDescriptionLength}/160
                  </span>
                </p>
              </div>

              <div>
                <Label>Keywords</Label>
                <Input
                  value={metaKeywords}
                  onChange={(e) => setMetaKeywords(e.target.value)}
                  placeholder="car rental tips, luxury vehicles, travel guide"
                  disabled={fieldsDisabled}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Comma-separated keywords
                </p>
              </div>

              <div>
                <Label>Canonical URL</Label>
                <Input
                  value={canonicalUrl}
                  onChange={(e) => setCanonicalUrl(e.target.value)}
                  placeholder="https://example.com/original-post"
                  disabled={fieldsDisabled}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Set if this post was originally published elsewhere
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="noindex">Exclude from search engines</Label>
                  <p className="text-xs text-muted-foreground">
                    Add noindex directive to prevent indexing
                  </p>
                </div>
                <Switch
                  id="noindex"
                  checked={noindex}
                  onCheckedChange={setNoindex}
                  disabled={fieldsDisabled}
                />
              </div>

              {/* SERP Preview */}
              <Tile variant="inset" pad="compact">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                  Search Result Preview
                </p>
                <div className="space-y-1">
                  <p className="cursor-pointer text-lg text-[color:var(--bento-info)] hover:underline">
                    {metaTitle || title || "Post Title"}
                  </p>
                  <p className="font-mono text-sm text-[color:var(--bento-success)]">
                    yoursite.com/blog/{slug || "..."}
                  </p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {metaDescription || excerpt || "Meta description will appear here..."}
                  </p>
                </div>
              </Tile>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* Version History Dialog */}
      {!isNew && (
        <Dialog open={showVersionHistory} onOpenChange={setShowVersionHistory}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Version History</DialogTitle>
            </DialogHeader>
            <div className="max-h-[400px] overflow-y-auto space-y-2">
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No versions yet. Versions are created when you publish.
                </p>
              ) : (
                versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded-tile-sm border border-border p-3"
                  >
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium">
                        Version <span className="font-mono tabular-nums">{v.version_number}</span>
                        {v.version_number === versions[0]?.version_number && (
                          <StatusPill tone="primary">Latest</StatusPill>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(v.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        rollback(v.id);
                        setShowVersionHistory(false);
                      }}
                      disabled={isRollingBack}
                    >
                      {isRollingBack ? "Restoring..." : "Restore"}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Unpublish Confirmation Dialog */}
      <AlertDialog open={showUnpublishConfirm} onOpenChange={setShowUnpublishConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[color:var(--bento-warn-accent)]" />
              Unpublish this post?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the post from your website. Customers will no longer be able to see it. You can edit the post and re-publish it when ready.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnpublish}>
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
