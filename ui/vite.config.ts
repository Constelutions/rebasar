/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Rendering the app under jsdom on a 4-core CI runner is several times slower than on a
    // developer machine; the default 5s limit fails tests that are merely slow, not broken.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
