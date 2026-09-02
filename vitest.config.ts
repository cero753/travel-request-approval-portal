import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite resolves the "@/*" alias from tsconfig.json natively; the
  // vite-tsconfig-paths plugin is no longer needed.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Integration tests drive a real dev server over real HTTP; they are slow
    // and must not be torn down mid-request.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
