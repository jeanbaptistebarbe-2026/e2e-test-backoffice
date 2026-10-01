import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object des intégrations `/administration/integrations`.
 *
 * Mise en page en cartes (`[data-slot="card"]`), une par intégration. Aujourd'hui
 * une seule : « Google » (SSO). Quand le compte est connecté, la carte affiche
 * l'email, des badges de scope (Calendar, Gmail) et un bouton « Déconnecter » ;
 * sinon un bouton de connexion.
 */
export class IntegrationsPage extends BasePage {
  readonly cards: Locator;
  readonly googleCard: Locator;

  constructor(page: Page) {
    super(page);
    this.cards = page.locator('[data-slot="card"]');
    this.googleCard = this.cardByTitle('Google');
  }

  async goTo(): Promise<void> {
    await this.goto('/administration/integrations');
  }

  /** Carte d'intégration dont le titre contient le texte donné. */
  cardByTitle(title: string): Locator {
    return this.page
      .locator('[data-slot="card"]')
      .filter({ has: this.page.locator('[data-slot="card-title"]', { hasText: title }) });
  }
}
