import { Page, Locator } from '@playwright/test';
import { AdminListPage } from './AdminListPage';

/**
 * Page Object de la feature Templates `/administration/templates`.
 * Réutilise le pattern « liste admin » (recherche, menu de ligne Éditer/Dupliquer/
 * Supprimer, suppression confirmée, redirection au submit) via [AdminListPage].
 *
 * Le formulaire de création/édition (`/administration/templates/new` puis `/{uuid}`)
 * a un champ nom (`#template-name`), un sélecteur de tribus, et deux champs de contenu
 * REQUIS pour activer « Valider template » : l'objet `Objet du mail` (textarea) ET le
 * corps `Template de mail` (éditeur riche `contenteditable`).
 */
export class TemplatesPage extends AdminListPage {
  protected readonly listPath = '/administration/templates';
  protected readonly searchPlaceholder = 'Rechercher un template';

  readonly newTemplateButton: Locator;
  readonly nameInput: Locator;
  readonly tribuButton: Locator;
  readonly subjectInput: Locator;
  readonly contentEditor: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.newTemplateButton = page.getByRole('button', { name: 'Nouveau template' });
    this.nameInput = page.locator('#template-name');
    this.tribuButton = page.getByRole('button', {
      name: /sélectionner une ou plusieurs tribus/i,
    });
    // Onglet « Version mail » (affiché par défaut). Deux champs de contenu sont requis
    // pour activer « Valider template » : l'objet (textarea) ET le corps (contenteditable).
    this.subjectInput = page.locator('textarea').first(); // Objet du mail
    this.contentEditor = page.locator('[contenteditable="true"]').first(); // Template de mail
    this.submitButton = page.getByRole('button', { name: 'Valider template' });
  }

  /** Depuis la liste, ouvre le formulaire de création et attend son affichage. */
  async startNewTemplate(): Promise<void> {
    await this.newTemplateButton.click();
    await this.page.waitForURL('**/administration/templates/new', { timeout: 15_000 });
    await this.nameInput.waitFor({ state: 'visible', timeout: 10_000 });
  }

  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  /** Sélectionne la première tribu (popover Radix), puis referme le popover. */
  async selectFirstTribu(): Promise<string> {
    await this.tribuButton.first().click();
    const popover = this.page.locator('[data-radix-popper-content-wrapper]');
    const firstOption = popover.getByRole('option').first();
    await firstOption.waitFor({ state: 'visible', timeout: 10_000 });
    const label = (await firstOption.innerText()).trim();
    await firstOption.click();
    await this.page.keyboard.press('Escape');
    return label;
  }

  /** Remplit l'objet (textarea) ET le corps « Template de mail » (contenteditable) —
   *  les deux sont requis pour activer « Valider template ». */
  async fillContent(text: string): Promise<void> {
    await this.subjectInput.fill(text);
    await this.contentEditor.click();
    await this.contentEditor.pressSequentially(text, { delay: 10 });
  }

  /** Soumet le formulaire et attend la redirection vers la liste. */
  async submit(): Promise<void> {
    await this.submitAndWaitList(this.submitButton);
  }

  /** Alias lisible de `row()` pour ce Page Object. */
  templateRow(name: string): Locator {
    return this.row(name);
  }

  /** Ajoute un suffixe à la fin du nom (champ prérempli en édition). */
  async appendToName(suffix: string): Promise<void> {
    const current = await this.nameInput.inputValue();
    await this.nameInput.fill(current + suffix);
  }

  /** Ajoute un suffixe à la fin du corps (éditeur contenteditable, prérempli en édition). */
  async appendToContent(suffix: string): Promise<void> {
    await this.contentEditor.click();
    await this.page.keyboard.press('Control+End');
    await this.contentEditor.pressSequentially(suffix, { delay: 10 });
  }
}
