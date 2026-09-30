import { Page } from '@playwright/test';
import { test, loggedOutTest, expect, freshLoggedInContext } from '../fixtures';
import { AppShell } from '../../pages/AppShell';
import { QgApi } from '../../utils/api';
import { roleAvailable } from '../../utils/roles';

// Authentification AVEC session : atterrissage selon le rôle, garde des routes,
// déconnexion. Réf. : swapn-qg-source-de-verite.md §2.2–2.4, §3.3, RG-AUTH-003.

async function collaboratorRole(page: Page): Promise<string> {
  const api = await QgApi.fromPage(page);
  try {
    return (await api.me()).role;
  } finally {
    await api.dispose();
  }
}

test.describe('Authentification — ADMIN', { tag: ['@auth', '@readonly', '@role-admin'] }, () => {
  test(
    'la session est vérifiée et l’utilisateur atterrit sur l’Inbox',
    { tag: ['@TC-AUTH-10', '@p0', '@smoke'] },
    async ({ page }) => {
      const shell = new AppShell(page);
      const me = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/collaborators/me' && r.request().method() === 'GET',
      );
      await shell.goto('/');

      expect((await me).status()).toBe(200);
      await expect(page).toHaveURL(/qg\.swapn\.tech\/(\?.*)?$/);
      await expect(page.getByRole('heading', { level: 1, name: /^Ouvert \(\d+\)$/ })).toBeVisible({ timeout: 20_000 });
      await expect(shell.railButton('Inbox')).toBeVisible();
    },
  );

  test(
    'un ADMIN n’accède pas aux routes réservées au SUPER_ADMIN',
    { tag: ['@TC-AUTH-16', '@p1'] },
    async ({ page }) => {
      const shell = new AppShell(page);
      await shell.goto('/');
      await expect(shell.railButton('Inbox')).toBeVisible({ timeout: 20_000 });
      test.skip(
        (await collaboratorRole(page)) === 'SUPER_ADMIN',
        'Compte « admin » actuellement SUPER_ADMIN : ces routes lui sont autorisées',
      );

      for (const path of ['/administration/domaines-internes', '/administration/regles-de-routage']) {
        await shell.goto(path);
        await shell.expectAccessDenied();
      }
    },
  );
});

test.describe('Authentification — BPO', { tag: ['@auth', '@readonly', '@role-bpo'] }, () => {
  test.skip(!roleAvailable('bpo'), 'Compte BPO non renseigné (AUTH_EMAIL_BPO / AUTH_PASSWORD_BPO)');
  test.use({ role: 'bpo' });

  test(
    'le BPO atterrit sur « Contrôles » (/tickets) depuis l’accueil',
    { tag: ['@TC-AUTH-11', '@p0'] },
    async ({ page }) => {
      const shell = new AppShell(page);
      await shell.goto('/');
      await expect(page).toHaveURL(/\/tickets$/, { timeout: 20_000 });
      await expect(page.getByText(/^Fil de l.eau$/)).toBeVisible();
    },
  );

  test(
    'le BPO reçoit « Accès refusé » sur les routes hors de son périmètre',
    { tag: ['@TC-AUTH-15', '@p0'] },
    async ({ page }) => {
      const shell = new AppShell(page);
      for (const path of ['/annuaire', '/inbox', '/calendar', '/administration/templates', '/tickets/sla-kpi']) {
        await shell.goto(path);
        await shell.expectAccessDenied();
      }
    },
  );
});

loggedOutTest.describe('Authentification — déconnexion', { tag: ['@auth', '@readonly', '@role-admin'] }, () => {
  loggedOutTest(
    'la déconnexion purge les jetons et une nouvelle visite relance la connexion',
    { tag: ['@TC-AUTH-14', '@p1'] },
    async ({ browser }) => {
      // Session PRIVÉE : la déconnexion révoque le refresh token, elle ne doit pas
      // toucher la session partagée des autres tests.
      const context = await freshLoggedInContext(browser, 'admin');
      try {
        const page = context.pages()[0];
        const shell = new AppShell(page);
        await shell.goto('/');
        await expect(shell.railButton('Inbox')).toBeVisible({ timeout: 20_000 });

        await shell.logout();
        // Redirection vers l'IdP puis retour sur /auth → écran de login Auth0.
        await page.waitForURL(/auth0\.tiime\.fr|\/auth(\?|$)/, { timeout: 30_000 });

        const state = await context.storageState();
        const qg = state.origins.find((o) => o.origin.includes('qg.swapn.tech'));
        const keys = (qg?.localStorage ?? []).map((e) => e.name);
        expect(keys).not.toContain('access_token');
        expect(keys).not.toContain('refresh_token');

        await shell.goto('/');
        await expect(page).toHaveURL(/auth0\.tiime\.fr\/u\/login/, { timeout: 30_000 });
      } finally {
        await context.close();
      }
    },
  );
});
