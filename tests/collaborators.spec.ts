import { test, expect } from './fixtures';
import { CollaboratorsPage } from '../pages/CollaboratorsPage';

test.describe('Collaborators — liste (authentifié)', { tag: ['@admin', '@readonly', '@role-admin'] }, () => {
  test('la liste des collaborateurs se charge et est peuplée', { tag: ['@TC-ADM-COL-01', '@p0', '@smoke'] }, async ({ page }) => {
    const collaborators = new CollaboratorsPage(page);
    await collaborators.goToList();

    await expect(page).toHaveURL(/\/collaborators/);
    await expect(collaborators.table).toBeVisible();
    await expect(collaborators.searchInput).toBeVisible();

    // Toutes les colonnes attendues sont présentes.
    for (const header of CollaboratorsPage.COLUMNS) {
      await expect(collaborators.columnHeader(header)).toBeVisible();
    }

    // La liste est peuplée (au moins une ligne) — assertion web-first (auto-retry).
    await expect(collaborators.rows.first()).toBeVisible();
  });
});
