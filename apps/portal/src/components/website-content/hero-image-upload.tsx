import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, X, Image, Link, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface HeroImageUploadProps {
  currentImageUrl?: string;
  onImageChange: (imageUrl: string | null) => void;
  label?: string;
  description?: string;
  bucket?: string;
  recommendedSize?: string;
}

export function HeroImageUpload({
  currentImageUrl,
  onImageChange,
  label = "Hero Background Image",
  description = "The background image displayed in the hero section",
  bucket = "cms-media",
  recommendedSize = "1920x1080px",
}: HeroImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState(currentImageUrl || '');

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please upload an image file (PNG, JPG, WebP)");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Please upload an image smaller than 10MB");
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `hero-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file);

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      onImageChange(publicUrl);
      setUrlInput(publicUrl);
      toast.success("Image uploaded successfully");
    } catch (error: any) {
      console.error('Error uploading hero image:', error);
      toast.error(error.message || "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = () => {
    onImageChange(null);
    setUrlInput('');
    toast.success("Image removed");
  };

  const handleUrlSubmit = () => {
    if (urlInput.trim()) {
      onImageChange(urlInput.trim());
      toast.success("Image URL saved");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-base font-semibold">{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {currentImageUrl ? (
        <div className="space-y-3">
          <div className="relative">
            <img
              src={currentImageUrl}
              alt="Hero Preview"
              className="w-full max-h-48 object-cover rounded-lg border border-border"
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="absolute top-2 right-2"
              onClick={handleRemoveImage}
            >
              <X className="h-4 w-4 mr-1" />
              Remove
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Click "Remove" to change the hero image
          </p>
        </div>
      ) : (
        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="url" className="flex items-center gap-2">
              <Link className="h-4 w-4" />
              URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            >
              <Image className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Upload hero background image</p>
                <p className="text-xs text-muted-foreground">
                  Drag and drop, or click to select
                </p>
                <p className="text-xs text-muted-foreground">
                  Recommended: {recommendedSize}, PNG/JPG/WebP, max 10MB
                </p>
              </div>
              <Input
                id="hero-image-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                disabled={uploading}
              />
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => document.getElementById('hero-image-upload')?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Choose File
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="url" className="mt-4">
            <div className="space-y-3">
              <Input
                placeholder="https://example.com/hero-image.jpg"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Enter a direct URL to an image file
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim()}
              >
                Set Image URL
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
