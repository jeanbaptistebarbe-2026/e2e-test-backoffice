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
});
