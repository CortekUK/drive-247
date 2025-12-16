import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, X, Image, Link } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface OGImageUploadProps {
  currentImageUrl?: string;
  onImageChange: (imageUrl: string | null) => void;
}

export const OGImageUpload: React.FC<OGImageUploadProps> = ({
  currentImageUrl,
  onImageChange,
}) => {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState(currentImageUrl || '');

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please upload an image file (PNG, JPG, etc.)",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 5MB for OG images)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please upload an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `og-image-${Date.now()}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('company-logos')
        .getPublicUrl(filePath);

      onImageChange(publicUrl);
      setUrlInput(publicUrl);

      toast({
        title: "Image Uploaded",
        description: "OG image uploaded successfully",
      });
    } catch (error: any) {
      console.error('Error uploading OG image:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = () => {
    onImageChange(null);
    setUrlInput('');
    toast({
      title: "Image Removed",
      description: "OG image removed successfully",
    });
  };

  const handleUrlSubmit = () => {
    if (urlInput.trim()) {
      onImageChange(urlInput.trim());
      toast({
        title: "URL Saved",
        description: "OG image URL has been set",
      });
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  return (
    <div className="space-y-4">
      {currentImageUrl ? (
        <div className="space-y-3">
          <div className="relative inline-block">
            <img
              src={currentImageUrl}
              alt="OG Preview"
              className="max-h-32 w-auto rounded-lg border border-border bg-background object-contain"
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
              onClick={handleRemoveImage}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Current OG image - click X to remove
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
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Image className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Upload OG image</p>
                <p className="text-xs text-muted-foreground">
                  Drag and drop, or click to select
                </p>
                <p className="text-xs text-muted-foreground">
                  Recommended: 1200x630px, PNG or JPG, max 5MB
                </p>
              </div>
              <Input
                id="og-image-upload"
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
                size="sm"
                className="mt-3"
                onClick={() => document.getElementById('og-image-upload')?.click()}
                disabled={uploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? 'Uploading...' : 'Choose File'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="url" className="mt-4">
            <div className="space-y-3">
              <Input
                placeholder="https://example.com/og-image.png"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim()}
              >
                Set URL
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default OGImageUpload;
