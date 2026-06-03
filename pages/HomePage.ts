import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object de la landing du backoffice (qg.swapn.tech) après authentification.
 * Volontairement minimal pour l'instant — à enrichir quand les écrans existeront.
 */
export class HomePage extends BasePage {
  readonly root: Locator;

  constructor(page: Page) {
    super(page);
    // Racine de l'app React (Vite + React + TS)
    this.root = page.locator('#root');
  }

  /** Vérifie que le backoffice est chargé (hors Auth0, app React montée). */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/qg\.swapn\.tech/, { timeout: 30_000 });
    await expect(this.root).toBeAttached({ timeout: 15_000 });
    await expect(this.page.locator('body')).toBeVisible();
  }
}
