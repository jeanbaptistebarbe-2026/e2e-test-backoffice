import { test, expect } from './fixtures';
import { TemplatesPage } from '../pages/TemplatesPage';

test.describe('Templates — administration (authentifié)', () => {
  test('la liste des templates se charge', async ({ page }) => {
    const templates = new TemplatesPage(page);
    await templates.goToList();

    await expect(page).toHaveURL(/\/administration\/templates/);
    await expect(templates.newTemplateButton).toBeVisible();
    await expect(templates.searchInput).toBeVisible();
  });

  test('cycle de vie d’un template : création, édition puis suppression', async ({ page }) => {
    const templates = new TemplatesPage(page);
    const ts = Date.now();
    const name = `TEMPLATE ${ts}`;
    const content = `contenu test ${ts}`;
    const editedName = `${name} edited`;

    // --- Création ---
    await templates.goToList();
    await templates.startNewTemplate();
    await templates.fillName(name);
    await templates.selectFirstTribu();
    await templates.fillContent(content);
    await templates.submit();

    await templates.search(name);
    await expect(templates.templateRow(name)).toBeVisible({ timeout: 10_000 });

    // --- Édition : on ajoute « edited » au nom et au contenu ---
    await templates.editFromRow(name);
    await templates.appendToName(' edited');
    await templates.appendToContent(' edited');
    await templates.submit();

    await templates.search(editedName);
    await expect(templates.templateRow(editedName)).toBeVisible({ timeout: 10_000 });

    // --- Suppression + vérification de l'absence ---
    await templates.deleteFromRow(editedName);
    await expect(templates.templateRow(editedName)).toHaveCount(0, { timeout: 10_000 });
  });
});
