import { Page, Request } from '@playwright/test';
import { test, expect, authFile } from '../fixtures';
import { InboxPage, InboxView } from '../../pages/InboxPage';
import { ComposerDialog } from '../../pages/ComposerDialog';
import { ConversationPanel } from '../../pages/ConversationPanel';
import { AppShell } from '../../pages/AppShell';
import { QgApi, isApiUrl } from '../../utils/api';
import { credentialsFor } from '../../utils/roles';
import { fetchEmailBySubject } from '../../utils/email-otp';
import { meta } from '../meta';

/**
 * Messagerie e-mail et interne (Lot 4), rôle ADMIN.
 * Réf. : swapn-qg-source-de-verite.md §6.3 (F-INB-001 à F-INB-011), P-009 à P-013.
 *
 * Données : AUCUNE conversation permanente. La partie « écriture » crée à chaque run
 * sa propre conversation en s'envoyant un mail depuis le BO (vers la boîte du compte,
 * lue en IMAP), puis l'archive en fin de parcours.
 */

/** Requêtes d'écriture (hors GET) vers l'API QG, pour prouver qu'un écran est en lecture seule. */
function trackApiWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (r: Request) => {
    if (isApiUrl(r.url()) && r.method() !== 'GET') {
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  return writes;
}

test.describe('Messagerie — lecture', { tag: ['@role-admin', '@messagerie'] }, () => {
  test(
    'les vues de la barre latérale mettent à jour l’URL et le compteur du titre',
    meta('TC-INB-10', 'Parcourt les vues Assigné, Suivi, Brouillons et Envoyés : l’URL suit la vue, et le compteur du titre égale celui de la barre latérale.'),
    async ({ page }) => {
      const inbox = new InboxPage(page);
      await inbox.goTo();
      await expect(inbox.heading).toHaveText(/^Ouvert \(\d+\)$/, { timeout: 20_000 });

      const views: [InboxView, string][] = [
        ['Assigné', 'assigned'],
        ['Suivi', 'followed'],
        ['Brouillons', 'drafts'],
        ['Envoyés', 'sent'],
      ];
      for (const [view, key] of views) {
        await inbox.viewButton(view).click();
        await expect(page).toHaveURL(new RegExp(`[?&]view=${key}(&|$)`));
        await expect(inbox.heading).toHaveText(/^Ouvert \(\d+\)$/);
      }

      // « Assigné » : le compteur du titre égale celui de la barre latérale
      // (données temps réel → relu jusqu'à cohérence).
      await inbox.viewButton('Assigné').click();
      await expect(async () => {
        expect(await inbox.headingCount()).toBe(await inbox.viewCount('Assigné'));
      }).toPass({ timeout: 15_000 });

      await inbox.viewButton('Boîte de réception').click();
      await expect(page).not.toHaveURL(/[?&]view=/);
    },
  );

  test(
    'une recherche sans résultat affiche le message dédié',
    meta('TC-INB-11', 'Recherche une chaîne introuvable et vérifie le message « Aucune conversation ne correspond à votre recherche. ».'),
    async ({ page }) => {
      const inbox = new InboxPage(page);
      await inbox.goTo();
      await expect(inbox.heading).toBeVisible({ timeout: 20_000 });
      await inbox.search(`zzz-e2e-introuvable-${Date.now()}`);
      await expect(inbox.noResultMessage).toBeVisible({ timeout: 15_000 });
      await expect(inbox.threadItems).toHaveCount(0);
    },
  );

  test(
    'la boîte « Filtrer par » affiche ses valeurs par défaut',
    meta('TC-INB-12', 'Ouvre « Filtrer par » et vérifie les valeurs par défaut (Ouvert, Tous, Toutes, Plus récentes) et les boutons.'),
    async ({ page }) => {
      const inbox = new InboxPage(page);
      await inbox.goTo();
      await inbox.filterButton.click();
      const dialog = page.getByRole('dialog', { name: 'Filtrer par' });
      await expect(dialog).toBeVisible();
      // Statut, Canal de communication, Conversations, Tri (F-INB-003).
      for (const value of ['Ouvert', 'Tous', 'Toutes', 'Plus récentes']) {
        await expect(dialog.getByRole('combobox').filter({ hasText: value }).first()).toBeVisible();
      }
      await expect(dialog.getByRole('button', { name: 'Réinitialiser les filtres' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Filtrer', exact: true })).toBeVisible();
    },
  );

  test(
    'ouvrir une conversation affiche son en-tête sans aucune écriture',
    meta('TC-INB-13', 'Ouvre une conversation envoyée et vérifie les actions de l’en-tête et de la zone de réponse, sans aucune requête d’écriture.'),
    async ({ page }) => {
      const writes = trackApiWrites(page);
      const inbox = new InboxPage(page);
      // « Envoyés » : uniquement des mails (l'Inbox mêle WhatsApp, interne…, sans « Répondre »).
      await inbox.goTo('Envoyés');
      await inbox.threadItems.first().click();

      await expect(page).toHaveURL(/[?&]threadId=[0-9a-f-]{36}/);
      const conversation = new ConversationPanel(page);
      for (const action of conversation.headerActions()) await expect(action).toBeVisible();
      await expect(conversation.replyButton).toBeVisible();
      await expect(conversation.commentTab).toBeVisible();
      // Aucun marquage « lu » ni autre écriture à l'ouverture (RG-INB-003).
      expect(writes).toEqual([]);
    },
  );

  test(
    'le formulaire « Envoyer un mail » valide destinataires, objet et corps',
    meta('TC-INB-14', 'Teste le formulaire « Envoyer un mail » : adresse invalide refusée, « Envoyer » désactivé sans objet, invite de brouillon à la fermeture, sans rien envoyer.'),
    async ({ page }) => {
      const writes = trackApiWrites(page);
      const inbox = new InboxPage(page);
      const composer = new ComposerDialog(page);
      await inbox.goTo();

      // Fermeture sans contenu : directe, sans invite (RG-INB-013).
      await inbox.newMailButton.click();
      await expect(composer.dialog).toBeVisible();
      await expect(composer.sendButton).toBeDisabled();
      await composer.cancelButton.click();
      await expect(composer.dialog).toBeHidden();

      await inbox.newMailButton.click();
      await composer.addRecipient('adresse-invalide');
      await expect(composer.dialog.getByRole('button', { name: /^Retirer / })).toHaveCount(0);

      await composer.addRecipient('destinataire@exemple.fr');
      await expect(composer.chip('destinataire@exemple.fr')).toBeVisible();
      await composer.typeBody('Corps de test');
      await expect(composer.sendButton, 'objet vide').toBeDisabled();
      await composer.fillSubject('Objet de test');
      await expect(composer.sendButton).toBeEnabled();

      // Fermeture avec contenu : invite de brouillon → « Ne pas enregistrer ».
      await composer.cancelButton.click();
      await expect(composer.draftPrompt).toBeVisible();
      await composer.draftChoice('Ne pas enregistrer').click();
      await expect(composer.dialog).toBeHidden();
      expect(writes, 'aucun envoi ni brouillon').toEqual([]);
    },
  );
});

test.describe('Messagerie — envoi et échanges', { tag: ['@role-admin', '@messagerie', '@ecriture'] }, () => {
  // Parcours enchaîné sur UNE conversation créée par le premier test.
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now();
  const subject = `E2E ${stamp}`;
  const body = `Corps E2E ${stamp}`;
  let threadId: string | undefined;

  test.afterAll(async () => {
    // Nettoyage : archiver les conversations de test envoyées (celle de ce run et les
    // copies tardives des runs précédents, remontées par la synchronisation Gmail).
    const api = await QgApi.fromStorageState(authFile('admin'));
    try {
      await api.archiveSentThreads(/^(Re: )*E2E \d{13}$/);
    } finally {
      await api.dispose();
    }
  });

  test(
    'envoyer un mail depuis le BO : toast, vue « Envoyés » et réception réelle',
    meta('TC-INB-20', 'Envoie depuis le BO un mail à la boîte du compte : toast, présence dans « Envoyés » et réception réelle vérifiée par IMAP.'),
    async ({ page }) => {
      const me = credentialsFor('admin');
      const inbox = new InboxPage(page);
      const composer = new ComposerDialog(page);
      const shell = new AppShell(page);
      await inbox.goTo();

      await inbox.newMailButton.click();
      await composer.addRecipient(me.imapUser);
      await composer.fillSubject(subject);
      await composer.typeBody(body);

      const created = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/threads' && r.request().method() === 'POST',
      );
      const sentAt = new Date();
      await composer.send();
      threadId = ((await (await created).json()) as { id: string }).id;

      await expect(shell.toast('Email envoyé avec succès')).toBeVisible();
      await expect(composer.dialog).toBeHidden();

      await inbox.viewButton('Envoyés').click();
      await expect(inbox.threadItem(body)).toHaveCount(1, { timeout: 20_000 });

      const mail = await fetchEmailBySubject({
        subject,
        sentAfter: sentAt,
        email: me.imapUser,
        appPassword: me.imapPassword,
      });
      expect(mail.text ?? '').toContain(body);
    },
  );

  test(
    'publier puis supprimer un commentaire interne, avec suggestion de mention',
    meta('TC-INB-21', 'Sur la conversation créée, vérifie la liste des mentions « @ », publie un commentaire interne puis le supprime.'),
    async ({ page }) => {
      test.skip(!threadId, 'Conversation de test absente (échec de TC-INB-20)');
      const inbox = new InboxPage(page);
      const conversation = new ConversationPanel(page);
      await inbox.goto(`/?view=sent&threadId=${threadId}`);
      await expect(conversation.subject(subject)).toBeVisible({ timeout: 20_000 });

      // Mention « @ » : la liste des collaborateurs mentionnables s'ouvre et contient
      // l'utilisateur courant (on n'insère rien).
      const me = await new AppShell(page).currentUserName();
      await conversation.commentTab.click();
      await conversation.commentEditor.click();
      await page.keyboard.type('@');
      await expect(conversation.mentionSuggestion(me)).toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Backspace');
      await expect(conversation.commentEditor).toHaveText('');

      const comment = `Commentaire E2E ${stamp}`;
      await conversation.postComment(comment);
      await expect(conversation.comment(comment)).toBeVisible();

      await conversation.deleteComment(comment);
      await expect(conversation.comment(comment)).toHaveCount(0);
      await expect(page.getByText('Message supprimé').first()).toBeVisible();
    },
  );

  test(
    'répondre à la conversation : formulaire pré-rempli, envoi et réception',
    meta('TC-INB-22', 'Répond à la conversation : formulaire pré-rempli (« Re: <objet> », destinataire), envoi, puis réception vérifiée par IMAP.'),
    async ({ page }) => {
      test.skip(!threadId, 'Conversation de test absente (échec de TC-INB-20)');
      const me = credentialsFor('admin');
      const inbox = new InboxPage(page);
      const conversation = new ConversationPanel(page);
      // Depuis le nouveau build, la réponse s'écrit DANS la conversation (pas de boîte).
      const composer = new ComposerDialog(page, 'inline');
      const shell = new AppShell(page);
      await inbox.goto(`/?view=sent&threadId=${threadId}`);
      await expect(conversation.subject(subject)).toBeVisible({ timeout: 20_000 });

      await conversation.replyButton.click();
      await expect(composer.subject).toBeVisible();
      await expect(composer.subject).toHaveValue(`Re: ${subject}`);
      await expect(composer.chip(me.imapUser)).toBeVisible();

      const reply = `Réponse E2E ${stamp}`;
      await composer.typeBody(reply);
      const sentAt = new Date();
      await composer.send();
      await expect(shell.toast('Email envoyé avec succès')).toBeVisible();

      const mail = await fetchEmailBySubject({
        subject: `Re: ${subject}`,
        sentAfter: sentAt,
        email: me.imapUser,
        appPassword: me.imapPassword,
      });
      expect(mail.text ?? '').toContain(reply);
    },
  );

  test(
    'enregistrer un mail abandonné comme brouillon',
    meta('TC-INB-23', 'Ferme un mail abandonné, l’enregistre comme brouillon et vérifie sa présence dans « Brouillons » (brouillon supprimé ensuite).'),
    async ({ page }) => {
      const inbox = new InboxPage(page);
      const composer = new ComposerDialog(page);
      const draftSubject = `Brouillon E2E ${stamp}`;
      await inbox.goTo();

      await inbox.newMailButton.click();
      await composer.fillSubject(draftSubject);
      await composer.cancelButton.click();
      await expect(composer.draftPrompt).toBeVisible();

      const saved = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/drafts' && r.request().method() === 'POST',
      );
      await composer.draftChoice('Enregistrer').click();
      const response = await saved;
      expect(response.ok(), 'POST /drafts').toBe(true);
      const draftId = ((await response.json()) as { id: string }).id;

      try {
        await expect(composer.dialog).toBeHidden();
        // Le brouillon rejoint la vue « Brouillons » (texte de l'invite, RG-INB-013).
        await inbox.viewButton('Brouillons').click();
        await expect(page).toHaveURL(/[?&]view=drafts/);
        await expect(page.getByText(draftSubject).first()).toBeVisible({ timeout: 15_000 });
      } finally {
        // Nettoyage du brouillon, même si une assertion échoue.
        const api = await QgApi.fromPage(page);
        try {
          await api.deleteDraft(draftId);
        } finally {
          await api.dispose();
        }
      }
    },
  );
});
