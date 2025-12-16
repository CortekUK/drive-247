import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Upload, X, Image, ZoomIn, ZoomOut, RotateCcw, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface LogoUploadWithResizeProps {
  currentLogoUrl: string;
  logoAlt: string;
  onLogoChange: (logoUrl: string) => void;
  onAltChange: (alt: string) => void;
  label?: string;
  description?: string;
}

export function LogoUploadWithResize({
  currentLogoUrl,
  logoAlt,
  onLogoChange,
  onAltChange,
  label = "Logo",
  description = "Upload and resize your logo image",
}: LogoUploadWithResizeProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [scale, setScale] = useState(100);
  const [maxWidth, setMaxWidth] = useState(300);
  const [maxHeight, setMaxHeight] = useState(100);
  const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileSelect = async (file: File) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please upload an image file (PNG, JPG, SVG, etc.)",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 5MB for original)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please upload an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    // Read the file and open editor
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        setOriginalDimensions({ width: img.width, height: img.height });
        // Set reasonable defaults based on image aspect ratio
        const aspectRatio = img.width / img.height;
        if (aspectRatio > 1) {
          // Wide image
          setMaxWidth(300);
          setMaxHeight(Math.round(300 / aspectRatio));
        } else {
          // Tall image
          setMaxHeight(100);
          setMaxWidth(Math.round(100 * aspectRatio));
        }
        setScale(100);
      };
      img.src = e.target?.result as string;
      setOriginalImage(e.target?.result as string);
      setEditorOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const resizeImage = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      if (!originalImage) {
        reject(new Error('No image to resize'));
        return;
      }

      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Calculate new dimensions
        const scaleFactor = scale / 100;
        let newWidth = Math.round(maxWidth * scaleFactor);
        let newHeight = Math.round(maxHeight * scaleFactor);

        // Maintain aspect ratio
        const aspectRatio = img.width / img.height;
        if (newWidth / newHeight > aspectRatio) {
          newWidth = Math.round(newHeight * aspectRatio);
        } else {
          newHeight = Math.round(newWidth / aspectRatio);
        }

        canvas.width = newWidth;
        canvas.height = newHeight;

        // Use better quality scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, 0, 0, newWidth, newHeight);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob'));
            }
          },
          'image/png',
          0.95
        );
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = originalImage;
    });
  }, [originalImage, scale, maxWidth, maxHeight]);

  const handleUpload = async () => {
    if (!originalImage) return;

    setUploading(true);

    try {
      const blob = await resizeImage();
      const fileName = `logo-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(fileName, blob, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('company-logos')
        .getPublicUrl(fileName);

      onLogoChange(publicUrl);
      setEditorOpen(false);
      setOriginalImage(null);

      toast({
        title: "Logo Uploaded",
        description: "Your logo has been uploaded and resized successfully",
      });
    } catch (error: any) {
      console.error('Error uploading logo:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload logo",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!currentLogoUrl) return;

    try {
      // Extract file path from URL
      const urlParts = currentLogoUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];

      await supabase.storage
        .from('company-logos')
        .remove([fileName]);

      onLogoChange('');

      toast({
        title: "Logo Removed",
        description: "Logo removed successfully",
      });
    } catch (error: any) {
      console.error('Error removing logo:', error);
      // Still clear the URL even if delete fails
      onLogoChange('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const resetScale = () => {
    setScale(100);
  };

  // Calculate preview dimensions
  const previewWidth = Math.round(maxWidth * (scale / 100));
  const previewHeight = Math.round(maxHeight * (scale / 100));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {currentLogoUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.click();
              }
            }}
          >
            Change
          </Button>
        )}
      </div>

      {currentLogoUrl ? (
        <div className="space-y-4">
          <div className="relative inline-block">
            <div className="border rounded-lg p-4 bg-muted/30">
              <img
                src={currentLogoUrl}
                alt={logoAlt || "Logo preview"}
                className="max-h-24 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
              onClick={handleRemoveLogo}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo-alt">Alt Text</Label>
            <Input
              id="logo-alt"
              value={logoAlt}
              onChange={(e) => onAltChange(e.target.value)}
              placeholder="Drive 917 Logo"
            />
            <p className="text-xs text-muted-foreground">
              Describes the image for accessibility
            </p>
          </div>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'
          }`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Image className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <div className="space-y-2">
            <p className="text-sm font-medium">{description}</p>
            <p className="text-xs text-muted-foreground">
              Drag and drop an image, or click to select
            </p>
            <p className="text-xs text-muted-foreground">
              PNG, JPG, SVG up to 5MB • You can resize before uploading
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
          >
            <Upload className="h-4 w-4 mr-2" />
            Choose File
          </Button>
        </div>
      )}

      <Input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
          e.target.value = '';
        }}
      />

      {/* Image Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resize Logo</DialogTitle>
            <DialogDescription>
              Adjust the size of your logo before uploading
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Preview */}
            <div className="flex justify-center p-4 bg-muted/30 rounded-lg min-h-[200px] items-center">
              {originalImage && (
                <img
                  src={originalImage}
                  alt="Preview"
                  style={{
                    maxWidth: `${previewWidth}px`,
                    maxHeight: `${previewHeight}px`,
                    objectFit: 'contain',
                  }}
                  className="border rounded shadow-sm"
                />
              )}
            </div>

            {/* Size Info */}
            <div className="text-center text-sm text-muted-foreground">
              Output size: {previewWidth} × {previewHeight} pixels
              {originalDimensions.width > 0 && (
                <span className="ml-2">
                  (Original: {originalDimensions.width} × {originalDimensions.height})
                </span>
              )}
            </div>

            {/* Controls */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Scale: {scale}%</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetScale}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <ZoomOut className="h-4 w-4 text-muted-foreground" />
                  <Slider
                    value={[scale]}
                    onValueChange={(value) => setScale(value[0])}
                    min={10}
                    max={200}
                    step={5}
                    className="flex-1"
                  />
                  <ZoomIn className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max-width">Max Width (px)</Label>
                  <Input
                    id="max-width"
                    type="number"
                    value={maxWidth}
                    onChange={(e) => setMaxWidth(Number(e.target.value) || 100)}
                    min={50}
                    max={1000}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-height">Max Height (px)</Label>
                  <Input
                    id="max-height"
                    type="number"
                    value={maxHeight}
                    onChange={(e) => setMaxHeight(Number(e.target.value) || 100)}
                    min={50}
                    max={500}
                  />
                </div>
              </div>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-muted-foreground mr-2">Presets:</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setMaxWidth(200); setMaxHeight(60); }}
                >
                  Small (200×60)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setMaxWidth(300); setMaxHeight(80); }}
                >
                  Medium (300×80)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setMaxWidth(400); setMaxHeight(100); }}
                >
                  Large (400×100)
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditorOpen(false);
                setOriginalImage(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleUpload}
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
                  Upload Logo
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
