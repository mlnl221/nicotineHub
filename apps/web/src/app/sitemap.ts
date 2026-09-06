import type { MetadataRoute } from "next";
const SITE_URL = "https://nicotine-hub-web-phi.vercel.app";
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/browse`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];
}
