import { test } from './fixtures';
import { HomePage } from '../pages/HomePage';

test.describe('Smoke — backoffice', { tag: ['@nav', '@readonly'] }, () => {
  test('le backoffice charge après authentification', { tag: ['@TC-NAV-01', '@p0', '@smoke'] }, async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('/');
    await home.expectLoaded();
  });
});
