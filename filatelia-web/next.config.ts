import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      { source: '/catalogo/:slug', destination: '/catalogo', permanent: true },
      { source: '/colecciones', destination: '/catalogo', permanent: true },
    ];
  },
};

export default nextConfig;
