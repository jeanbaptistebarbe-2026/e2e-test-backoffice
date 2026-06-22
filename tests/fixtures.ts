import { test as base, expect } from '@playwright/test';

/**
 * Base de test partagée par tous les specs.
 *
 * Capture automatiquement une capture d'écran de la page et l'attache au rapport
 * lorsqu'un test échoue — pour disposer de l'erreur visuellement dans le rapport
 * (aide au debug). L'attachement (`testInfo.attach`) s'affiche dans le rapport HTML.
 *
 * Implémenté EN CODE (et non via `use.screenshot` de playwright.config.ts) car
 * l'orchestrateur SquashTM exécute Playwright avec sa propre config générée et ne
 * charge pas notre `playwright.config.ts` — un screenshot piloté par le code
 * fonctionne donc en local ET sur le runner.
 */
export const test = base.extend<{ autoScreenshotOnFailure: void }>({
  autoScreenshotOnFailure: [
    async ({ page }, use, testInfo) => {
      await use();
      // status = résultat réel ; expectedStatus = résultat attendu (passed, ou
      // failed pour un test.fail()). Différents ⇒ le test a échoué.
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await page
          .screenshot({ fullPage: true })
          .catch(() => null); // page parfois déjà fermée (crash) → on n'échoue pas le teardown
        if (screenshot) {
          await testInfo.attach('screenshot-échec', {
            body: screenshot,
            contentType: 'image/png',
          });
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
