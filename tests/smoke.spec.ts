import { test } from './fixtures';
import { HomePage } from '../pages/HomePage';

test.describe('Smoke — backoffice', () => {
  test('le backoffice charge après authentification', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('/');
    await home.expectLoaded();
  });
});
