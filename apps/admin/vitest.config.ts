import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vitest for apps/admin, mirroring apps/portal/vitest.config.ts.
 *
 * The one real difference is the `@` alias. In apps/portal `@` maps to `./src`;
 * in this app tsconfig.json says `"@/*": ["./*"]`, i.e. the project ROOT, and
 * the code lives at the root too (app/, components/, hooks/, lib/, store/). So
 * `@/lib/notifications-v2/types` must resolve to apps/admin/lib/notifications-v2/types.
 *
 * Aliasing the bare string `@` is safe next to scoped packages: Vite matches a
 * string alias only when the import equals it or starts with it plus a slash,
 * so `@/lib/x` is rewritten and `@testing-library/jest-dom` is not.
 *
 * Tests live in __tests__/ at the app root rather than src/__tests__/, because
 * this app has no src/ tree (only src/integrations/ for the Supabase client).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
      exclude: ['__tests__/**', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Force ONE React copy under test, as apps/portal does.
      //
      // apps/admin currently has no nested react/react-dom, so everything
      // already binds to the hoisted root copy (19.2.3, exactly what this
      // app's package.json asks for). Pinning it keeps that true if a later
      // install ever drops a second copy in apps/admin/node_modules: two React
      // copies make any test that RENDERS a Radix component die with "Objects
      // are not valid as a React child".
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
});
