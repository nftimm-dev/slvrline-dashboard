import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SLVRline — SLVR Protocol Analytics",
  description:
    "Independent analytics for the SLVR mining protocol on Robinhood Chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
