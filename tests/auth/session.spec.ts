import { loggedOutTest as test, expect } from '../fixtures';
import { LoginPage } from '../../pages/LoginPage';

// Comportements de session vérifiables SANS compte : contexte vierge (`loggedOutTest`).
// Réf. : swapn-qg-source-de-verite.md §2.2 (flux de connexion), §6.1 F-GLB-003.

test.describe('Session — accès sans authentification', { tag: ['@auth', '@readonly'] }, () => {
  for (const path of ['/', '/annuaire', '/tickets']) {
    test(
      `une route protégée (${path}) sans session redirige vers Auth0 via /auth`,
      { tag: ['@TC-AUTH-12', '@p0'] },
      async ({ page }) => {
        // Suivi des navigations du cadre principal : on doit passer par /auth.
        const visited: string[] = [];
        page.on('framenavigated', (f) => {
          if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
        });

        const login = new LoginPage(page);
        await login.goToLogin(path);

        await expect(page).toHaveURL(/auth0\.tiime\.fr\/u\/login\/identifier/);
        expect(visited).toContain('/auth');
      },
    );
  }

  test(
    'un callback OAuth au state altéré affiche l’erreur de vérification de sécurité',
    { tag: ['@TC-AUTH-13', '@p1'] },
    async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto('/auth/callback?code=e2e-faux&state=e2e-faux');

      // Regex `.` sur l'apostrophe : droite ou typographique selon la source.
      await expect(page.getByText(/^Erreur d.authentification$/)).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText('La vérification de sécurité de la connexion a échoué. Veuillez réessayer.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Changer de compte', exact: true })).toBeVisible();
    },
  );
});

test.describe('Pages d’erreur publiques', { tag: ['@nav', '@readonly'] }, () => {
  test(
    'une route inconnue affiche l’écran d’erreur générique (ANO-01)',
    { tag: ['@TC-NAV-ERR-01', '@p2'] },
    async ({ page }) => {
      // Comportement ACTUEL documenté : écran générique hors layout au lieu d'un
      // « Page non trouvée ». À faire évoluer quand ANO-01 sera corrigée.
      const login = new LoginPage(page);
      await login.goto('/zzz-page-inexistante-e2e');

      await expect(page.getByRole('heading', { name: 'Une erreur est survenue' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/^Désolé, une erreur inattendue s.est produite\.$/)).toBeVisible();
      await expect(page.getByRole('link', { name: /^Retour à l.accueil$/ })).toHaveAttribute('href', '/');
    },
  );
});
