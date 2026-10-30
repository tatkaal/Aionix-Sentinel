import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node tests/e2e/serve-fixtures.mjs',
    port: 4173,
    reuseExistingServer: true,
  },
});
