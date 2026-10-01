import { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { AppShell } from '../../pages/AppShell';
import { QgApi } from '../../utils/api';
import { roleAvailable } from '../../utils/roles';
import type { PageHealth } from '../../utils/page-health';
import { ADMIN_PAGES, BPO_PAGES, ADMIN_RAIL_TARGETS, ADMIN_SUBMENU, PageRoute } from '../data/routes';
import { meta } from '../meta';

/**
 * Affichage sans erreur des pages de tous les menus (Lot 2).
 * Pour chaque page : repère visible, ni écran d'erreur ni « Accès refusé », et ni
 * erreur JS, ni erreur console, ni réponse 5xx de l'API (fixture `health`).
 *
 * Répartition des rôles : l'ADMIN couvre tout sauf `/tickets` ; le BPO couvre
 * Contrôles et Kiosk (son détail de ticket est dans le Lot 3, car l'ouvrir le réserve).
 */

/** Description lisible (rapport) d'un test de page généré depuis la table des routes. */
function describeRoute(route: PageRoute): string {
  const base =
    `Ouvre ${route.path} (menu ${route.menu}) et vérifie que la page s’affiche : repère attendu visible, ` +
    `ni écran d’erreur ni « Accès refusé », ni erreur JavaScript, ni réponse 5xx de l’API.`;
  return route.knownIssue ? `${base} Échec attendu tant que l’anomalie est présente (${route.knownIssue}).` : base;
}

/** Le compte connecté est-il SUPER_ADMIN ? (le compte « admin » l'est aujourd'hui). */
async function isSuperAdmin(page: Page): Promise<boolean> {
  const api = await QgApi.fromPage(page);
  try {
    return (await api.me()).role === 'SUPER_ADMIN';
  } finally {
    await api.dispose();
  }
}

/** Corps commun : navigue, vérifie le repère, l'absence d'écran d'erreur et la santé. */
async function expectPageDisplays(
  page: Page,
  health: PageHealth,
  route: PageRoute,
): Promise<void> {
  const shell = new AppShell(page);
  await shell.goto(route.path);
  if (route.superAdminOnly) {
    test.skip(!(await isSuperAdmin(page)), 'Route réservée au SUPER_ADMIN (refus couvert par TC-AUTH-16)');
  }
  await expect(route.landmark(page)).toBeVisible({ timeout: 20_000 });
  await shell.expectNoErrorScreen();
  await health.settle();
  health.expectClean();
}

test.describe('Pages des menus — ADMIN', { tag: ['@role-admin', '@navigation'] }, () => {
  for (const route of ADMIN_PAGES) {
    test(
      `${route.menu} — ${route.path} s’affiche sans erreur`,
      meta(`TC-NAV-${route.id}`, describeRoute(route)),
      async ({ page, health }) => {
        test.fail(!!route.knownIssue, route.knownIssue);
        await expectPageDisplays(page, health, route);
      },
    );
  }

  test(
    'Annuaire — fiche société et ses 3 onglets s’affichent sans erreur',
    meta('TC-NAV-ANN-02', 'Ouvre une fiche société depuis l’Annuaire et parcourt ses onglets Identité, Threads et Tickets sans erreur.'),
    async ({ page, health }) => {
      const shell = new AppShell(page);
      await shell.goto('/annuaire');
      await page.getByRole('button', { name: 'Actions' }).first().click();
      await page.getByRole('menuitem', { name: 'Voir fiche' }).click();

      await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
      // h1 « <Nom> · <Forme> » (NAV-07)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('·');

      for (const [tab, query] of [['Threads', 'threads'], ['Tickets', 'tickets'], ['Identité', null]] as const) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
        if (query) await expect(page).toHaveURL(new RegExp(`[?&]tab=${query}`));
      }
      await shell.expectNoErrorScreen();
      await health.settle();
      health.expectClean();
    },
  );

  test(
    'Annuaire — fiche contact et ses 2 onglets s’affichent sans erreur',
    meta('TC-NAV-ANN-03', 'Ouvre une fiche contact depuis l’onglet Contacts de l’Annuaire et parcourt ses deux onglets sans erreur.'),
    async ({ page, health }) => {
      const shell = new AppShell(page);
      await shell.goto('/annuaire');
      await page.getByRole('tab', { name: 'Contacts', exact: true }).click();
      await expect(page.getByRole('columnheader', { name: 'Nom Prénom' })).toBeVisible();
      // 1re ligne de DONNÉES (avec une adresse e-mail) : attendre le chargement, les
      // lignes affichées avant sont des squelettes non cliquables.
      await page.getByRole('row').filter({ hasText: '@' }).first().click();

      await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { level: 1 })).not.toBeEmpty();
      for (const tab of ['Threads & Sentiments', 'Infos générales']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
      }
      await shell.expectNoErrorScreen();
      await health.settle();
      health.expectClean();
    },
  );

  test(
    'Kiosk — une page de documentation s’ouvre par la recherche ⌘K',
    meta('TC-NAV-KIO-03', 'Recherche « FDE-034 » avec ⌘K dans le Kiosk et vérifie l’ouverture de la page de documentation.'),
    async ({ page, health }) => {
      const shell = new AppShell(page);
      await shell.goto('/knowledge-bases');
      await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible({ timeout: 20_000 });

      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.type('FDE-034');
      await page.getByRole('option', { name: /FDE-034/ }).first().click();

      await expect(page).toHaveURL(/\/knowledge-bases\/[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'FDE-034 — Incohérence solde 1013 vs fiche juridique',
      );
      await shell.expectNoErrorScreen();
      await health.settle();
      health.expectClean();
    },
  );

  test(
    'Rail — chaque entrée mène à sa page (1re sous-entrée autorisée)',
    meta('TC-NAV-MENU-01', 'Clique chaque entrée du rail et vérifie la page ouverte (1re sous-entrée autorisée pour Administration et Paramètres).'),
    async ({ page }) => {
      const shell = new AppShell(page);
      await shell.goto('/annuaire');
      for (const { entry, path } of ADMIN_RAIL_TARGETS) {
        await shell.railButton(entry).click();
        await expect.poll(() => new URL(page.url()).pathname, { message: `rail « ${entry} »` }).toMatch(path);
      }
    },
  );

  test(
    'Administration — chaque entrée du sous-menu mène à sa page et devient active',
    meta('TC-NAV-MENU-02', 'Clique chaque entrée du sous-menu Administration et vérifie la page ouverte et l’entrée active.'),
    async ({ page }) => {
      const shell = new AppShell(page);
      await shell.goto('/administration/templates');
      const superAdmin = await isSuperAdmin(page);
      for (const { label, path, superAdminOnly } of ADMIN_SUBMENU) {
        const item = shell.submenuButton(label);
        if (superAdminOnly && !superAdmin) {
          await expect(item, `« ${label} » masqué pour un ADMIN`).toHaveCount(0);
          continue;
        }
        await item.click();
        await expect.poll(() => new URL(page.url()).pathname, { message: `sous-menu « ${label} »` }).toMatch(path);
        await expect(shell.submenuButton(label)).toHaveAttribute('aria-current', 'page');
      }
    },
  );

  test(
    'Paramètres — chaque entrée du sous-menu mène à sa page',
    meta('TC-NAV-MENU-03', 'Clique « Signatures » puis « Intégration » dans le sous-menu Paramètres et vérifie les pages ouvertes.'),
    async ({ page }) => {
      const shell = new AppShell(page);
      await shell.goto('/administration/integrations');
      await shell.submenuButton('Signatures').click();
      await expect(page).toHaveURL(/\/administration\/mes-signatures/);
      await shell.submenuButton('Intégration').click();
      await expect(page).toHaveURL(/\/administration\/integrations$/);
    },
  );
});

test.describe('Pages des menus — BPO', { tag: ['@role-bpo', '@navigation'] }, () => {
  test.skip(!roleAvailable('bpo'), 'Compte BPO non renseigné (AUTH_EMAIL_BPO / AUTH_PASSWORD_BPO)');
  test.use({ role: 'bpo' });

  for (const route of BPO_PAGES) {
    test(
      `${route.menu} — ${route.path} s’affiche sans erreur`,
      meta(`TC-NAV-${route.id}`, describeRoute(route)),
      async ({ page, health }) => {
        await expectPageDisplays(page, health, route);
      },
    );
  }

  test(
    'Rail — seules les entrées « Contrôles » et « Kiosk » sont visibles',
    meta('TC-NAV-MENU-B1', 'Avec la session BPO, vérifie que le rail ne propose que « Contrôles » et « Kiosk ».'),
    async ({ page }) => {
      const shell = new AppShell(page);
      await shell.goto('/tickets');
      await expect(shell.railButton('Kiosk')).toBeVisible({ timeout: 20_000 });
      expect(await shell.visibleRailEntries()).toEqual(['Contrôles', 'Kiosk']);
    },
  );
});
