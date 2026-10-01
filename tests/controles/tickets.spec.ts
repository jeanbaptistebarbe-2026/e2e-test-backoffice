import { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { TicketsPage, FIL_DE_L_EAU } from '../../pages/TicketsPage';
import { AppShell } from '../../pages/AppShell';
import { QgApi, isApiUrl } from '../../utils/api';
import { roleAvailable } from '../../utils/roles';
import { meta } from '../meta';

/**
 * Traitement des tickets FDE (Lot 3), rôle BPO — cœur de métier du BPO.
 * Réf. : swapn-qg-source-de-verite.md §5.3, §6.4 (F-CTL-001 à F-CTL-008), P-002 à P-005.
 *
 * Données : tickets « À traiter » de la société de test (FDE_TEST_COMPANY, défaut
 * « Demo Setex 1 »). Tout ticket dont le statut est modifié par un test est remis
 * « À traiter » après le test (via l'API). La RÉSERVATION posée à l'ouverture n'est
 * pas libérable par l'API : elle expire seule (30 min) et le ticket reste attribué
 * au compte BPO de test, qui le revoit via son filtre « moi + Non assigné ».
 */

const COMPANY = process.env.FDE_TEST_COMPANY?.trim() || 'Demo Setex 1';

test.describe('Contrôles FDE — BPO', { tag: ['@role-bpo', '@controles'] }, () => {
  test.skip(!roleAvailable('bpo'), 'Compte BPO non renseigné (AUTH_EMAIL_BPO / AUTH_PASSWORD_BPO)');
  test.use({ role: 'bpo' });
  // Mêmes tickets partagés par tous les tests : en séquence dans un seul worker
  // (mode « default » : contrairement à « serial », un échec ne saute pas la suite).
  test.describe.configure({ mode: 'default' });

  /** Tickets ayant reçu une écriture pendant le test courant (à remettre « À traiter »). */
  let touched = new Set<string>();

  test.beforeEach(async ({ page }) => {
    touched = new Set();
    page.on('request', (r) => {
      if (r.method() === 'GET' || !isApiUrl(r.url())) return;
      const m = new URL(r.url()).pathname.match(/\/tickets\/([0-9a-f-]{36})/);
      if (m) touched.add(m[1]);
    });
  });

  test.afterEach(async ({ page }) => {
    if (touched.size === 0) return;
    const api = await QgApi.fromPage(page);
    try {
      for (const id of touched) {
        const t = await api.get<{ status: string; companyId: string }>(`/tickets/${id}`);
        if (t.status !== 'PENDING') await api.setTicketStatus(t.companyId, id, 'PENDING');
      }
    } finally {
      await api.dispose();
    }
  });

  /** Ouvre la liste filtrée sur la société de test. */
  async function openCompanyQueue(page: Page): Promise<TicketsPage> {
    const tickets = new TicketsPage(page);
    await tickets.goTo();
    await tickets.filterByCompany(COMPANY);
    await expect(tickets.ticketItems.first()).toBeVisible();
    return tickets;
  }

  test(
    'le « Fil de l’eau » affiche les 8 statuts dans l’ordre avec leur compteur',
    meta('TC-CTL-01', 'Ouvre Contrôles et vérifie le panneau « Fil de l’eau » : 8 statuts dans l’ordre, chacun avec son compteur.'),
    async ({ page }) => {
      const tickets = new TicketsPage(page);
      await tickets.goTo();

      for (const label of FIL_DE_L_EAU) await expect(tickets.statusFilter(label)).toBeVisible();
      const order = await page
        .getByRole('button', { name: /^.+ \d+$/ })
        .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\d+\s*$/, '').trim()));
      expect(order.filter((l) => (FIL_DE_L_EAU as readonly string[]).includes(l))).toEqual([...FIL_DE_L_EAU]);
      await expect(tickets.emptyDetail).toBeVisible();
    },
  );

  test(
    'filtres par défaut du BPO (moi + Non assigné) et filtre par dossier',
    meta('TC-CTL-02', 'Vérifie les filtres par défaut du BPO (intervenants « moi » + « Non assigné »), puis filtre sur la société de test : seuls ses tickets s’affichent.'),
    async ({ page }) => {
      const tickets = new TicketsPage(page);
      await tickets.goTo();
      const me = await new AppShell(page).currentUserName();

      // RG-CTL-007 : intervenants présélectionnés = « Non assigné » + soi.
      await tickets.filterButton.click();
      await tickets.filterField(/intervenant/i).click();
      await expect(page.getByRole('option', { name: 'Non assigné', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('option', { name: `${me} (moi)`, exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
      await tickets.filterDialog.getByRole('button', { name: 'Fermer les filtres' }).click();

      await tickets.filterByCompany(COMPANY);
      const companies = await tickets.ticketItems.allInnerTexts();
      expect(companies.length).toBeGreaterThan(0);
      for (const text of companies) expect(text).toContain(COMPANY);
    },
  );

  test(
    'ouvrir un ticket le réserve au BPO et affiche son détail',
    meta('TC-CTL-03', 'Ouvre un ticket de la société de test : il est réservé au BPO (« Assigné à ») et le détail est complet (code FDE, cycle, société, données, Tiime expert, discussion).', { ecriture: true }),
    async ({ page }) => {
      const tickets = await openCompanyQueue(page);
      const me = await new AppShell(page).currentUserName();
      const ticket = await tickets.openTicket(tickets.ticketItems.first());

      expect(ticket.collaboratorId, 'ticket réservé (collaboratorId)').toBeTruthy();
      await expect(tickets.assignedTo).toContainText(me);
      // En-tête « FDE-nnn · Cycle <lettre> - <libellé> » (F-CTL-004).
      await expect(page.getByText(/^FDE-\d{3}(-[A-Z])?$/).first()).toBeVisible();
      await expect(page.getByText(/^Cycle [A-K] - /).first()).toBeVisible();
      await expect(page.getByRole('link', { name: COMPANY, exact: true })).toHaveAttribute('href', `/companies/${ticket.companyId}`);
      await expect(tickets.resolveButton).toBeEnabled();
      await expect(tickets.snoozeButton).toBeVisible();
      await expect(tickets.discussionTitle).toBeVisible();
      await expect(tickets.statusButton('À traiter')).toHaveText('À traiter');
      // RG-CTL-011 : lien vers Tiime expert, nouvel onglet.
      await expect(tickets.tiimeExpertLink).toHaveAttribute(
        'href',
        /^https:\/\/expert\.tiime\.fr\/companies\/\d+\/pre-accounting\/transactions$/,
      );
      await expect(tickets.tiimeExpertLink).toHaveAttribute('target', '_blank');
    },
  );

  test(
    'changer le statut d’un ticket en « Attente client »',
    meta('TC-CTL-04', 'Passe un ticket en « Attente client » par le menu de statut, puis vérifie le toast et le statut en consultation. Ticket remis « À traiter » ensuite.', { ecriture: true }),
    async ({ page }) => {
      const tickets = await openCompanyQueue(page);
      const ticket = await tickets.openTicket(tickets.ticketItems.first());

      const patch = await tickets.changeStatus('À traiter', 'Attente client');
      expect(patch.ok()).toBe(true);
      expect(patch.request().postDataJSON()).toMatchObject({ status: 'WAITING_FOR_CLIENT_ACTION' });
      await expect(new AppShell(page).toast('Statut mis à jour')).toBeVisible();

      await tickets.goToConsultation(ticket.id);
      await expect(tickets.statusButton('Attente client')).toHaveText('Attente client');
    },
  );

  test(
    'marquer un ticket résolu : passage au suivant et bouton désactivé',
    meta('TC-CTL-05', 'Clique « Marquer résolu » : toast et passage au ticket suivant ; en consultation, le ticket est « Résolues » et le bouton désactivé. Ticket remis « À traiter » ensuite.', { ecriture: true }),
    async ({ page }) => {
      const tickets = await openCompanyQueue(page);
      const ticket = await tickets.openTicket(tickets.ticketItems.first());

      const next = tickets.waitForReservation();
      await tickets.resolveButton.click();
      await expect(new AppShell(page).toast('Ticket marqué comme résolu')).toBeVisible();
      // Le ticket suivant de la file est réservé et affiché (RG-CTL-010).
      const { ticket: following } = (await (await next).json()) as { ticket: { id: string } };
      expect(following.id).not.toBe(ticket.id);
      await expect(page).toHaveURL(new RegExp(`/tickets/${following.id}`));

      await tickets.goToConsultation(ticket.id);
      await expect(tickets.statusButton('Résolues')).toHaveText('Résolues');
      await expect(tickets.resolveButton).toBeDisabled();
    },
  );

  test(
    'ignorer un contrôle exige un motif d’au moins 4 caractères',
    meta('TC-CTL-06', 'Ouvre « Ignorer ce contrôle » : un motif de moins de 4 caractères bloque « Confirmer », « Annuler » ne change rien, un motif valide ignore le ticket. Ticket remis « À traiter » ensuite.', { ecriture: true }),
    async ({ page }) => {
      const tickets = await openCompanyQueue(page);
      const ticket = await tickets.openTicket(tickets.ticketItems.first());

      // « Annuler » : aucun changement.
      await tickets.statusButton('À traiter').click();
      await page.getByRole('menuitem', { name: 'Ignoré', exact: true }).click();
      await expect(tickets.ignoreDialog).toBeVisible();
      await expect(tickets.ignoreConfirm).toBeDisabled();
      await tickets.ignoreReason.fill('abc');
      await expect(tickets.ignoreConfirm).toBeDisabled();
      await expect(tickets.ignoreDialog.getByText('Le motif doit contenir au moins 4 caractères.')).toBeVisible();
      await tickets.ignoreCancel.click();
      await expect(tickets.ignoreDialog).toBeHidden();
      await expect(tickets.statusButton('À traiter')).toHaveText('À traiter');

      // Motif valide : ticket ignoré.
      await tickets.statusButton('À traiter').click();
      await page.getByRole('menuitem', { name: 'Ignoré', exact: true }).click();
      await tickets.ignoreReason.fill('Motif E2E : doublon de contrôle');
      const patched = page.waitForResponse(
        (r) => r.url().endsWith(`/tickets/${ticket.id}/status`) && r.request().method() === 'PATCH',
      );
      await tickets.ignoreConfirm.click();
      expect((await patched).request().postDataJSON()).toMatchObject({
        status: 'IGNORED',
        ignoreReason: 'Motif E2E : doublon de contrôle',
      });
      await expect(new AppShell(page).toast('Contrôle ignoré.')).toBeVisible();

      // Ticket ignoré : « Ignoré » n'est plus proposé dans le menu (§5.3).
      await tickets.goToConsultation(ticket.id);
      await tickets.statusButton('Ignoré').click();
      await expect(page.getByRole('menuitem', { name: 'À traiter', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Ignoré', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
    },
  );

  test(
    'écrire dans la discussion interne d’un ticket',
    meta('TC-CTL-07', 'Écrit un message unique dans la discussion interne d’un ticket (validation par Entrée) et vérifie qu’il apparaît dans le fil.', { ecriture: true }),
    async ({ page }) => {
      const tickets = await openCompanyQueue(page);
      await tickets.openTicket(tickets.ticketItems.first());

      await expect(tickets.discussionSend).toBeDisabled();
      const message = `Message interne E2E ${Date.now()}`;
      await tickets.discussionEditor.click();
      await page.keyboard.type(message);
      await page.keyboard.press('Enter');
      await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(tickets.discussionEditor).toHaveText('');
    },
  );

  test(
    'créer, refuser en doublon puis supprimer une vue de tickets',
    meta('TC-CTL-08', 'Crée une vue filtrée sur la société de test, vérifie le refus d’un doublon (« Vous avez déjà une vue portant ce nom. »), puis supprime la vue.', { ecriture: true }),
    async ({ page }) => {
      const tickets = new TicketsPage(page);
      await tickets.goTo();
      const name = `E2E vue ${Date.now()}`;

      const fillView = async () => {
        await tickets.addViewButton.click();
        await expect(tickets.viewDialog).toBeVisible();
        await expect(tickets.saveViewButton).toBeDisabled();
        await tickets.viewNameInput.fill(name);
        await expect(tickets.saveViewButton, 'nom sans filtre').toBeDisabled();
        await tickets.viewDialog.getByRole('button', { name: 'Tous les dossiers' }).click();
        await page.getByRole('textbox', { name: 'Rechercher un dossier' }).fill(COMPANY);
        await page.getByRole('option', { name: COMPANY, exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(tickets.saveViewButton).toBeEnabled();
      };

      await fillView();
      await tickets.saveViewButton.click();
      await expect(tickets.viewDialog).toBeHidden();
      await expect(tickets.viewButton(name)).toBeVisible();

      try {
        // Doublon : refusé (409) avec un message dédié (RG-CTL-004).
        await fillView();
        await tickets.saveViewButton.click();
        await expect(tickets.viewDialog.getByText('Vous avez déjà une vue portant ce nom.')).toBeVisible();
      } finally {
        // La boîte reste ouverte après un refus : la fermer (elle est modale et
        // masquerait la liste des vues), puis supprimer la vue créée.
        if (await tickets.viewDialog.isVisible()) {
          await tickets.viewDialog.getByRole('button', { name: 'Close', exact: true }).click();
          await expect(tickets.viewDialog).toBeHidden();
        }
        await tickets.deleteView(name);
      }
      await expect(tickets.viewButton(name)).toHaveCount(0);
    },
  );

  test(
    'le mode consultation ouvre un ticket sans le réserver',
    meta('TC-CTL-10', 'Ouvre un ticket en mode consultation (?consultation=1) et vérifie qu’aucune réservation n’est faite.'),
    async ({ page }) => {
      const tickets = new TicketsPage(page);
      await tickets.goTo();
      const api = await QgApi.fromPage(page);
      const { items } = await api.get<{ items: { id: string }[] }>('/tickets?page=1&page_size=1&statuses=PENDING');
      await api.dispose();

      const reservations: string[] = [];
      page.on('request', (r) => {
        if (new URL(r.url()).pathname.startsWith('/tickets/self-assign')) reservations.push(r.url());
      });
      await tickets.goToConsultation(items[0].id);
      await expect(tickets.resolveButton).toBeVisible();
      expect(reservations, 'aucune réservation en consultation').toEqual([]);
    },
  );
});
