import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/test/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Several test files import `test` from node:test (Node's built-in
      // runner). Vitest doesn't collect suites registered through that
      // runner ("No test suite found in file"), so redirect it to vitest's
      // own test API, which is call-signature compatible for the plain
      // test(name, fn) usage in this codebase.
      'node:test': 'vitest',
    },
  },
});
