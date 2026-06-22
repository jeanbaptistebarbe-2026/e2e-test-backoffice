import { test, expect } from './fixtures';
import { CalendarPage } from '../pages/CalendarPage';
import { IntegrationsPage } from '../pages/IntegrationsPage';

test.describe('Calendar (authentifié, conditionné au SSO Google)', () => {
  test('le calendrier se charge quand le SSO Google est actif', async ({ page }) => {
    // Le calendrier dépend de l'intégration Google → on saute si elle est inactive.
    const integrations = new IntegrationsPage(page);
    const ssoActive = await integrations.isGoogleSsoActive();
    test.skip(!ssoActive, 'SSO Google inactif → calendrier non alimenté, test non pertinent');

    const calendar = new CalendarPage(page);
    await calendar.goTo();

    await expect(page).toHaveURL(/\/calendar/);

    // Chrome du calendrier (toujours présent une fois la page chargée).
    await expect(calendar.newEventButton).toBeVisible();
    await expect(calendar.viewTab('7 jours')).toBeVisible();
    await expect(calendar.viewTab('30 jours')).toBeVisible();
    await expect(calendar.viewTab('90 jours')).toBeVisible();

    // Données chargées depuis Google : au moins un créneau affiché (web-first).
    await expect(calendar.eventTimes.first()).toBeVisible();
  });
});
