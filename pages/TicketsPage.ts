import { Page, Locator, Response, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/** Statuts du panneau « Fil de l'eau », dans l'ordre d'affichage (F-CTL-001). */
export const FIL_DE_L_EAU = [
  'Tous',
  'À traiter',
  'À vérifier',
  'Attente client',
  'Retour client',
  'Reporté',
  'Résolues',
  'Ignoré',
] as const;

/** Ticket renvoyé par `POST /tickets/self-assign-next` (réservation). */
export interface ReservedTicket {
  id: string;
  companyId: string;
  collaboratorId: string | null;
  status: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Page Object du module Contrôles (`/tickets`, NAV-11/12) : panneau « Fil de l'eau »,
 * vues, filtres, liste et détail d'un ticket FDE.
 * Réf. : swapn-qg-source-de-verite.md §6.4.
 *
 * ⚠️ Pour un BPO, SÉLECTIONNER un ticket le réserve (`POST /tickets/self-assign-next`,
 * RG-CTL-013) ; sortir un ticket de « Ma file » (résolu, ignoré, attente client…)
 * réserve automatiquement le SUIVANT de la liste filtrée. D'où :
 *   - toujours partir de la liste filtrée sur la société de test ;
 *   - vérifier un résultat en mode consultation (`?consultation=1`), sans réservation.
 */
export class TicketsPage extends BasePage {
  readonly maFile: Locator;
  readonly filterButton: Locator;
  readonly filterDialog: Locator;
  readonly ticketItems: Locator;
  readonly emptyDetail: Locator;

  // Détail
  readonly assignedTo: Locator;
  readonly resolveButton: Locator;
  readonly tiimeExpertLink: Locator;
  readonly snoozeButton: Locator;
  readonly triggerData: Locator;
  readonly discussionTitle: Locator;
  readonly discussionEditor: Locator;
  readonly discussionSend: Locator;

  // Boîte « Ignorer ce contrôle »
  readonly ignoreDialog: Locator;
  readonly ignoreReason: Locator;
  readonly ignoreConfirm: Locator;
  readonly ignoreCancel: Locator;

  // Vues
  readonly addViewButton: Locator;
  readonly viewDialog: Locator;
  readonly viewNameInput: Locator;
  readonly saveViewButton: Locator;

  constructor(page: Page) {
    super(page);
    this.maFile = page.getByText('Ma file', { exact: true });
    this.filterButton = page.getByRole('button', { name: 'Filtrer par', exact: true });
    this.filterDialog = page.getByRole('dialog').filter({ hasText: 'Filtrer par' });
    this.ticketItems = page.getByRole('button').filter({ hasText: /\d{2}\/\d{2} - \d{2}h\d{2}/ });
    this.emptyDetail = page.getByText('Sélectionnez un ticket pour voir les détails');

    this.assignedTo = page.getByRole('button', { name: /^Assigné à / });
    this.resolveButton = page.getByRole('button', { name: 'Marquer résolu', exact: true });
    this.tiimeExpertLink = page.getByRole('link', { name: 'Tiime expert', exact: true });
    this.snoozeButton = page.getByRole('button', { name: 'Snoozer', exact: true });
    this.triggerData = page.getByText('Données du déclencheur', { exact: true });
    this.discussionTitle = page.getByText('Discussion interne', { exact: true });
    this.discussionEditor = page.locator('[contenteditable="true"][data-placeholder^="Message interne"]');
    this.discussionSend = page.getByRole('button', { name: 'Envoyer', exact: true });

    this.ignoreDialog = page.getByRole('dialog', { name: 'Ignorer ce contrôle' });
    this.ignoreReason = this.ignoreDialog.getByRole('textbox', { name: 'Motif' });
    this.ignoreConfirm = this.ignoreDialog.getByRole('button', { name: 'Confirmer', exact: true });
    this.ignoreCancel = this.ignoreDialog.getByRole('button', { name: 'Annuler', exact: true });

    this.addViewButton = page.getByRole('button', { name: 'Ajouter', exact: true });
    this.viewDialog = page.getByRole('dialog', { name: 'Ajouter une vue' });
    // Champ sans label : son nom accessible est le placeholder.
    this.viewNameInput = this.viewDialog.getByRole('textbox', { name: 'Écrire un nom pour la vue' });
    this.saveViewButton = this.viewDialog.getByRole('button', { name: 'Enregistrer cette vue', exact: true });
  }

  async goTo(): Promise<void> {
    await this.goto('/tickets');
    await expect(this.maFile).toBeVisible({ timeout: 20_000 });
  }

  /** Mode consultation : ouvre un ticket SANS le réserver (F-CTL-008). */
  async goToConsultation(ticketId: string): Promise<void> {
    await this.goto(`/tickets/${ticketId}?consultation=1`);
    await expect(this.triggerData).toBeVisible({ timeout: 20_000 });
  }

  /** Entrée du panneau « Fil de l'eau » (nom accessible « <statut> <compteur> »). */
  statusFilter(label: (typeof FIL_DE_L_EAU)[number]): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${escapeRe(label)} \\d+$`) });
  }

  /**
   * Bouton du statut courant d'un ticket. Le nom rendu est en `capitalize`
   * (« À Traiter ») : on cible sans casse, et on assertera le `textContent`
   * (RG-CTL-009).
   */
  statusButton(label: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${escapeRe(label)}$`, 'i') });
  }

  ticketItem(text: string | RegExp): Locator {
    return this.ticketItems.filter({ hasText: text });
  }

  /** Bouton d'un filtre du panneau « Filtrer par » (ex. « Tous les dossiers »). */
  filterField(name: string | RegExp): Locator {
    return this.filterDialog.getByRole('button', { name }).first();
  }

  /**
   * Filtre la liste sur une société : « Filtrer par » → « Dossier » → recherche →
   * option → Échap (referme le popover sans perdre la sélection) → « Filtrer ».
   */
  async filterByCompany(company: string): Promise<void> {
    await this.filterButton.click();
    await this.filterField('Tous les dossiers').click();
    await this.page.getByRole('textbox', { name: 'Rechercher un dossier' }).fill(company);
    await this.page.getByRole('option', { name: company, exact: true }).click();
    await this.page.keyboard.press('Escape');
    const filtered = this.page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/tickets' && r.url().includes('companyIds='),
    );
    await this.filterDialog.getByRole('button', { name: 'Filtrer', exact: true }).click();
    await filtered;
    await expect(this.filterDialog).toBeHidden();
  }

  /** Attend la prochaine réponse de réservation et renvoie le ticket réservé. */
  waitForReservation(): Promise<Response> {
    return this.page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/tickets/self-assign-next' && r.request().method() === 'POST',
    );
  }

  /**
   * Ouvre un ticket de la liste et renvoie le ticket RÉELLEMENT réservé (le serveur
   * peut en attribuer un autre que celui cliqué).
   */
  async openTicket(item: Locator): Promise<ReservedTicket> {
    const reservation = this.waitForReservation();
    await item.click();
    const res = await reservation;
    expect(res.ok(), 'POST /tickets/self-assign-next').toBe(true);
    const { ticket } = (await res.json()) as { ticket: ReservedTicket };
    await expect(this.page).toHaveURL(new RegExp(`/tickets/${ticket.id}`));
    await expect(this.triggerData).toBeVisible();
    return ticket;
  }

  /** Change le statut par le menu « Changer le statut » et attend le PATCH. */
  async changeStatus(current: string, target: string): Promise<Response> {
    await this.statusButton(current).click();
    const patched = this.page.waitForResponse(
      (r) => /\/tickets\/[0-9a-f-]{36}\/status$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH',
    );
    await this.page.getByRole('menuitem', { name: target, exact: true }).click();
    return patched;
  }

  /** Vue enregistrée dans le panneau (nom accessible « ★ <nom> <compteur> »). */
  viewButton(name: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^★ ${escapeRe(name)}( \\d+)?$`) });
  }

  /**
   * Supprime une vue : ses boutons d'action n'apparaissent qu'au SURVOL ; la
   * suppression est immédiate (pas de confirmation).
   */
  async deleteView(name: string): Promise<void> {
    await this.viewButton(name).hover();
    const deleted = this.page.waitForResponse(
      (r) => /^\/fde-views\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname) && r.request().method() === 'DELETE',
    );
    await this.page.getByRole('button', { name: 'Supprimer la vue', exact: true }).last().click();
    expect((await deleted).ok(), 'DELETE /fde-views/{id}').toBe(true);
  }
}
