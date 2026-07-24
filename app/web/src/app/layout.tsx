import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";

export const metadata: Metadata = {
  title: "SLVRline — SLVR Protocol Analytics",
  description:
    "Independent source of truth for SLVR mining vitals: Dividends APR, staking, supply, runway, and price on Robinhood Chain.",
  openGraph: {
    title: "SLVRline",
    description:
      "Live SLVR protocol analytics — independently computed from indexed chain data.",
    url: "https://slvrline.xyz",
    siteName: "SLVRline",
  },
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
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
