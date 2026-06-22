import { Page, Locator } from '@playwright/test';
import { AdminListPage } from './AdminListPage';

/**
 * Page Object de la feature Templates `/administration/templates`.
 * Réutilise le pattern « liste admin » (recherche, menu de ligne Éditer/Dupliquer/
 * Supprimer, suppression confirmée, redirection au submit) via [AdminListPage].
 *
 * Le formulaire de création/édition (`/administration/templates/new` puis `/{uuid}`)
 * a un champ nom (`#template-name`), un sélecteur de tribus, et un contenu en
 * textareas (onglets « Version mail » / « Version chat »). Bouton de validation :
 * « Valider template ».
 */
export class TemplatesPage extends AdminListPage {
  protected readonly listPath = '/administration/templates';
  protected readonly searchPlaceholder = 'Rechercher un template';

  readonly newTemplateButton: Locator;
  readonly nameInput: Locator;
  readonly tribuButton: Locator;
  readonly contentAreas: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.newTemplateButton = page.getByRole('button', { name: 'Nouveau template' });
    this.nameInput = page.locator('#template-name');
    this.tribuButton = page.getByRole('button', {
      name: /sélectionner une ou plusieurs tribus/i,
    });
    this.contentAreas = page.locator('textarea');
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

  /** Remplit toutes les zones de contenu visibles (onglet « Version mail »). */
  async fillContent(text: string): Promise<void> {
    const count = await this.contentAreas.count();
    for (let i = 0; i < count; i++) {
      const area = this.contentAreas.nth(i);
      if (await area.isVisible().catch(() => false)) await area.fill(text);
    }
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

  /** Ajoute un suffixe à la fin de chaque zone de contenu visible (préremplie). */
  async appendToContent(suffix: string): Promise<void> {
    const count = await this.contentAreas.count();
    for (let i = 0; i < count; i++) {
      const area = this.contentAreas.nth(i);
      if (await area.isVisible().catch(() => false)) {
        const current = await area.inputValue();
        await area.fill(current + suffix);
      }
    }
  }
}
