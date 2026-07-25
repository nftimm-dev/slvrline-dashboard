import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/layout/SiteFooter";

const title = "SLVRline Analytics | Robinhood Chain Protocol Intelligence";
const description =
  "Independent SLVR analytics for Robinhood Chain: mining, staking, holders, liquidity, supply, APR, and onchain RWA protocol intelligence.";

export const metadata: Metadata = {
  metadataBase: new URL("https://analytics.slvrline.fun"),
  applicationName: "SLVRline Analytics",
  title: {
    default: title,
    template: "%s | SLVRline Analytics",
  },
  description,
  keywords: [
    "SLVR analytics",
    "Robinhood Chain analytics",
    "Robinhood blockchain",
    "RWA analytics",
    "real-world assets",
    "tokenized real-world assets",
    "onchain analytics",
    "SLVR mining",
    "veSLVR staking",
    "DeFi analytics",
    "protocol analytics",
  ],
  authors: [
    {
      name: "SLVRline Analytics",
      url: "https://analytics.slvrline.fun",
    },
  ],
  creator: "SLVRline Analytics",
  publisher: "SLVRline Analytics",
  category: "finance",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description,
    url: "https://analytics.slvrline.fun/",
    siteName: "SLVRline Analytics",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SLVRline advanced protocol analytics on Robinhood Chain",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07090d",
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "SLVRline Analytics",
  alternateName: "SLVRline Advanced Analytics",
  url: "https://analytics.slvrline.fun/",
  description,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  isAccessibleForFree: true,
  keywords:
    "SLVR analytics, Robinhood Chain, RWA analytics, real-world assets, onchain analytics, DeFi analytics",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        style={{
          minHeight: "100vh",
          backgroundColor: "var(--color-silver-950)",
          color: "var(--color-silver-300)",
          margin: 0,
          padding: 0,
        }}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
