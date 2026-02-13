'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { Skeleton } from '@/components/ui/skeleton';

interface LocationMapProps {
  pickupAddress?: string | null;
  returnAddress?: string | null;
  className?: string;
}

const PICKUP_COLOR = '#10b981'; // emerald-500
const RETURN_COLOR = '#3b82f6'; // blue-500

// Dark-mode map style
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

export function LocationMap({ pickupAddress, returnAddress, className }: LocationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const initialized = useRef(false);

  const initMap = useCallback(async () => {
    if (!mapRef.current || initialized.current) return;
    if (!pickupAddress && !returnAddress) {
      setLoading(false);
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
        setError(true);
        setLoading(false);
        return;
      }

      const isDark = document.documentElement.classList.contains('dark');

      const map = new google.maps.Map(mapRef.current, {
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

        if (pickupLatLng && returnLatLng) {
          const bounds = new google.maps.LatLngBounds();
          bounds.extend(pickupLatLng);
          bounds.extend(returnLatLng);
          map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });
        }
      }

      setLoading(false);
    } catch {
      setError(true);
      setLoading(false);
    }
  }, [pickupAddress, returnAddress]);

  useEffect(() => {
    initMap();
  }, [initMap]);

  if (!pickupAddress && !returnAddress) return null;
  if (error) return null;

  return (
    <div className={`relative overflow-hidden rounded-lg ${className || ''}`}>
      {loading && <Skeleton className="absolute inset-0 z-10" />}
      <div ref={mapRef} className="w-full h-full" style={{ minHeight: 220 }} />
    </div>
  );
}
