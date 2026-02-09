import { useState, useEffect, useRef } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let loaderPromise: Promise<void> | null = null;

export function useGoogleMapsLoader() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    if (!loaderPromise) {
      setOptions({
        key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
        v: "weekly",
      });
      loaderPromise = importLibrary("places").then(() => undefined);
    }

    loaderPromise
      .then(() => {
        if (mounted.current) setIsLoaded(true);
      })
      .catch((err) => {
        if (mounted.current) setError(err);
      });

    return () => {
      mounted.current = false;
    };
  }, []);

  return { isLoaded, error };
}
