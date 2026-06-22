import { test, expect } from './fixtures';
import { SignaturesPage } from '../pages/SignaturesPage';

test.describe('Signatures — administration (authentifié)', () => {
  test('les deux pages de signatures existent et sont atteignables', async ({ page }) => {
    const sig = new SignaturesPage(page);

    await sig.goToList();
    await expect(page).toHaveURL(/\/administration\/signatures/);
    await expect(sig.newSignatureButton).toBeVisible();
    await expect(sig.searchInput).toBeVisible();

    await sig.goToMesSignatures();
    await expect(page).toHaveURL(/\/administration\/mes-signatures/);
  });

  test('cycle de vie d’une signature : création, édition puis suppression', async ({ page }) => {
    const sig = new SignaturesPage(page);
    const ts = Date.now();
    const name = `SIGNATURE ${ts}`;
    const content = `signature test ${ts}`;
    const editedName = `${name} edited`;

    // --- Création ---
    await sig.goToList();
    await sig.startNewSignature();
    await sig.fillName(name);
    await sig.selectFirstTribu();
    await sig.fillContent(content);
    await sig.submit(); // attend la redirection vers la liste après création

    await sig.search(name);
    await expect(sig.signatureRow(name)).toBeVisible({ timeout: 10_000 });

    // --- Édition : on ajoute « edited » au nom et au contenu ---
    await sig.editFromRow(name);
    await sig.appendToName(' edited');
    await sig.appendToContent(' edited');
    await sig.submit(); // PATCH puis redirection vers la liste

    await sig.search(editedName);
    await expect(sig.signatureRow(editedName)).toBeVisible({ timeout: 10_000 });

    // --- Suppression + vérification de l'absence ---
    await sig.deleteFromRow(editedName);
    await expect(sig.signatureRow(editedName)).toHaveCount(0, { timeout: 10_000 });
  });
});
