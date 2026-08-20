import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end run, which is the only test in this repository that exercises
 * the whole thing at once.
 *
 * Everything else proves a part in isolation: the backend's integration tests
 * prove the API against a real database, the unit tests prove services and
 * geometry against fixtures. Both can pass while the application shows an
 * empty screen, because what joins them is a browser fetching config.json,
 * signing in through Keycloak, and calling an address it was told at start-up.
 * That seam is where this project's production defects have actually been, and
 * it has had no test until now.
 *
 * It expects a stack that is already up and already seeded. Starting one from
 * here would mean this file knowing about docker compose, the seed script and
 * the order between them, and the two places that already know that — the
 * README and the CI workflow — would then disagree with it sooner or later.
 */
export default defineConfig({
  testDir: './e2e',

  // The plan is shared state: two workers signing in as the same demo account
  // and editing the same project would fail each other rather than the code.
  workers: 1,
  fullyParallel: false,

  // A sign-in is three redirects and a token exchange, and CI runners are
  // slower than laptops at all four.
  timeout: 60_000,
  expect: { timeout: 15_000 },

  // Locally a failure is worth seeing once and fixing. On CI a flake costs a
  // rerun of everything, and a retry that passes is still reported as flaky
  // rather than swallowed.
  retries: process.env['CI'] ? 2 : 0,
  forbidOnly: !!process.env['CI'],

  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',

    // Kept only for the runs that fail, which is the only time anybody looks
    // at them, and a trace of every pass is a hundred megabytes of nothing.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
