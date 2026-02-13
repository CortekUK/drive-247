'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Maximize2 } from 'lucide-react';

interface LocationMapProps {
  pickupAddress?: string | null;
  returnAddress?: string | null;
  className?: string;
}

const PICKUP_COLOR = '#10b981';
const RETURN_COLOR = '#3b82f6';

const darkMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8b8b9e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a3e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3a4e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1a2b' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1e1e32' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

function createMarkerSvg(color: string, label: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46"><path d="M18 0C8.1 0 0 8.1 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.1 27.9 0 18 0z" fill="${color}"/><circle cx="18" cy="17" r="8" fill="white" opacity="0.9"/><text x="18" y="21" text-anchor="middle" font-size="12" font-weight="bold" font-family="Arial" fill="${color}">${label}</text></svg>`)}`;
}

let loaderInit = false;
let loadPromise: Promise<void> | null = null;

function ensureLibraries(): Promise<void> {
  if (!loadPromise) {
    if (!loaderInit) {
      setOptions({
        key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
        v: 'weekly',
      });
      loaderInit = true;
    }
    loadPromise = Promise.all([
      importLibrary('maps'),
      importLibrary('geocoding'),
    ]).then(() => undefined);
  }
  return loadPromise;
}

let geocoderInstance: google.maps.Geocoder | null = null;

function geocodeAddress(address: string): Promise<google.maps.LatLng | null> {
  return new Promise((resolve) => {
    if (!geocoderInstance) {
      geocoderInstance = new google.maps.Geocoder();
    }
    geocoderInstance.geocode({ address }, (results, status) => {
      if (status === 'OK' && results?.[0]) {
        resolve(results[0].geometry.location);
      } else {
        resolve(null);
      }
    });
  });
}

interface MapRendererProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pickupAddress?: string | null;
  returnAddress?: string | null;
  onReady?: () => void;
  onError?: () => void;
}

function useMapRenderer({ containerRef, pickupAddress, returnAddress, onReady, onError }: MapRendererProps) {
  const initialized = useRef(false);

  const render = useCallback(async () => {
    if (!containerRef.current || initialized.current) return;
    if (!pickupAddress && !returnAddress) {
      onReady?.();
      return;
    }

    initialized.current = true;

    try {
      await ensureLibraries();

      const [pickupLatLng, returnLatLng] = await Promise.all([
        pickupAddress ? geocodeAddress(pickupAddress) : null,
        returnAddress ? geocodeAddress(returnAddress) : null,
      ]);

      if (!pickupLatLng && !returnLatLng) {
        onError?.();
        return;
      }

      const isDark = document.documentElement.classList.contains('dark');

      const map = new google.maps.Map(containerRef.current, {
        zoom: 14,
        center: pickupLatLng || returnLatLng!,
        disableDefaultUI: true,
        zoomControl: true,
        styles: isDark ? darkMapStyles : undefined,
        backgroundColor: isDark ? '#1a1a2e' : '#f5f5f5',
      });

      const sameLocation =
        pickupLatLng &&
        returnLatLng &&
        Math.abs(pickupLatLng.lat() - returnLatLng.lat()) < 0.0005 &&
        Math.abs(pickupLatLng.lng() - returnLatLng.lng()) < 0.0005;

      if (sameLocation) {
        new google.maps.Marker({
          map,
          position: pickupLatLng,
          title: 'Pickup & Return',
          icon: {
            url: createMarkerSvg(PICKUP_COLOR, 'P'),
            scaledSize: new google.maps.Size(36, 46),
            anchor: new google.maps.Point(18, 46),
          },
        });
        map.setZoom(15);
      } else {
        if (pickupLatLng) {
          new google.maps.Marker({
            map,
            position: pickupLatLng,
            title: 'Pickup',
            icon: {
              url: createMarkerSvg(PICKUP_COLOR, 'P'),
              scaledSize: new google.maps.Size(36, 46),
              anchor: new google.maps.Point(18, 46),
            },
          });
        }
        if (returnLatLng) {
          new google.maps.Marker({
            map,
            position: returnLatLng,
            title: 'Return',
            icon: {
              url: createMarkerSvg(RETURN_COLOR, 'R'),
              scaledSize: new google.maps.Size(36, 46),
              anchor: new google.maps.Point(18, 46),
            },
          });
        }

        // Draw a dashed line between pickup and return
        if (pickupLatLng && returnLatLng) {
          new google.maps.Polyline({
            map,
            path: [pickupLatLng, returnLatLng],
            strokeColor: '#991b1b',
            strokeOpacity: 0.7,
            strokeWeight: 4,
          });

          const bounds = new google.maps.LatLngBounds();
          bounds.extend(pickupLatLng);
          bounds.extend(returnLatLng);
          map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
        }
      }

      onReady?.();
    } catch {
      onError?.();
    }
  }, [containerRef, pickupAddress, returnAddress, onReady, onError]);

  return { render, reset: () => { initialized.current = false; } };
}

export function LocationMap({ pickupAddress, returnAddress, className }: LocationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const dialogMapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dialogLoading, setDialogLoading] = useState(true);
  const dialogInitRef = useRef(false);

  // Inline map
  const { render: renderInline } = useMapRenderer({
    containerRef: mapRef,
    pickupAddress,
    returnAddress,
    onReady: () => setLoading(false),
    onError: () => { setError(true); setLoading(false); },
  });

  useEffect(() => {
    renderInline();
  }, [renderInline]);

  // Dialog map — render when opened
  useEffect(() => {
    if (!fullscreen || !dialogMapRef.current || dialogInitRef.current) return;
    dialogInitRef.current = true;
    setDialogLoading(true);

    const renderDialog = async () => {
      if (!dialogMapRef.current) return;
      if (!pickupAddress && !returnAddress) {
        setDialogLoading(false);
        return;
      }

      try {
        await ensureLibraries();

        const [pickupLatLng, returnLatLng] = await Promise.all([
          pickupAddress ? geocodeAddress(pickupAddress) : null,
          returnAddress ? geocodeAddress(returnAddress) : null,
        ]);

        if (!pickupLatLng && !returnLatLng || !dialogMapRef.current) {
          setDialogLoading(false);
          return;
        }

        const isDark = document.documentElement.classList.contains('dark');

        const map = new google.maps.Map(dialogMapRef.current, {
          zoom: 14,
          center: pickupLatLng || returnLatLng!,
          disableDefaultUI: false,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          styles: isDark ? darkMapStyles : undefined,
          backgroundColor: isDark ? '#1a1a2e' : '#f5f5f5',
        });

        const sameLocation =
          pickupLatLng &&
          returnLatLng &&
          Math.abs(pickupLatLng.lat() - returnLatLng.lat()) < 0.0005 &&
          Math.abs(pickupLatLng.lng() - returnLatLng.lng()) < 0.0005;

        if (sameLocation) {
          new google.maps.Marker({
            map,
            position: pickupLatLng,
            title: 'Pickup & Return',
            icon: {
              url: createMarkerSvg(PICKUP_COLOR, 'P'),
              scaledSize: new google.maps.Size(36, 46),
              anchor: new google.maps.Point(18, 46),
            },
          });
          map.setZoom(15);
        } else {
          if (pickupLatLng) {
            new google.maps.Marker({
              map,
              position: pickupLatLng,
              title: 'Pickup',
              icon: {
                url: createMarkerSvg(PICKUP_COLOR, 'P'),
                scaledSize: new google.maps.Size(36, 46),
                anchor: new google.maps.Point(18, 46),
              },
            });
          }
          if (returnLatLng) {
            new google.maps.Marker({
              map,
              position: returnLatLng,
              title: 'Return',
              icon: {
                url: createMarkerSvg(RETURN_COLOR, 'R'),
                scaledSize: new google.maps.Size(36, 46),
                anchor: new google.maps.Point(18, 46),
              },
            });
          }

          if (pickupLatLng && returnLatLng) {
            new google.maps.Polyline({
              map,
              path: [pickupLatLng, returnLatLng],
              strokeColor: '#991b1b',
              strokeOpacity: 0,
              icons: [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 0.6,
                    strokeWeight: 3,
                    scale: 3,
                  },
                  offset: '0',
                  repeat: '16px',
                },
              ],
            });

            const bounds = new google.maps.LatLngBounds();
            bounds.extend(pickupLatLng);
            bounds.extend(returnLatLng);
            map.fitBounds(bounds, { top: 60, bottom: 60, left: 60, right: 60 });
          }
        }

        setDialogLoading(false);
      } catch {
        setDialogLoading(false);
      }
    };

    // Small delay to let the dialog DOM mount
    setTimeout(renderDialog, 100);
  }, [fullscreen, pickupAddress, returnAddress]);

  const handleFullscreen = () => {
    dialogInitRef.current = false;
    setFullscreen(true);
  };

  if (!pickupAddress && !returnAddress) return null;
  if (error) return null;

  return (
    <>
      <div className={`relative overflow-hidden rounded-lg ${className || ''}`}>
        {loading && <Skeleton className="absolute inset-0 z-10" />}
        <div ref={mapRef} className="w-full h-full" style={{ minHeight: 220 }} />

        {/* Expand button on map */}
        {!loading && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-3 right-3 z-10 h-8 w-8 bg-background/80 backdrop-blur-sm border border-border/50 shadow-md hover:bg-background"
            onClick={handleFullscreen}
            title="View fullscreen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Fullscreen dialog */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-[90vw] w-[90vw] h-[80vh] p-0 gap-0 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium">Pickup & Return Locations</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  Pickup
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  Return
                </span>
              </div>
            </div>
          </div>
          <div className="relative flex-1 min-h-0">
            {dialogLoading && <Skeleton className="absolute inset-0 z-10" />}
            <div ref={dialogMapRef} className="absolute inset-0" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
