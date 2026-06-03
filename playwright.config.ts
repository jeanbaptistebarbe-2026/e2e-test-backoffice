import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      // Authentification Auth0 + OTP — produit le storageState réutilisé ensuite
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      timeout: 180_000,
    },
    {
      // Tests du flux de login Auth0 — s'exécutent SANS authentification
      name: 'logged-out',
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
      testMatch: /login\.spec\.ts/,
    },
    {
      // Tests authentifiés — réutilisent le storageState produit par "setup"
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/, /login\.spec\.ts/],
    },
  ],
});
