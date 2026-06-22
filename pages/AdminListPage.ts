import { Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Base réutilisable pour les écrans « liste d'administration » du backoffice Neo
 * (Signatures, Templates, …) : une liste paginée avec recherche, un tableau dont
 * chaque ligne a un menu « … » (Éditer / Dupliquer / Supprimer), et une suppression
 * confirmée par un dialog.
 *
 * Les sous-classes fournissent `listPath` (chemin de la liste) et `searchPlaceholder`
 * (placeholder de l'input de recherche), ainsi que les champs/labels propres à leur
 * formulaire. Les libellés communs (menu, items, dialog) sont issus de la même lib
 * de composants et donc partagés.
 */
export abstract class AdminListPage extends BasePage {
  /** Chemin de la liste, ex. `/administration/signatures`. */
  protected abstract readonly listPath: string;
  /** Placeholder de l'input de recherche, ex. `Rechercher une signature`. */
  protected abstract readonly searchPlaceholder: string;

  get searchInput(): Locator {
    return this.page.getByPlaceholder(this.searchPlaceholder);
  }

  /** Navigue vers la liste et attend la fin du chargement réseau. */
  async goToList(): Promise<void> {
    await this.goto(this.listPath);
  }

  /** Recherche par nom (filtre serveur via param `q`). */
  async search(name: string): Promise<void> {
    await this.searchInput.fill(name);
  }

  /** Ligne du tableau contenant le texte donné. */
  row(name: string): Locator {
    return this.page.getByRole('row').filter({ hasText: name });
  }

  /** Ouvre le menu « … » de la ligne. */
  async openRowMenu(name: string): Promise<void> {
    await this.row(name).getByRole('button', { name: 'Ouvrir le menu' }).click();
  }

  /** Menu de la ligne → « Éditer », puis attend l'URL de détail `{listPath}/{uuid}`. */
  async editFromRow(name: string): Promise<void> {
    await this.openRowMenu(name);
    await this.page.getByRole('menuitem', { name: 'Éditer' }).click();
    const detail = new RegExp(`^${this.listPath}/[0-9a-f-]{36}`);
    await this.page.waitForURL((url) => detail.test(url.pathname), { timeout: 15_000 });
  }

  /** Menu de la ligne → « Dupliquer ». */
  async duplicateFromRow(name: string): Promise<void> {
    await this.openRowMenu(name);
    await this.page.getByRole('menuitem', { name: 'Dupliquer' }).click();
  }

  /**
   * Menu de la ligne → « Supprimer », puis confirmation dans le dialog
   * (« Cette action est irréversible »). Distingue le bouton du dialog du menuitem.
   */
  async deleteFromRow(name: string): Promise<void> {
    await this.openRowMenu(name);
    await this.page.getByRole('menuitem', { name: 'Supprimer' }).click();
    const dialog = this.page
      .locator('[role="alertdialog"], [role="dialog"]')
      .filter({ hasText: /irréversible/i });
    await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  }

  /**
   * Soumet un formulaire (création ou édition) et attend la redirection vers la
   * liste. L'attente de redirection évite la race où un `goto` immédiat
   * interromprait la requête POST/PATCH en vol.
   */
  protected async submitAndWaitList(submitButton: Locator): Promise<void> {
    await expect(submitButton).toBeEnabled({ timeout: 10_000 });
    await Promise.all([
      this.page.waitForURL((url) => url.pathname === this.listPath, { timeout: 20_000 }),
      submitButton.click(),
    ]);
  }
}
