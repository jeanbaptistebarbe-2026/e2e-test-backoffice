import { test, expect } from './fixtures';
import { TemplatesPage } from '../pages/TemplatesPage';
import { meta } from './meta';

test.describe('Templates — administration (authentifié)', { tag: ['@role-admin', '@administration'] }, () => {
  test('la liste des templates se charge', meta('TC-ADM-TPL-01', 'Ouvre Administration › Templates et vérifie le bouton « Nouveau template » et la recherche.'), async ({ page }) => {
    const templates = new TemplatesPage(page);
    await templates.goToList();

    await expect(page).toHaveURL(/\/administration\/templates/);
    await expect(templates.newTemplateButton).toBeVisible();
    await expect(templates.searchInput).toBeVisible();
  });

  test('cycle de vie d’un template : création, édition puis suppression', meta('TC-ADM-TPL-04', 'Crée un template (nom, tribu, contenu), le modifie puis le supprime, en vérifiant la liste à chaque étape (données nettoyées).', { ecriture: true }), async ({ page }) => {
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
