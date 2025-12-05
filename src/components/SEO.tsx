import { Helmet } from "react-helmet";
import { useBrandingSettings } from "@/hooks/useBrandingSettings";

interface SEOProps {
  title: string;
  description?: string;
  keywords?: string;
  schema?: any;
  canonical?: string;
}

const SEO = ({ title, description, keywords, schema, canonical }: SEOProps) => {
  const { branding } = useBrandingSettings();

  const siteUrl = "https://drive917.com";
  const appName = branding.app_name || "Drive917";
  const fullTitle = `${appName} | ${title}`;

  // Use OG image from branding settings, fall back to favicon
  const ogImage = branding.og_image_url || `${siteUrl}/favicon.png`;

  // Use description from props, or fall back to branding meta_description
  const metaDescription = description || branding.meta_description || "Premium car rental services in Dallas, TX";

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={metaDescription} />
      {keywords && <meta name="keywords" content={keywords} />}

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDescription} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={canonical || siteUrl} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:site_name" content={appName} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDescription} />
      <meta name="twitter:image" content={ogImage} />

      {/* Canonical */}
      {canonical && <link rel="canonical" href={canonical} />}

      {/* Schema.org */}
      {schema && (
        <script type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      )}
    </Helmet>
  );
};

export default SEO;
