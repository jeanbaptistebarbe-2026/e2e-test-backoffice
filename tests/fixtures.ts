import { test as base, expect, Browser } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { LoginPage } from '../pages/LoginPage';

/**
 * Base de test partagée par tous les specs.
 *
 * 1) Capture d'écran automatique attachée au rapport en cas d'échec (debug visuel).
 * 2) Authentification **en code** (et non via les `projects`/`dependencies` de
 *    playwright.config.ts, ignorés par l'orchestrateur SquashTM) : chaque spec
 *    authentifié est ainsi autonome et exécutable par le runner.
 *
 * Deux variantes exportées :
 *   - `test`          → authentifié (réutilise une session obtenue une seule fois).
 *   - `loggedOutTest` → contexte vierge (pour tester le flux de login lui-même).
 */

const AUTH_DIR = path.resolve(__dirname, '..', 'playwright', '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');
const LOCK_FILE = path.join(AUTH_DIR, 'user.lock');
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // on réutilise un état de moins de 10 min
const LOCK_STALE_MS = 5 * 60 * 1000; // on vole un verrou de plus de 5 min (run crashé)
const WAIT_FOR_STATE_MS = 180 * 1000; // attente max qu'un autre worker produise l'état

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stateIsFresh(): boolean {
  try {
    return Date.now() - fs.statSync(AUTH_FILE).mtimeMs < STATE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function tryAcquireLock(): boolean {
  try {
    if (fs.existsSync(LOCK_FILE) && Date.now() - fs.statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) {
      fs.rmSync(LOCK_FILE, { force: true });
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' }); // échoue si déjà présent
    return true;
  } catch {
    return false;
  }
}

async function performLogin(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await new LoginPage(page).loginWithOtp();

    // Gestion défensive d'une éventuelle page CGU après la connexion.
    const cgu = page.locator('#cgu-checkbox');
    const cguAppeared = await cgu
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (cguAppeared) {
      await cgu.click();
      await page.locator('#privacy-checkbox').click();
      await page.getByRole('button', { name: 'Valider' }).click();
    }

    await context.storageState({ path: AUTH_FILE });
  } finally {
    await context.close();
  }
}

/**
 * Garantit un état d'authentification réutilisable et renvoie le chemin du fichier
 * `storageState`. Se connecte **une seule fois** (login + MFA e-mail), met l'état en
 * cache sur disque, et sérialise via un verrou fichier pour qu'un seul worker se
 * connecte à la fois (les autres réutilisent le fichier produit). Remplace l'ancien
 * projet `setup` + `dependencies` de la config.
 */
async function ensureAuthState(browser: Browser): Promise<string> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  if (stateIsFresh()) return AUTH_FILE;

  let held = tryAcquireLock();
  if (!held) {
    const deadline = Date.now() + WAIT_FOR_STATE_MS;
    while (!held && Date.now() < deadline) {
      await sleep(1000);
      if (stateIsFresh()) return AUTH_FILE; // un autre worker a produit l'état
      held = tryAcquireLock(); // …ou le détenteur a abandonné
    }
    if (!held) {
      fs.rmSync(LOCK_FILE, { force: true }); // dernier recours : verrou bloqué
      held = tryAcquireLock();
    }
  }

  try {
    await performLogin(browser);
    return AUTH_FILE;
  } finally {
    if (held) fs.rmSync(LOCK_FILE, { force: true });
  }
}

// Base commune : screenshot d'échec attaché au rapport (fonctionne local ET Squash).
const baseTest = base.extend<{ autoScreenshotOnFailure: void }>({
  autoScreenshotOnFailure: [
    async ({ page }, use, testInfo) => {
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await page
          .screenshot({ fullPage: true })
          .catch(() => null); // page parfois déjà fermée (crash) → on n'échoue pas le teardown
        if (screenshot) {
          await testInfo.attach('screenshot-échec', {
            body: screenshot,
            contentType: 'image/png',
          });
        }
      }
    },
    { auto: true },
  ],
});

/** Test authentifié : injecte une session obtenue/mise en cache via `ensureAuthState`. */
export const test = baseTest.extend({
  storageState: async ({ browser }, use) => {
    await use(await ensureAuthState(browser));
  },
});

/** Test « logged-out » : contexte vierge, pour valider le flux de login. */
export const loggedOutTest = baseTest.extend({
  storageState: async ({}, use) => {
    await use({ cookies: [], origins: [] });
  },
});

export { expect };
