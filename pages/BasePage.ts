import { Page } from '@playwright/test';

/**
 * Classe de base pour tous les Page Objects.
 * Expose la page Playwright et un helper de navigation.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Navigue vers un chemin relatif au baseURL (par défaut la racine). */
  async goto(path = '/'): Promise<void> {
    await this.page.goto(path);
  }
}
