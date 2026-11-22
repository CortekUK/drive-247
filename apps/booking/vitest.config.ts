import { defineConfig } from "vitest/config";
import path from "path";

// Pure-module tests only (src/__tests__/**). The aliases match tsconfig.json so
// a test may import through `@nw/...` the way the app does.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@nw": path.resolve(__dirname, "./src/northwind-site"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
