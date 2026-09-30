import { Page, Locator, expect } from '@playwright/test';

/**
 * Volet d'une conversation ouverte (`?threadId=<uuid>`) : en-tête d'actions,
 * messages, zone de réponse (onglets « Commentaire interne » / « Mail pour … »).
 * Réf. : swapn-qg-source-de-verite.md §6.3 (F-INB-005, F-INB-006, F-INB-008).
 */
export class ConversationPanel {
  readonly archiveButton: Locator;
  readonly unarchiveButton: Locator;
  readonly moreActionsButton: Locator;
  readonly replyButton: Locator;
  /** Onglet de la zone de réponse (bouton, pas un `tab`). */
  readonly commentTab: Locator;
  readonly commentEditor: Locator;

  constructor(private readonly page: Page) {
    this.archiveButton = page.getByRole('button', { name: 'Archiver', exact: true });
    this.unarchiveButton = page.getByRole('button', { name: 'Désarchiver', exact: true });
    // `.` sur l'apostrophe : droite ou typographique selon la source.
    this.moreActionsButton = page.getByRole('button', { name: /^Plus d.actions$/ });
    this.replyButton = page.getByRole('button', { name: 'Répondre', exact: true }).first();
    this.commentTab = page.getByRole('button', { name: 'Commentaire interne', exact: true });
    this.commentEditor = page.locator(
      '[contenteditable="true"][data-placeholder="Ajouter un commentaire interne..."]',
    );
  }

  /** Boutons d'action de l'en-tête (F-INB-005). « Assigner » est remplacé par
   *  l'assigné quand la conversation est déjà assignée, d'où son absence ici. */
  headerActions(): Locator[] {
    return [
      this.page.getByRole('button', { name: 'Catégorie et tags', exact: true }),
      this.page.getByRole('button', { name: 'Snoozer', exact: true }),
      this.archiveButton.or(this.unarchiveButton),
      this.moreActionsButton,
    ];
  }

  /** Objet de la conversation (bouton éditable « Cliquer pour renommer l'objet »). */
  subject(text: string): Locator {
    return this.page.getByRole('button', { name: text, exact: true });
  }

  /** Suggestion de mention (liste de boutons ouverte en tapant « @ »). */
  mentionSuggestion(name: string): Locator {
    return this.page.getByRole('listitem').getByRole('button', { name, exact: true });
  }

  comment(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  /** Publie un commentaire interne (validation par Entrée) et attend le 201. */
  async postComment(text: string): Promise<void> {
    await this.commentTab.click();
    await this.commentEditor.click();
    await this.page.keyboard.type(text);
    const posted = this.page.waitForResponse(
      (r) => /\/threads\/[0-9a-f-]{36}\/comments$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    );
    await this.page.keyboard.press('Enter');
    expect((await posted).status(), 'POST /threads/{id}/comments').toBe(201);
  }

  /** Supprime un commentaire : survol → « Supprimer » → confirmation. */
  async deleteComment(text: string): Promise<void> {
    await this.comment(text).hover();
    await this.page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    const confirm = this.page.getByRole('dialog').filter({ hasText: 'Supprimer ce message ?' });
    await confirm.getByRole('button', { name: 'Supprimer', exact: true }).click();
  }
}
