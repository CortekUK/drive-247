import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, X, Image, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface FaviconUploadProps {
  currentFaviconUrl?: string;
  onFaviconChange: (faviconUrl: string | null) => void;
}

export const FaviconUpload: React.FC<FaviconUploadProps> = ({
  currentFaviconUrl,
  onFaviconChange,
}) => {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeToFavicon = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          // Standard favicon size
          const size = 32;
          canvas.width = size;
          canvas.height = size;

          // Use better quality scaling
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw image centered and scaled
          const scale = Math.min(size / img.width, size / img.height);
          const x = (size - img.width * scale) / 2;
          const y = (size - img.height * scale) / 2;

          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to create blob'));
              }
            },
            'image/png',
            1.0
          );
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please upload an image file (PNG, JPG, ICO, etc.)",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 1MB)
    if (file.size > 1 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please upload an image smaller than 1MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      // Resize to favicon size
      const resizedBlob = await resizeToFavicon(file);
      const fileName = `favicon-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(fileName, resizedBlob, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('company-logos')
        .getPublicUrl(fileName);

      onFaviconChange(publicUrl);

      toast({
        title: "Favicon Uploaded",
        description: "Favicon uploaded and resized to 32x32 pixels",
      });
    } catch (error: any) {
      console.error('Error uploading favicon:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload favicon",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFavicon = async () => {
    if (!currentFaviconUrl) return;

    try {
      const urlParts = currentFaviconUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];

      await supabase.storage
        .from('company-logos')
        .remove([fileName]);

      onFaviconChange(null);

      toast({
        title: "Favicon Removed",
        description: "Favicon removed successfully",
      });
    } catch (error: any) {
      console.error('Error removing favicon:', error);
      onFaviconChange(null);
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
      <Label>Favicon</Label>

      {currentFaviconUrl ? (
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 border rounded-lg bg-muted/30 flex items-center justify-center">
              <img
                src={currentFaviconUrl}
                alt="Favicon preview"
                className="w-8 h-8 object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0"
              onClick={handleRemoveFavicon}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">
              Current favicon (32×32)
            </p>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              Change favicon
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'
          }`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Image className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">
            Drop an image or click to upload
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Will be resized to 32×32
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-3 w-3 mr-1" />
                Choose File
              </>
            )}
          </Button>
        </div>
      )}

      <Input
        ref={fileInputRef}
        type="file"
        accept="image/*,.ico"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
          e.target.value = '';
        }}
      />

      <p className="text-xs text-muted-foreground">
        The small icon shown in browser tabs (automatically resized to 32×32)
      </p>
    </div>
  );
};
