import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

// Résolution robuste du baseURL : on utilise `||` (et non `??`) + trim pour que
// BASE_URL absent OU vide (chaîne "") OU constitué d'espaces retombe sur le défaut
// public. Sur un runner CI, la variable peut être injectée vide, ce que `??` ne
// rattraperait pas.
const BASE_URL = process.env.BASE_URL?.trim() || 'https://qg.swapn.tech/';

// Trace de diagnostic Squash (baseURL résolu + marqueur de build, pour vérifier
// quel commit tourne sur le runner). Activée uniquement avec DEBUG_E2E afin de
// garder une sortie propre par défaut.
if (process.env.DEBUG_E2E) {
  console.log(
    `[playwright.config] baseURL résolu = ${BASE_URL} | BASE_URL env = ` +
      (process.env.BASE_URL === undefined ? 'absent' : JSON.stringify(process.env.BASE_URL)) +
      ' | marqueur build = baseurl-fallback-v2',
  );
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 1 retry en local : la cible (preprod distante partagée) a des à-coups de
  // latence → absorbe les timeouts transitoires sans masquer un vrai échec
  // (un test qui échoue 2 fois de suite reste rouge).
  retries: process.env.CI ? 2 : 1,
  // Cible distante (preprod) : on borne le parallélisme local pour ne pas la
  // saturer (sinon chargements lents → timeouts intermittents).
  workers: process.env.CI ? 1 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Élevé car l'authentification (login + MFA e-mail) est faite à la volée dans une
  // fixture (cf. tests/fixtures.ts) et peut prendre jusqu'à ~2 min la première fois.
  timeout: 180_000,
  // Marge pour les assertions web-first (données de liste chargées en async).
  expect: { timeout: 10_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  // Pas de `projects` ni de `dependencies` : l'authentification est gérée par une
  // fixture EN CODE (autonome), pour que chaque spec soit exécutable par SquashTM
  // qui ignore ce playwright.config.ts. Un seul projet Chromium implicite.
});
