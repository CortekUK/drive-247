'use client';

import { useEffect } from 'react';
import { useBrandingSettings } from '@/hooks/useBrandingSettings';
import { FALLBACK_APP_NAME } from '@/lib/tenant-defaults';

interface SEOProps {
  title: string;
  description?: string;
  keywords?: string;
  schema?: any;
  canonical?: string;
}

const SEO = ({ title, description, keywords, schema, canonical }: SEOProps) => {
  const { branding } = useBrandingSettings();

  /* The tenant's OWN origin. This was hardcoded to our domain, so a tenant's
     canonical URL and og:image both pointed at drive247.com from their site. */
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const appName = branding.app_name || FALLBACK_APP_NAME;
  const fullTitle = `${appName} | ${title}`;

  // Use OG image from branding settings, fall back to favicon
  const ogImage = branding.og_image_url || `${siteUrl}/favicon.png`;

  // Use description from props, or fall back to branding meta_description
  const metaDescription = description || branding.meta_description || 'Premium car rental services';

  useEffect(() => {
    // Set title
    document.title = fullTitle;

    // Helper to set or update meta tag
    const setMetaTag = (property: string, content: string, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attr}="${property}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attr, property);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    // Basic meta tags
    setMetaTag('description', metaDescription);
    if (keywords) setMetaTag('keywords', keywords);

    // Open Graph
    setMetaTag('og:title', fullTitle, true);
    setMetaTag('og:description', metaDescription, true);
    setMetaTag('og:type', 'website', true);
    setMetaTag('og:url', canonical || siteUrl, true);
    setMetaTag('og:image', ogImage, true);
    setMetaTag('og:image:width', '1200', true);
    setMetaTag('og:image:height', '630', true);
    setMetaTag('og:site_name', appName, true);

    // Twitter Card
    setMetaTag('twitter:card', 'summary_large_image');
    setMetaTag('twitter:title', fullTitle);
    setMetaTag('twitter:description', metaDescription);
    setMetaTag('twitter:image', ogImage);

    // Canonical link
    if (canonical) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', canonical);
    }

    // Schema.org
    if (schema) {
      let script = document.querySelector('script[type="application/ld+json"]');
      if (!script) {
        script = document.createElement('script');
        script.setAttribute('type', 'application/ld+json');
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(schema);
    }
  }, [fullTitle, metaDescription, keywords, canonical, ogImage, appName, schema, siteUrl]);

  return null;
};

export default SEO;
