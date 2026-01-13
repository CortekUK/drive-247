import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, X, Image, Film, Link, Loader2, ChevronUp, ChevronDown, Plus, GripVertical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CMS_MEDIA } from '@/constants/website-content';
import type { CarouselMediaItem } from '@/types/cms';

interface CarouselMediaEditorProps {
  media: CarouselMediaItem[];
  onMediaChange: (media: CarouselMediaItem[]) => void;
  label?: string;
  description?: string;
  bucket?: string;
  maxItems?: number;
}

// Helper to determine if a file/URL is a video
const isVideoType = (mimeType: string): boolean => {
  return mimeType.startsWith('video/') || mimeType === 'image/gif';
};

// Helper to detect media type from URL
const getMediaTypeFromUrl = (url: string): 'image' | 'video' => {
  const lowerUrl = url.toLowerCase();
  const videoExtensions = CMS_MEDIA.VIDEO_EXTENSIONS as readonly string[];

  for (const ext of videoExtensions) {
    if (lowerUrl.includes(ext)) {
      return 'video';
    }
  }
  return 'image';
};

// Helper to get max file size based on type
const getMaxFileSize = (isVideo: boolean): number => {
  return isVideo ? CMS_MEDIA.MAX_VIDEO_SIZE_BYTES : CMS_MEDIA.MAX_IMAGE_SIZE_BYTES;
};

// Helper to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))}MB`;
  }
  return `${Math.round(bytes / 1024)}KB`;
};

export function CarouselMediaEditor({
  media,
  onMediaChange,
  label = "Hero Carousel Media",
  description = "Images and videos that rotate in the hero background",
  bucket = "cms-media",
  maxItems = CMS_MEDIA.MAX_CAROUSEL_ITEMS,
}: CarouselMediaEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const remainingSlots = maxItems - media.length;
    if (remainingSlots <= 0) {
      toast.error(`Maximum ${maxItems} media items allowed`);
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remainingSlots);
    const allowedTypes = CMS_MEDIA.ALLOWED_CAROUSEL_TYPES as readonly string[];

    // Validate files first
    for (const file of filesToUpload) {
      if (!allowedTypes.includes(file.type)) {
        toast.error(`${file.name}: Unsupported file type. Use PNG, JPG, WebP, MP4, WebM, or GIF.`);
        continue;
      }

      const isVideo = isVideoType(file.type);
      const maxSize = getMaxFileSize(isVideo);

      if (file.size > maxSize) {
        toast.error(`${file.name}: File too large. Max size is ${formatFileSize(maxSize)}.`);
        continue;
      }
    }

    setUploading(true);

    try {
      const uploadedMedia: CarouselMediaItem[] = [];

      for (const file of filesToUpload) {
        if (!allowedTypes.includes(file.type)) continue;

        const isVideo = isVideoType(file.type);
        const maxSize = getMaxFileSize(isVideo);

        if (file.size > maxSize) continue;

        const fileExt = file.name.split('.').pop();
        const prefix = isVideo ? 'video' : 'carousel';
        const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(fileName, file);

        if (uploadError) {
          console.error('Upload error:', uploadError);
          toast.error(`Failed to upload ${file.name}`);
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from(bucket)
          .getPublicUrl(fileName);

        uploadedMedia.push({
          url: publicUrl,
          type: isVideo ? 'video' : 'image',
        });
      }

      if (uploadedMedia.length > 0) {
        onMediaChange([...media, ...uploadedMedia]);
        toast.success(`${uploadedMedia.length} file(s) uploaded successfully`);
      }
    } catch (error: any) {
      console.error('Error uploading carousel media:', error);
      toast.error(error.message || "Failed to upload files");
    } finally {
      setUploading(false);
    }
  };

  const handleAddUrl = () => {
    if (!urlInput.trim()) return;

    if (media.length >= maxItems) {
      toast.error(`Maximum ${maxItems} media items allowed`);
      return;
    }

    const mediaType = getMediaTypeFromUrl(urlInput.trim());

    onMediaChange([...media, {
      url: urlInput.trim(),
      type: mediaType,
    }]);

    setUrlInput('');
    setShowUrlInput(false);
    toast.success(`${mediaType === 'video' ? 'Video' : 'Image'} URL added`);
  };

  const handleRemoveMedia = (index: number) => {
    const newMedia = media.filter((_, i) => i !== index);
    onMediaChange(newMedia);
    toast.success("Media removed");
  };

  const handleMoveMedia = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === media.length - 1) return;

    const newMedia = [...media];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    [newMedia[index], newMedia[newIndex]] = [newMedia[newIndex], newMedia[index]];
    onMediaChange(newMedia);
  };

  const imageCount = media.filter(m => m.type === 'image').length;
  const videoCount = media.filter(m => m.type === 'video').length;

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {/* Media List */}
      {media.length > 0 && (
        <div className="space-y-2">
          {media.map((item, index) => (
            <Card key={index} className="p-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center text-muted-foreground">
                  <GripVertical className="h-4 w-4" />
                </div>

                {/* Media Preview */}
                <div className="w-20 h-14 flex-shrink-0 rounded overflow-hidden bg-muted relative">
                  {item.type === 'video' ? (
                    <video
                      src={item.url}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                      onMouseLeave={(e) => {
                        const video = e.target as HTMLVideoElement;
                        video.pause();
                        video.currentTime = 0;
                      }}
                    />
                  ) : (
                    <img
                      src={item.url}
                      alt={item.alt || `Carousel item ${index + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/placeholder.svg';
                      }}
                    />
                  )}
                  {/* Type Badge Overlay */}
                  <Badge
                    variant={item.type === 'video' ? 'default' : 'secondary'}
                    className="absolute top-1 left-1 text-[10px] px-1 py-0 h-4"
                  >
                    {item.type === 'video' ? (
                      <><Film className="h-2.5 w-2.5 mr-0.5" /> VID</>
                    ) : (
                      <><Image className="h-2.5 w-2.5 mr-0.5" /> IMG</>
                    )}
                  </Badge>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground truncate">
                    {item.url.startsWith('http') ? new URL(item.url).pathname.split('/').pop() : item.url}
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Position: {index + 1} of {media.length}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleMoveMedia(index, 'up')}
                    disabled={index === 0}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleMoveMedia(index, 'down')}
                    disabled={index === media.length - 1}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleRemoveMedia(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Upload Area */}
      {media.length < maxItems && (
        <div className="space-y-3">
          <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
            <div className="flex justify-center gap-2 mb-3">
              <Image className="h-8 w-8 text-muted-foreground" />
              <Film className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Add carousel media</p>
              <p className="text-xs text-muted-foreground">
                {media.length}/{maxItems} items
                {imageCount > 0 && ` • ${imageCount} image${imageCount !== 1 ? 's' : ''}`}
                {videoCount > 0 && ` • ${videoCount} video${videoCount !== 1 ? 's' : ''}`}
              </p>
              <p className="text-xs text-muted-foreground">
                PNG/JPG/WebP (max 10MB) • MP4/WebM/GIF (max 50MB)
              </p>
            </div>
            <Input
              id="carousel-media-upload"
              type="file"
              accept={CMS_MEDIA.ALLOWED_CAROUSEL_TYPES.join(',')}
              multiple
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
              disabled={uploading}
            />
            <div className="flex gap-2 justify-center mt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('carousel-media-upload')?.click()}
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
                    Upload Files
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowUrlInput(!showUrlInput)}
              >
                <Link className="h-4 w-4 mr-2" />
                Add URL
              </Button>
            </div>
          </div>

          {/* URL Input */}
          {showUrlInput && (
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com/image.jpg or video.mp4"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddUrl();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddUrl}
                disabled={!urlInput.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {media.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          No carousel media configured. Default images will be used.
        </p>
      )}
    </div>
  );
}
