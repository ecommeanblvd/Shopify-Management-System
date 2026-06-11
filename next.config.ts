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
  // URL cũ của 3 trang kho (trước 2026-06-11 nằm dưới /f/fulfillment) —
  // redirect vĩnh viễn để bookmark/link nội bộ cũ không chết.
  async redirects() {
    return [
      { source: '/f/fulfillment/warehouse', destination: '/f/warehouse', permanent: true },
      { source: '/f/fulfillment/staging', destination: '/f/warehouse/staging', permanent: true },
      { source: '/f/fulfillment/receiving', destination: '/f/warehouse/receiving', permanent: true },
      { source: '/f/fulfillment/receiving/:id', destination: '/f/warehouse/receiving/:id', permanent: true },
    ];
  },
};

export default nextConfig;
