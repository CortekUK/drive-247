import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force ONE React copy under test.
      //
      // This monorepo has react/react-dom 19.2.3 hoisted at the root AND a
      // stale 18.3.1 nested in apps/portal/node_modules, while every UI
      // dependency (@radix-ui/*, lucide-react) lives at the root and therefore
      // binds to 19.2.3. Without this alias, app code resolves 18.3.1, Radix
      // resolves 19.2.3, and any test that RENDERS a Radix component dies with
      // "Objects are not valid as a React child" — React 19 tags elements
      // `react.transitional.element`, which React 18's reconciler rejects.
      //
      // 19.2.3 is what apps/portal/package.json actually declares (^19.2.3),
      // so pinning to the root copy matches the intended version rather than
      // the leftover nested one. Nothing here changed for the existing
      // logic-only suites; it only makes render tests possible at all.
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
});
