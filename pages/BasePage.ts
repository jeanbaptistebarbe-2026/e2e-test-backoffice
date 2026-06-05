import { Page } from '@playwright/test';

/**
 * URL de base, résolue ICI (et non via `use.baseURL` de playwright.config.ts).
 *
 * Raison : l'orchestrateur SquashTM exécute Playwright avec sa propre config
 * générée et NE charge PAS notre `playwright.config.ts` — donc `use.baseURL`
 * n'est jamais appliqué sur le runner. On reconstruit donc une URL absolue
 * dans le code, à partir de l'env (avec défaut public, BASE_URL n'étant pas
 * un secret). Voir aussi le défaut dans playwright.config.ts pour les runs locaux.
 */
const BASE_URL = (process.env.BASE_URL?.trim() || 'https://qg.swapn.tech/').replace(/\/+$/, '');

/**
 * Classe de base pour tous les Page Objects.
 * Expose la page Playwright et un helper de navigation.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /**
   * Navigue vers un chemin relatif à BASE_URL, ou vers une URL absolue telle quelle.
   * Construit une URL absolue pour ne dépendre d'aucun `baseURL` de config.
   */
  async goto(path = '/'): Promise<void> {
    const url = /^https?:\/\//i.test(path)
      ? path
      : `${BASE_URL}/${path.replace(/^\/+/, '')}`;
    await this.page.goto(url);
  }
}
