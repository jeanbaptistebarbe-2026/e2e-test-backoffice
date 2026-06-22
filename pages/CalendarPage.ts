import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object du calendrier `/calendar`.
 *
 * Le calendrier affiche les événements (synchronisés depuis Google Agenda) groupés
 * par jour dans des `<section>` (titre `<h2>` + cartes d'événement). En tête : des
 * onglets de vue (7 / 30 / 90 jours) et un bouton « Nouvel événement ».
 *
 * Le calendrier n'est alimenté que si le SSO Google est actif → les tests qui
 * l'utilisent doivent se gater via `IntegrationsPage.isGoogleSsoActive()`.
 */
export class CalendarPage extends BasePage {
  readonly newEventButton: Locator;
  readonly viewTablist: Locator;
  readonly daySections: Locator;
  readonly eventCards: Locator;
  readonly eventTimes: Locator;

  constructor(page: Page) {
    super(page);
    this.newEventButton = page.getByRole('button', { name: 'Nouvel événement' });
    this.viewTablist = page.getByRole('tablist');
    this.daySections = page.locator('section');
    this.eventCards = page.locator('section div.rounded-lg.border.bg-card');
    // Chaque événement porte une plage horaire en chiffres tabulaires.
    this.eventTimes = page.locator('span.tabular-nums');
  }

  async goTo(): Promise<void> {
    await this.goto('/calendar');
  }

  viewTab(name: string): Locator {
    return this.page.getByRole('tab', { name });
  }
}
