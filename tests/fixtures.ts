import { test as base, expect, Browser } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { LoginPage } from '../pages/LoginPage';
import { loadSecrets } from '../utils/secrets';
import { credentialsFor, type Role } from '../utils/roles';
import { PageHealth } from '../utils/page-health';

// Déchiffre et injecte les secrets dans process.env dès le chargement du module
// (importé par tous les specs) — fonctionne aussi sous SquashTM qui ignore la config.
loadSecrets();

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
 *                       Rôle `admin` par défaut ; `test.use({ role: 'bpo' })` pour le BPO.
 *   - `loggedOutTest` → contexte vierge (pour tester le flux de login lui-même).
 *
 * Fixture `health` (auto) : collecte erreurs JS, console et 5xx de l'API ; jointe au
 * rapport, et assertable par `health.expectClean()` (cf. utils/page-health.ts).
 */

const AUTH_DIR = path.resolve(__dirname, '..', 'playwright', '.auth');
/** Fichier storageState d'un rôle (une session en cache par rôle). */
export const authFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`);
const lockFile = (role: Role) => path.join(AUTH_DIR, `${role}.lock`);
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // on réutilise un état de moins de 10 min
const LOCK_STALE_MS = 5 * 60 * 1000; // on vole un verrou de plus de 5 min (run crashé)
const WAIT_FOR_STATE_MS = 180 * 1000; // attente max qu'un autre worker produise l'état

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stateIsFresh(role: Role): boolean {
  try {
    return Date.now() - fs.statSync(authFile(role)).mtimeMs < STATE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function tryAcquireLock(role: Role): boolean {
  const lock = lockFile(role);
  try {
    if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
      fs.rmSync(lock, { force: true });
    }
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); // échoue si déjà présent
    return true;
  } catch {
    return false;
  }
}

async function performLogin(browser: Browser, role: Role): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const creds = credentialsFor(role);
    await new LoginPage(page).loginWithOtp(creds.email, creds.password, {
      user: creds.imapUser,
      password: creds.imapPassword,
    });

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

    await context.storageState({ path: authFile(role) });
  } finally {
    await context.close();
  }
}

/**
 * Garantit un état d'authentification réutilisable pour un rôle et renvoie le chemin
 * du fichier `storageState`. Se connecte **une seule fois** par rôle (login + MFA
 * e-mail), met l'état en cache sur disque, et sérialise via un verrou fichier pour
 * qu'un seul worker se connecte à la fois (les autres réutilisent le fichier
 * produit). Remplace l'ancien projet `setup` + `dependencies` de la config.
 */
export async function ensureAuthState(browser: Browser, role: Role = 'admin'): Promise<string> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const file = authFile(role);
  if (stateIsFresh(role)) return file;

  let held = tryAcquireLock(role);
  if (!held) {
    const deadline = Date.now() + WAIT_FOR_STATE_MS;
    while (!held && Date.now() < deadline) {
      await sleep(1000);
      if (stateIsFresh(role)) return file; // un autre worker a produit l'état
      held = tryAcquireLock(role); // …ou le détenteur a abandonné
    }
    if (!held) {
      fs.rmSync(lockFile(role), { force: true }); // dernier recours : verrou bloqué
      held = tryAcquireLock(role);
    }
  }

  try {
    await performLogin(browser, role);
    return file;
  } finally {
    if (held) fs.rmSync(lockFile(role), { force: true });
  }
}

// Base commune : timeout relevé + artefacts d'échec (capture + trace) écrits comme
// FICHIERS dans le dossier d'artefacts du test (test-results/…), donc collectables par
// la fonctionnalité « attachments » de SquashTM. Tout est fait EN CODE car le runner
// ignore la config (reporter, use.trace, timeout).
const baseTest = base.extend<{ autoArtifacts: void; health: PageHealth }>({
  // Contexte navigateur français, fixé EN CODE (le runner ignore `use` de la config) :
  // dates relatives, formats `dd/MM` et préréglages de snooze en dépendent.
  locale: async ({}, use) => {
    await use('fr-FR');
  },
  timezoneId: async ({}, use) => {
    await use('Europe/Paris');
  },

  health: [
    async ({ page }, use, testInfo) => {
      const health = new PageHealth(page);
      await use(health);
      await health.attachTo(testInfo);
    },
    { auto: true },
  ],

  autoArtifacts: [
    async ({ page, context }, use, testInfo) => {
      // Le runner applique son timeout par défaut (30 s), trop court pour la préprod
      // distante → on le relève en code.
      testInfo.setTimeout(120_000);

      // Trace EN CODE (le runner ignore `use.trace`). Démarrage défensif : si une trace
      // est déjà active (cas où le runner l'aurait activée), on ne la double pas.
      let tracingOwned = false;
      try {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        tracingOwned = true;
      } catch {
        /* trace déjà démarrée ailleurs → on laisse faire */
      }

      await use();

      const failed = testInfo.status !== testInfo.expectedStatus;

      // Trace conservée UNIQUEMENT sur échec, dans le dossier d'artefacts du test.
      // Le .zip est autoportant → ouvrable sur https://trace.playwright.dev
      if (tracingOwned) {
        try {
          const tracePath = testInfo.outputPath('trace.zip');
          await context.tracing.stop(failed ? { path: tracePath } : {});
          if (failed) {
            await testInfo.attach('trace', { path: tracePath, contentType: 'application/zip' });
          }
        } catch {
          /* contexte déjà fermé (crash) → on n'échoue pas le teardown */
        }
      }

      // Capture d'écran d'échec : écrite comme FICHIER (collectable) + attachée au rapport.
      if (failed) {
        const shotPath = testInfo.outputPath('screenshot.png');
        const ok = await page
          .screenshot({ path: shotPath, fullPage: true })
          .then(() => true)
          .catch(() => false); // page parfois déjà fermée (crash)
        if (ok) {
          await testInfo
            .attach('screenshot-échec', { path: shotPath, contentType: 'image/png' })
            .catch(() => {});
        }
      }
    },
    { auto: true },
  ],
});

/**
 * Test authentifié : injecte la session du rôle (`role`, défaut `admin`), obtenue et
 * mise en cache via `ensureAuthState`. Changer de rôle : `test.use({ role: 'bpo' })`.
 */
export const test = baseTest.extend<{ role: Role }>({
  role: ['admin', { option: true }],
  storageState: [
    async ({ browser, role }, use) => {
      await use(await ensureAuthState(browser, role));
    },
    // Timeout DÉDIÉ à la mise en place de l'auth (login + MFA e-mail Auth0, jusqu'à
    // ~2 min de latence sur l'OTP), distinct du timeout de test. Indispensable car le
    // runner SquashTM ignore `timeout` de playwright.config.ts et plafonne à 30 s,
    // ce qui coupait le `setup` de `storageState` en plein login.
    { scope: 'test', timeout: 200_000 },
  ],
});

/** Test « logged-out » : contexte vierge, pour valider le flux de login. */
export const loggedOutTest = baseTest.extend({
  storageState: async ({}, use) => {
    await use({ cookies: [], origins: [] });
  },
});

export { expect };
