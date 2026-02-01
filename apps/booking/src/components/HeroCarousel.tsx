'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// Media item type for mixed image/video carousel
export interface CarouselMediaItem {
  url: string;
  type: 'image' | 'video';
  alt?: string;
}

interface HeroCarouselProps {
  // Support both old format (string[]) and new format (CarouselMediaItem[])
  images?: string[];
  media?: CarouselMediaItem[];
  autoPlayInterval?: number;
  children?: React.ReactNode;
  className?: string;
  overlayStrength?: 'light' | 'medium' | 'strong';
  showScrollIndicator?: boolean;
}

// Helper to normalize media items from different formats
const normalizeMedia = (
  images?: string[],
  media?: CarouselMediaItem[]
): CarouselMediaItem[] => {
  // Prefer new format if provided
  if (media && media.length > 0) {
    return media;
  }
  // Fall back to old format (images as strings)
  if (images && images.length > 0) {
    return images.map(url => ({ url, type: 'image' as const }));
  }
  return [];
};

const HeroCarousel = ({
  images,
  media,
  autoPlayInterval = 3000,
  children,
  className = '',
  overlayStrength = 'medium',
  showScrollIndicator = false,
}: HeroCarouselProps) => {
  const normalizedMedia = normalizeMedia(images, media);

  // Debug: log what media we're rendering
  console.log('[HeroCarousel] Received media prop:', media);
  console.log('[HeroCarousel] Received images prop:', images);
  console.log('[HeroCarousel] Normalized media:', normalizedMedia);
  console.log('[HeroCarousel] Video items:', normalizedMedia.filter(m => m.type === 'video'));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const overlayClasses = {
    light: 'bg-gradient-to-b from-black/40 via-black/30 to-black/60',
    medium: 'bg-gradient-to-b from-black/50 via-black/40 to-black/70',
    strong: 'bg-gradient-to-b from-black/60 via-black/50 to-black/80',
  };

  const nextSlide = useCallback(() => {
    setCurrentIndex((prevIndex) =>
      prevIndex === normalizedMedia.length - 1 ? 0 : prevIndex + 1
    );
  }, [normalizedMedia.length]);

  const prevSlide = useCallback(() => {
    setCurrentIndex((prevIndex) =>
      prevIndex === 0 ? normalizedMedia.length - 1 : prevIndex - 1
    );
  }, [normalizedMedia.length]);

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 10000);
  };

  // Handle video playback based on current slide
  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (video) {
        if (index === currentIndex) {
          // Ensure video is muted (required for autoplay)
          video.muted = true;
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.catch((error) => {
              console.log('[HeroCarousel] Autoplay failed:', error);
              // Try playing again after a short delay
              setTimeout(() => {
                video.play().catch(() => {});
              }, 100);
            });
          }
        } else {
          video.pause();
          video.currentTime = 0;
        }
      }
    });
  }, [currentIndex]);

  // Also try to play video on initial mount
  useEffect(() => {
    const firstVideo = videoRefs.current[0];
    if (firstVideo && normalizedMedia[0]?.type === 'video') {
      firstVideo.muted = true;
      firstVideo.play().catch(() => {});
    }
  }, [normalizedMedia]);

  useEffect(() => {
    if (!isAutoPlaying || normalizedMedia.length <= 1) return;

    const currentItem = normalizedMedia[currentIndex];

    // For videos, wait for them to end before moving to next slide
    // For images, use the standard autoPlayInterval
    if (currentItem?.type === 'video') {
      const video = videoRefs.current[currentIndex];
      if (video) {
        const handleEnded = () => nextSlide();
        video.addEventListener('ended', handleEnded);
        return () => video.removeEventListener('ended', handleEnded);
      }
    }

    const interval = setInterval(() => {
      nextSlide();
    }, autoPlayInterval);

    return () => clearInterval(interval);
  }, [isAutoPlaying, autoPlayInterval, nextSlide, normalizedMedia, currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        prevSlide();
        setIsAutoPlaying(false);
      } else if (e.key === 'ArrowRight') {
        nextSlide();
        setIsAutoPlaying(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide]);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      {/* Carousel Media - Background Layer */}
      <div className="absolute inset-0 z-0">
        {normalizedMedia.map((item, index) => (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentIndex ? "opacity-100" : "opacity-0"}`}
          >
            {item.type === 'video' ? (
              <video
                ref={(el) => { videoRefs.current[index] = el; }}
                src={item.url}
                className={`w-full h-full object-cover transform transition-transform duration-[7000ms] ease-out ${index === currentIndex ? "scale-105" : "scale-100"}`}
                muted
                playsInline
                autoPlay
                loop
                preload={index === 0 ? 'auto' : 'metadata'}
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'translateZ(0)',
                  minWidth: '100%',
                  minHeight: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <img
                src={item.url}
                alt={item.alt || `Slide ${index + 1}`}
                className={`w-full h-full object-cover transform transition-transform duration-[7000ms] ease-out ${index === currentIndex ? "scale-105" : "scale-100"}`}
                loading={index === 0 ? 'eager' : 'lazy'}
                decoding="async"
                fetchPriority={index === 0 ? 'high' : 'auto'}
                style={{
                  imageRendering: '-webkit-optimize-contrast',
                  backfaceVisibility: 'hidden',
                  transform: 'translateZ(0)'
                }}
              />
            )}
            {/* Overlay */}
            <div className={`absolute inset-0 ${overlayClasses[overlayStrength]}`} />
          </div>
        ))}
      </div>

      {/* Content Overlay */}
      {children && (
        <div className="relative z-10 h-full">
          {children}
        </div>
      )}

      {/* Custom Dot Indicators - only show if more than 1 item */}
      {normalizedMedia.length > 1 && (
        <div className="absolute bottom-8 left-0 right-0 z-20 flex items-center justify-center gap-2">
          {normalizedMedia.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`transition-all duration-300 ${index === currentIndex ? "w-6 h-2 bg-accent rounded-full" : "w-2 h-2 bg-white/60 hover:bg-white/80 rounded-full"}`}
              aria-label={`Go to slide ${index + 1}`}
              aria-current={index === currentIndex}
            />
          ))}
        </div>
      )}

      {/* Scroll Indicator */}
      {showScrollIndicator && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/50 rounded-full flex justify-center">
            <div className="w-1 h-3 bg-white rounded-full mt-2" />
          </div>
        </div>
      )}
    </div>
  );
};

export default HeroCarousel;
