import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Whitelist remote image hosts used by Next/Image. MMP currently
  // ships products with their assets hosted on Shopify CDN; if MMP
  // later migrates to its own bucket we'll add that host here too.
  // The product detail page uses `unoptimized` as a safety net so a
  // missed host doesn't break the gallery, but listing every known
  // host keeps Image() served via Next's optimiser when available.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.shopify.com' },
    ],
  },
};

export default nextConfig;
