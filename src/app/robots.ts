import type { MetadataRoute } from "next";

// Trial not launched: nothing is crawlable until the owner-approved launch
// wave flips this with the real sitemap (#14A §15.3).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
