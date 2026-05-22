import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { Providers } from "./providers";
import "@/global.css";

export const dynamic = "force-dynamic";

const defaultMetadata: Metadata = {
  title: "Drive247 Portal",
  description: "Multi-tenant fleet management portal",
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");

    if (!tenantSlug) return defaultMetadata;

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return defaultMetadata;
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data: tenant } = await supabase
      .from("tenants")
      .select(
        "app_name, company_name, meta_title, meta_description, favicon_url, og_image_url"
      )
      .eq("slug", tenantSlug)
      .single();

    if (!tenant) return defaultMetadata;

    const brandName =
      tenant.app_name || tenant.company_name || "Drive247";
    const title =
      tenant.meta_title || `${brandName} - Portal`;
    const description =
      tenant.meta_description ||
      `${brandName} fleet management portal`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        siteName: brandName,
        type: "website",
        images: tenant.og_image_url ? [tenant.og_image_url] : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: tenant.og_image_url ? [tenant.og_image_url] : undefined,
      },
      icons: tenant.favicon_url
        ? { icon: tenant.favicon_url, shortcut: tenant.favicon_url }
        : undefined,
    };
  } catch (error) {
    console.error("Error generating portal metadata:", error);
    return defaultMetadata;
  }
}

const brandingScript = `
(function() {
  try {
    var cached = localStorage.getItem('portal-tenant-branding-css');
    if (cached) {
      var style = document.createElement('style');
      style.id = 'cached-branding';
      style.textContent = cached;
      document.head.appendChild(style);
    }
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: brandingScript }} />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
