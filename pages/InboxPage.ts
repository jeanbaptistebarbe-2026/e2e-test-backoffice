import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/** Vues de la barre latérale de l'Inbox (libellé → valeur du paramètre `?view=`). */
export const INBOX_VIEWS = {
  'Boîte de réception': null,
  Assigné: 'assigned',
  Suivi: 'followed',
  Brouillons: 'drafts',
  Envoyés: 'sent',
  Spam: 'spam',
} as const;
export type InboxView = keyof typeof INBOX_VIEWS;

/**
 * Page Object de l'Inbox (`/`, NAV-01) : barre latérale des vues, recherche,
 * filtres et liste des conversations.
 * Réf. : swapn-qg-source-de-verite.md §6.3 (F-INB-001 à F-INB-004).
 */
export class InboxPage extends BasePage {
  /** h1 « Ouvert (N) » / « Archivé (N) » / « Snoozé (N) ». */
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly newMailButton: Locator;
  readonly filterButton: Locator;
  /** Éléments de la liste : boutons portant une date `dd/MM - HHhmm`. */
  readonly threadItems: Locator;
  readonly noResultMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1 });
    // Champ sans label : le placeholder est le seul repère (ANO-16).
    this.searchInput = page.getByPlaceholder('Rechercher', { exact: true });
    this.newMailButton = page.getByRole('button', { name: 'Nouveau mail', exact: true });
    this.filterButton = page.getByRole('button', { name: 'Filtrer par', exact: true });
    this.threadItems = page.getByRole('button').filter({ hasText: /\d{2}\/\d{2} - \d{2}h\d{2}/ });
    this.noResultMessage = page.getByText('Aucune conversation ne correspond à votre recherche.');
  }

  async goTo(view?: InboxView): Promise<void> {
    const key = view ? INBOX_VIEWS[view] : null;
    await this.goto(key ? `/?view=${key}` : '/');
  }

  /** Entrée de la barre latérale (nom accessible « <libellé> <compteur> »). */
  viewButton(view: InboxView): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${view}( \\d+)?$`) });
  }

  /** Compteur affiché à côté d'une vue (0 si absent). */
  async viewCount(view: InboxView): Promise<number> {
    const name = (await this.viewButton(view).getAttribute('aria-label')) ?? (await this.viewButton(view).innerText());
    const m = name.match(/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
  }

  /** Nombre N du h1 « <statut> (N) ». */
  async headingCount(): Promise<number> {
    const m = (await this.heading.innerText()).match(/\((\d+)\)/);
    return m ? Number(m[1]) : NaN;
  }

  /** Conversation de la liste contenant le texte (l'aperçu montre le CORPS, pas l'objet). */
  threadItem(text: string | RegExp): Locator {
    return this.threadItems.filter({ hasText: text });
  }

  async search(text: string): Promise<void> {
    await this.searchInput.fill(text);
  }
}
