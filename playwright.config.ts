import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js apps/even-nav --host 127.0.0.1`,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    env: { VITE_WORKER_ORIGIN: "https://worker.test" },
  },
});
