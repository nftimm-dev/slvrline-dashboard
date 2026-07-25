import type { MetadataRoute } from "next";

const routes = [
  "",
  "/earn",
  "/staking",
  "/holders",
  "/markets",
  "/mining",
  "/methodology",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://analytics.slvrline.fun${route || "/"}`,
    changeFrequency: route === "" ? "hourly" : "daily",
    priority: route === "" ? 1 : 0.8,
  }));
}
