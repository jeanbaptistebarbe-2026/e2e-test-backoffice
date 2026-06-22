import { test, expect } from './fixtures';
import { CollaboratorsPage } from '../pages/CollaboratorsPage';

test.describe('Collaborators — liste (authentifié)', () => {
  test('la liste des collaborateurs se charge et est peuplée', async ({ page }) => {
    const collaborators = new CollaboratorsPage(page);
    await collaborators.goToList();

    await expect(page).toHaveURL(/\/collaborators/);
    await expect(collaborators.table).toBeVisible();
    await expect(collaborators.inviteButton).toBeVisible();
    await expect(collaborators.searchInput).toBeVisible();

    // Toutes les colonnes attendues sont présentes.
    for (const header of CollaboratorsPage.COLUMNS) {
      await expect(collaborators.columnHeader(header)).toBeVisible();
    }

    // La liste est peuplée (au moins une ligne) — assertion web-first (auto-retry).
    await expect(collaborators.rows.first()).toBeVisible();
  });

  test('inviter un collaborateur (email jetable, statut « Invité »)', async ({ page }) => {
    const collaborators = new CollaboratorsPage(page);
    // Email unique par run. NB : pas de révocation possible dans l'UI → l'invitation
    // en attente reste dans la liste (choix assumé : invitation réelle).
    const email = `jean.baptiste.barbe+e2e-${Date.now()}@swapn.fr`;

    await collaborators.goToList();
    await collaborators.openInvite();
    await collaborators.invite(email, 'Collaborateur');

    // Succès : l'invité apparaît dans la liste avec le statut « Invité ».
    await collaborators.search(email);
    const row = collaborators.rowByText(email);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('Invité');
  });
});
