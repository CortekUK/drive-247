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
  currentLogoUrl?: string;
  onLogoChange: (logoUrl: string | null) => void;
  label?: string;
  description?: string;
}

export function LogoUploadWithResize({
  currentLogoUrl,
  onLogoChange,
  label = "Company Logo",
  description = "Upload and resize your company logo",
}: LogoUploadWithResizeProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [scale, setScale] = useState(100);
  const [maxWidth, setMaxWidth] = useState(180);
  const [maxHeight, setMaxHeight] = useState(48);
  const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please upload an image file (PNG, JPG, SVG, etc.)",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please upload an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        setOriginalDimensions({ width: img.width, height: img.height });
        const aspectRatio = img.width / img.height;
        // Default to sidebar-optimized size (180x48 max)
        if (aspectRatio > 1) {
          setMaxWidth(180);
          setMaxHeight(Math.round(180 / aspectRatio));
        } else {
          setMaxHeight(48);
          setMaxWidth(Math.round(48 * aspectRatio));
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

        const scaleFactor = scale / 100;
        let newWidth = Math.round(maxWidth * scaleFactor);
        let newHeight = Math.round(maxHeight * scaleFactor);

        const aspectRatio = img.width / img.height;
        if (newWidth / newHeight > aspectRatio) {
          newWidth = Math.round(newHeight * aspectRatio);
        } else {
          newHeight = Math.round(newWidth / aspectRatio);
        }

        canvas.width = newWidth;
        canvas.height = newHeight;

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
      const urlParts = currentLogoUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];

      await supabase.storage
        .from('company-logos')
        .remove([fileName]);

      onLogoChange(null);

      toast({
        title: "Logo Removed",
        description: "Logo removed successfully",
      });
    } catch (error: any) {
      console.error('Error removing logo:', error);
      onLogoChange(null);
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

  const previewWidth = Math.round(maxWidth * (scale / 100));
  const previewHeight = Math.round(maxHeight * (scale / 100));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {currentLogoUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Change
          </Button>
        )}
      </div>

      {currentLogoUrl ? (
        <div className="space-y-3">
          <div className="relative inline-block">
            <div className="border rounded-lg p-3 bg-muted/30">
              <img
                src={currentLogoUrl}
                alt="Logo preview"
                className="max-h-16 w-auto object-contain"
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
          <p className="text-xs text-muted-foreground">{description}</p>
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
          <Image className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">{description}</p>
          <p className="text-xs text-muted-foreground mt-1">
            PNG, JPG, SVG up to 5MB • Resize before uploading
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-3">
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
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Resize Logo</DialogTitle>
            <DialogDescription>
              Adjust the size of your logo before uploading
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 overflow-y-auto flex-1 pr-2">
            <div className="flex justify-center p-4 bg-muted/30 rounded-lg min-h-[120px] max-h-[200px] items-center overflow-hidden">
              {originalImage && (
                <img
                  src={originalImage}
                  alt="Preview"
                  style={{
                    width: `${Math.min(previewWidth, 400)}px`,
                    height: 'auto',
                    maxHeight: '180px',
                    objectFit: 'contain',
                  }}
                  className="border rounded shadow-sm"
                />
              )}
            </div>

            <div className="text-center text-sm text-muted-foreground">
              Output: {previewWidth} × {previewHeight} px
              {originalDimensions.width > 0 && (
                <span className="ml-2">
                  (Original: {originalDimensions.width} × {originalDimensions.height})
                </span>
              )}
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Scale: {scale}%</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={resetScale}>
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
                    max={800}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-height">Max Height (px)</Label>
                  <Input
                    id="max-height"
                    type="number"
                    value={maxHeight}
                    onChange={(e) => setMaxHeight(Number(e.target.value) || 50)}
                    min={30}
                    max={400}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-muted-foreground mr-2">Presets:</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setMaxWidth(180); setMaxHeight(48); }}
                >
                  Sidebar (180×48)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setMaxWidth(250); setMaxHeight(70); }}
                >
                  Medium (250×70)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setMaxWidth(350); setMaxHeight(100); }}
                >
                  Large (350×100)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setMaxWidth(500); setMaxHeight(150); }}
                >
                  XL (500×150)
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t pt-4 mt-4 flex-shrink-0">
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
            <Button type="button" onClick={handleUpload} disabled={uploading}>
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
    </div>
  );
}
