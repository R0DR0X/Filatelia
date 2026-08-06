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
      // `/colecciones` used to be an empty directory that 404'd, and this
      // redirect was the patch for it. E4 built the real page, so the patch
      // now shadows the feature it was standing in for: the route deployed
      // fine and still answered 308 to /catalogo.
      //
      // It was `permanent: true`, so browsers and intermediaries cached the
      // 308. Anyone who opened /colecciones before this shipped will keep
      // being redirected until their cache expires — hard-refresh or a
      // private window to confirm the fix.
    ];
  },
};

export default nextConfig;
