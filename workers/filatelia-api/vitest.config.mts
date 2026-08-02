import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // Test-only value for the service-token dual-accept path in
      // `requireAdmin`; never a real secret. Overrides the (absent) prod
      // `ADMIN_API_TOKEN`, which is provisioned as a Worker secret, not a
      // wrangler.toml var (see openspec/changes/unified-session/tasks.md 3.4).
      miniflare: {
        bindings: { ADMIN_API_TOKEN: 'test-admin-service-token-0123456789' },
      },
    }),
  ],
});
