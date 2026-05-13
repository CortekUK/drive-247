import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { JsonLd } from "@/components/shared/json-ld";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { SITE_META, SITE_URL } from "@/lib/constants";
import "./globals.css";

const META_PIXEL_ID = "2196369497442053";

const META_PIXEL_SCRIPT = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`;

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: SITE_META.title,
  description: SITE_META.description,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: SITE_META.title,
    description: SITE_META.description,
    url: SITE_URL,
    siteName: "Drive247",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Drive247 — Direct Booking Platform" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_META.title,
    description: SITE_META.description,
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  verification: {
    other: {
      "facebook-domain-verification": "d8r57mrtpaj0kmrw3dhhf7nmdq76pb",
    },
  },
};

const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Drive247",
  url: SITE_URL,
  logo: `${SITE_URL}/logo-light.png`,
};

const softwareLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Drive247",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: SITE_META.description,
  offers: {
    "@type": "Offer",
    availability: "https://schema.org/InStock",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <JsonLd data={organizationLd} />
        <JsonLd data={softwareLd} />
        <script dangerouslySetInnerHTML={{ __html: META_PIXEL_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            alt=""
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Skip to content
          </a>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
