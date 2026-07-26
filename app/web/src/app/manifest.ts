import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SLVRline Advanced Analytics",
    short_name: "SLVR Analytics",
    description:
      "Advanced SLVR mining, staking, holder, liquidity, and RWA analytics for Robinhood Chain.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#07090d",
    theme_color: "#07090d",
    categories: ["finance", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
