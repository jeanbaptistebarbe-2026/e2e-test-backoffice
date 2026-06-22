import { test, expect } from './fixtures';
import { IntegrationsPage } from '../pages/IntegrationsPage';

test.describe('Integrations — administration (authentifié)', () => {
  test('la page intégrations charge ses items (carte SSO Google)', async ({ page }) => {
    const integrations = new IntegrationsPage(page);
    await integrations.goTo();

    await expect(page).toHaveURL(/\/administration\/integrations/);

    // Au moins un item (carte) chargé — assertion web-first (auto-retry, le rendu
    // des cartes survient après un fetch async).
    await expect(integrations.cards.first()).toBeVisible();

    // L'item Google est présent avec ses badges de scope.
    await expect(integrations.googleCard).toBeVisible();
    await expect(integrations.googleCard.locator('[data-slot="card-title"]')).toContainText('Google');
    await expect(integrations.googleCard.getByText('Calendar')).toBeVisible();
    await expect(integrations.googleCard.getByText('Gmail')).toBeVisible();
  });
});
