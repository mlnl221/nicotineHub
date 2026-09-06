import type { MetadataRoute } from "next";
const SITE_URL = "https://nicotine-hub-web-phi.vercel.app";
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }], sitemap: `${SITE_URL}/sitemap.xml` };
}
