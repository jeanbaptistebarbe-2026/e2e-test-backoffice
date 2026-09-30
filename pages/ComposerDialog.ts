import { Page, Locator, expect } from '@playwright/test';

/**
 * Boîte de rédaction « Envoyer un mail » (F-INB-009), ouverte par « Nouveau mail »
 * ou par « Répondre » (alors pré-remplie : destinataire + « Re: <objet> »).
 */
export class ComposerDialog {
  readonly dialog: Locator;
  readonly to: Locator;
  readonly subject: Locator;
  /** Corps : éditeur riche (contenteditable, placeholder « Écrivez votre message... »). */
  readonly body: Locator;
  readonly sendButton: Locator;
  readonly cancelButton: Locator;
  /** Invite affichée quand on ferme un mail modifié (RG-INB-013). */
  readonly draftPrompt: Locator;

  constructor(private readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Envoyer un mail' });
    this.to = this.dialog.getByLabel('Destinataires');
    this.subject = this.dialog.getByPlaceholder('Objet du message');
    this.body = this.dialog.locator('[contenteditable="true"]');
    this.sendButton = this.dialog.getByRole('button', { name: 'Envoyer', exact: true });
    this.cancelButton = this.dialog.getByRole('button', { name: 'Annuler', exact: true });
    this.draftPrompt = page.getByText('Enregistrer ce mail comme brouillon ?');
  }

  /** Puce d'un destinataire (bouton « Retirer <email> »). */
  chip(email: string): Locator {
    return this.dialog.getByRole('button', { name: `Retirer ${email}`, exact: true });
  }

  /** Saisit une adresse dans « À : » et valide par Entrée (crée une puce si valide). */
  async addRecipient(email: string): Promise<void> {
    await this.to.fill(email);
    await this.to.press('Enter');
  }

  async fillSubject(subject: string): Promise<void> {
    await this.subject.fill(subject);
  }

  async typeBody(text: string): Promise<void> {
    await this.body.click();
    await this.page.keyboard.type(text);
  }

  /**
   * Envoie et attend la confirmation serveur. Un NOUVEAU mail enchaîne
   * `POST /threads` (création de la conversation) puis `POST /messages/email/send`.
   */
  async send(): Promise<void> {
    const sent = this.page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/messages/email/send' && r.request().method() === 'POST',
    );
    await expect(this.sendButton).toBeEnabled();
    await this.sendButton.click();
    expect((await sent).ok(), 'POST /messages/email/send').toBe(true);
  }
}
