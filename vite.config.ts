import { defineConfig } from "vite";

export default defineConfig({
  base: "/password-locker/",
  define: { global: "globalThis" },
  worker: { format: "es" },
  build: { target: "es2022" },
  test: { testTimeout: 60000 },
} as any);
