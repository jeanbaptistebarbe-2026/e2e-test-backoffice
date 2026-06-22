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
  readonly refreshButton: Locator;
  readonly table: Locator;
  readonly rows: Locator;

  // Modale d'invitation
  readonly inviteDialog: Locator;
  readonly inviteEmailInput: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.getByPlaceholder('Rechercher par nom ou email...');
    this.inviteButton = page.getByRole('button', { name: 'Inviter' });
    this.refreshButton = page.getByRole('button', { name: 'Rafraîchir' });
    this.table = page.getByRole('table');
    this.rows = this.table.locator('tbody tr');

    this.inviteDialog = page.getByRole('dialog');
    this.inviteEmailInput = page.locator('#invite-email');
  }

  async goToList(): Promise<void> {
    await this.goto('/collaborators');
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
  }

  columnHeader(name: string): Locator {
    return this.table.getByRole('columnheader', { name });
  }

  /** Ligne du tableau contenant le texte donné (nom ou email). */
  rowByText(text: string): Locator {
    return this.page.getByRole('row').filter({ hasText: text });
  }

  /** Ouvre la modale « Inviter un collaborateur ». */
  async openInvite(): Promise<void> {
    await this.inviteButton.click();
    await this.inviteDialog.waitFor({ state: 'visible', timeout: 10_000 });
  }

  /**
   * Renseigne email + rôle dans la modale et valide. Attend la fermeture de la
   * modale (signal de succès) — évite une race où la recherche suivante
   * interviendrait avant la fin de la requête d'invitation.
   */
  async invite(email: string, role = 'Collaborateur'): Promise<void> {
    await this.inviteEmailInput.fill(email);
    await this.inviteDialog.getByRole('button', { name: role, exact: true }).click();
    await this.inviteDialog.getByRole('button', { name: 'Inviter' }).click();
    await this.inviteDialog.waitFor({ state: 'hidden', timeout: 15_000 });
  }
}
