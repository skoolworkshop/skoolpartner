import type { NextConfig } from "next";

/**
 * Beveiligingsheaders voor alle routes.
 * SkoolPartner is een afgeschermd klantportaal: het mag niet in een iframe
 * worden geladen en hoeft niet door zoekmachines te worden geïndexeerd.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    // De workshopfoto's staan op de eigen website van Skool Workshop. Zo hoeven
    // ze niet gekopieerd te worden en blijft één plek de bron.
    remotePatterns: [
      { protocol: "https", hostname: "skoolworkshop.nl", pathname: "/wp-content/uploads/**" },
      { protocol: "https", hostname: "www.skoolworkshop.nl", pathname: "/wp-content/uploads/**" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
