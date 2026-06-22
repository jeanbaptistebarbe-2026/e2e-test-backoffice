import { Page, Locator } from '@playwright/test';
import { AdminListPage } from './AdminListPage';

/**
 * Page Object de la feature Signatures (e-mail) du backoffice Neo.
 * Couvre la liste `/administration/signatures`, la page `/administration/mes-signatures`
 * et le formulaire de création/édition. Réutilise le pattern « liste admin »
 * (recherche, menu de ligne, suppression confirmée, redirection au submit) via
 * [AdminListPage].
 */
export class SignaturesPage extends AdminListPage {
  protected readonly listPath = '/administration/signatures';
  protected readonly searchPlaceholder = 'Rechercher une signature';

  readonly newSignatureButton: Locator;
  readonly nameInput: Locator;
  readonly tribuButton: Locator;
  readonly contentEditor: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.newSignatureButton = page.getByRole('button', { name: 'Nouvelle signature' });
    this.nameInput = page.locator('#signature-name');
    this.tribuButton = page.getByRole('button', {
      name: /sélectionner une ou plusieurs tribus/i,
    });
    this.contentEditor = page.locator('[contenteditable="true"]');
    this.submitButton = page.getByRole('button', { name: 'Valider la signature' });
  }

  async goToMesSignatures(): Promise<void> {
    await this.goto('/administration/mes-signatures');
  }

  /** Depuis la liste, ouvre le formulaire de création et attend son affichage. */
  async startNewSignature(): Promise<void> {
    await this.newSignatureButton.click();
    await this.page.waitForURL('**/administration/signatures/new', { timeout: 15_000 });
    await this.nameInput.waitFor({ state: 'visible', timeout: 10_000 });
  }

  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  /**
   * Ouvre le sélecteur de tribus (popover Radix), coche la première option et
   * referme le popover. Renvoie le libellé de la tribu sélectionnée.
   */
  async selectFirstTribu(): Promise<string> {
    await this.tribuButton.click();
    // Scope au popover pour ne pas capter les <option> du <select> de police.
    const popover = this.page.locator('[data-radix-popper-content-wrapper]');
    const firstOption = popover.getByRole('option').first();
    await firstOption.waitFor({ state: 'visible', timeout: 10_000 });
    const label = (await firstOption.innerText()).trim();
    await firstOption.click();
    await this.page.keyboard.press('Escape'); // referme le popover multi-sélection
    return label;
  }

  /** Saisit le contenu dans l'éditeur WYSIWYG (contenteditable). */
  async fillContent(text: string): Promise<void> {
    await this.contentEditor.click();
    await this.contentEditor.pressSequentially(text, { delay: 10 });
  }

  /** Soumet le formulaire et attend la redirection vers la liste. */
  async submit(): Promise<void> {
    await this.submitAndWaitList(this.submitButton);
  }

  /** Alias rétro-compatible de `row()` pour ce Page Object. */
  signatureRow(name: string): Locator {
    return this.row(name);
  }

  /** Ajoute un suffixe à la fin du nom (champ prérempli en édition). */
  async appendToName(suffix: string): Promise<void> {
    const current = await this.nameInput.inputValue();
    await this.nameInput.fill(current + suffix);
  }

  /** Ajoute un suffixe à la fin du contenu de l'éditeur (prérempli en édition). */
  async appendToContent(suffix: string): Promise<void> {
    await this.contentEditor.click();
    await this.page.keyboard.press('Control+End');
    await this.contentEditor.pressSequentially(suffix, { delay: 10 });
  }
}
