/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],

  // The key worker is an ES module so it can `import` the ssh and crypto
  // services directly instead of being bundled as a classic worker script.
  // Vite builds workers through a separate plugin chain, so the `@/` alias has
  // to be registered again here or the worker entry fails to resolve.
  worker: { format: 'es', plugins: () => [tsconfigPaths()] },

  optimizeDeps: {
    // Both are CommonJS. Pre-bundling them keeps the dev server from
    // re-transforming them on every worker reload.
    include: ['bcrypt-pbkdf', 'tweetnacl'],
  },

  test: {
    // The sweep engine and its parsers are environment-free; component tests
    // opt into jsdom per-file with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
