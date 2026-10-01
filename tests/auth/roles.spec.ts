import { Page } from '@playwright/test';
import { test, loggedOutTest, expect, freshLoggedInContext } from '../fixtures';
import { AppShell } from '../../pages/AppShell';
import { QgApi } from '../../utils/api';
import { roleAvailable } from '../../utils/roles';
import { meta } from '../meta';

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

test.describe('Authentification — ADMIN', { tag: ['@role-admin', '@auth'] }, () => {
  test(
    'la session est vérifiée et l’utilisateur atterrit sur l’Inbox',
    meta('TC-AUTH-10', 'Ouvre le backoffice avec la session admin : la session est vérifiée (GET /collaborators/me = 200) et l’utilisateur arrive sur l’Inbox « Ouvert (N) ».'),
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
    meta('TC-AUTH-16', 'Avec un compte ADMIN, ouvre « Domaines internes » et « Règles de routage » et vérifie la carte « Accès refusé ». Sauté si le compte est SUPER_ADMIN.'),
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

test.describe('Authentification — BPO', { tag: ['@role-bpo', '@auth'] }, () => {
  test.skip(!roleAvailable('bpo'), 'Compte BPO non renseigné (AUTH_EMAIL_BPO / AUTH_PASSWORD_BPO)');
  test.use({ role: 'bpo' });

  test(
    'le BPO atterrit sur « Contrôles » (/tickets) depuis l’accueil',
    meta('TC-AUTH-11', 'Avec la session BPO, ouvre l’accueil et vérifie la redirection vers « Contrôles » (/tickets).'),
    async ({ page }) => {
      const shell = new AppShell(page);
      await shell.goto('/');
      await expect(page).toHaveURL(/\/tickets$/, { timeout: 20_000 });
      await expect(page.getByText(/^Fil de l.eau$/)).toBeVisible();
    },
  );

  test(
    'le BPO reçoit « Accès refusé » sur les routes hors de son périmètre',
    meta('TC-AUTH-15', 'Avec la session BPO, ouvre Annuaire, Inbox, Agenda, Templates et KPIs tickets, et vérifie la carte « Accès refusé » à chaque fois.'),
    async ({ page }) => {
      const shell = new AppShell(page);
      for (const path of ['/annuaire', '/inbox', '/calendar', '/administration/templates', '/tickets/sla-kpi']) {
        await shell.goto(path);
        await shell.expectAccessDenied();
      }
    },
  );
});

loggedOutTest.describe('Authentification — déconnexion', { tag: ['@role-admin', '@auth'] }, () => {
  loggedOutTest(
    'la déconnexion purge les jetons et une nouvelle visite relance la connexion',
    meta('TC-AUTH-14', 'Se connecte dans une session dédiée, se déconnecte par le menu de l’avatar, puis vérifie que les jetons sont supprimés et qu’une nouvelle visite ramène à Auth0.'),
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
