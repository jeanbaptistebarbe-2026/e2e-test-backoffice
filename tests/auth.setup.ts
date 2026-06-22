import { test as setup } from './fixtures';
import { LoginPage } from '../pages/LoginPage';

const authFile = 'playwright/.auth/user.json';

setup('authenticate via Auth0', async ({ page }) => {
  const login = new LoginPage(page);
  await login.loginWithOtp();

  // Gestion défensive d'une éventuelle page CGU (si le backoffice la présente)
  const cguCheckbox = page.locator('#cgu-checkbox');
  const cguAppeared = await cguCheckbox
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (cguAppeared) {
    await cguCheckbox.click();
    await page.locator('#privacy-checkbox').click();
    await page.getByRole('button', { name: 'Valider' }).click();
  }

  // Sauvegarde de l'état d'authentification (cookies + storage)
  await page.context().storageState({ path: authFile });
});
