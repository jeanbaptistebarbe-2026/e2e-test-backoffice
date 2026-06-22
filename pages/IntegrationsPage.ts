import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object des intégrations `/administration/integrations`.
 *
 * Mise en page en cartes (`[data-slot="card"]`), une par intégration. Aujourd'hui
 * une seule : « Google » (SSO). Quand le compte est connecté, la carte affiche
 * l'email, des badges de scope (Calendar, Gmail) et un bouton « Déconnecter » ;
 * sinon un bouton de connexion. La présence de « Déconnecter » sert de signal
 * « intégration active », réutilisé pour conditionner le test du calendrier.
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

  /**
   * Indique si le SSO Google est actif (compte connecté). Navigue sur la page
   * intégrations et se base sur la présence du bouton « Déconnecter » de la carte
   * Google (présent uniquement quand le compte est connecté).
   */
  async isGoogleSsoActive(): Promise<boolean> {
    await this.goTo();
    // La carte se rend après un fetch async → attendre son rendu avant de lire
    // l'état, sinon on lit « inactif » par erreur (race).
    await this.googleCard.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    return this.googleCard
      .getByRole('button', { name: 'Déconnecter' })
      .isVisible()
      .catch(() => false);
  }
}
