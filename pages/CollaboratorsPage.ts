import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object de la liste des collaborateurs `/collaborators`.
 *
 * Écran de liste en LECTURE pour l'instant (le flux d'invitation viendra plus tard).
 * Structure différente des listes CRUD admin (pas de menu « … » par ligne mais des
 * crayons d'édition inline), donc on n'hérite pas d'`AdminListPage`.
 */
export class CollaboratorsPage extends BasePage {
  static readonly COLUMNS = ['Collaborateur', 'Email', 'Rôle', 'Tribu', 'Squad', 'Statut', 'Créé le'];

  readonly searchInput: Locator;
  readonly inviteButton: Locator;
  readonly table: Locator;
  readonly rows: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.getByPlaceholder('Rechercher par nom ou email...');
    this.inviteButton = page.getByRole('button', { name: 'Inviter' });
    this.table = page.getByRole('table');
    this.rows = this.table.locator('tbody tr');
  }

  async goToList(): Promise<void> {
    await this.goto('/collaborators');
  }

  columnHeader(name: string): Locator {
    return this.table.getByRole('columnheader', { name });
  }
}
