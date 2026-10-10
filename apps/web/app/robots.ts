import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { robotsDisallow } from "@/lib/seo/private-routes";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: robotsDisallow },
    sitemap: `${env.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
