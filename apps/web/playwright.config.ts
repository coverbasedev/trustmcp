import { defineConfig } from "@playwright/test";

// e2e tests assume the web app is running at baseURL with a network + Postgres behind
// it (see .github/workflows/e2e.yml). Dev login must be enabled (AUTH_DEV_LOGIN=1).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
});
