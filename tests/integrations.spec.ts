import { test, expect } from './fixtures';
import { IntegrationsPage } from '../pages/IntegrationsPage';

test.describe('Integrations — administration (authentifié)', { tag: ['@settings', '@readonly'] }, () => {
  test('la page intégrations charge ses items (carte SSO Google)', { tag: ['@TC-SET-01', '@p0', '@smoke'] }, async ({ page }) => {
    const integrations = new IntegrationsPage(page);
    await integrations.goTo();

    await expect(page).toHaveURL(/\/administration\/integrations/);

    // Au moins un item (carte) chargé — assertion web-first (auto-retry, le rendu
    // des cartes survient après un fetch async).
    await expect(integrations.cards.first()).toBeVisible();

    // L'item Google est présent (titre) — test de chargement, sans supposer l'état
    // de connexion (les badges de scope Calendar/Gmail n'existent que si connecté).
    await expect(integrations.googleCard).toBeVisible();
    await expect(integrations.googleCard.locator('[data-slot="card-title"]')).toContainText('Google');
  });
});
