import { loggedOutTest as test, expect } from './fixtures';
import { LoginPage } from '../pages/LoginPage';

// Identifiants du compte de test. Défaut intégré au code (même pattern que
// BASE_URL) car les variables d'environnement ne sont pas encore disponibles
// côté SquashTM. Si AUTH_EMAIL/AUTH_PASSWORD sont fournis par l'environnement,
// ils prennent le dessus.
// TODO secrets : déplacer vers des variables d'environnement Squash dès que
// possible — PUIS changer le mot de passe du compte de test (il restera dans
// l'historique git).
const AUTH_EMAIL = process.env.AUTH_EMAIL ?? 'jean.baptiste.barbe@swapn.fr';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? 'Jesuisunefee94!';

// Ces tests jouent le flux de login depuis zéro : `loggedOutTest` fournit déjà un
// contexte vierge (pas d'état d'authentification).

test.describe('Login — page /auth du backoffice', () => {
  let login: LoginPage;

  test.beforeEach(async ({ page }) => {
    login = new LoginPage(page);
    await login.goToAuthLanding();
  });

  test('affiche la page de connexion Neo avec le bouton Auth0', async ({ page }) => {
    await expect(page).toHaveURL(/qg\.swapn\.tech\/auth/);
    await expect(login.signInWithAuth0Button).toBeVisible();
  });

  test('le bouton Auth0 redirige vers le login Auth0', async ({ page }) => {
    await login.signInWithAuth0Button.click();
    await expect(page).toHaveURL(/auth0\.tiime\.fr\/u\/login\/identifier/, {
      timeout: 15_000,
    });
  });
});

test.describe('Login — écran email', () => {
  let login: LoginPage;

  test.beforeEach(async ({ page }) => {
    login = new LoginPage(page);
    await login.goToLogin();
  });

  test('redirige vers la page de login Auth0', async ({ page }) => {
    await expect(page).toHaveURL(/auth0\.tiime\.fr\/u\/login\/identifier/);
    await expect(login.usernameInput).toBeVisible();
  });

  test('affiche une erreur si l’email est vide', async () => {
    await login.submitEmail();
    await expect(login.emailRequiredError).toBeVisible();
    await expect(login.emailRequiredError).toHaveText(
      /Veuillez saisir une adresse e-mail/,
    );
  });

  test('affiche une erreur si le format d’email est invalide', async () => {
    await login.fillEmail('not-an-email');
    await login.submitEmail();
    await expect(login.emailInvalidError).toBeVisible();
    await expect(login.emailInvalidError).toHaveText(
      /Saisissez une adresse email valide/,
    );
  });

  test('un email valide mène à l’écran mot de passe', async () => {
    await login.enterEmail(AUTH_EMAIL);
    await expect(login.passwordInput).toBeVisible();
  });
});

test.describe('Login — écran mot de passe', () => {
  let login: LoginPage;

  test.beforeEach(async ({ page }) => {
    login = new LoginPage(page);
    await login.goToLogin();
    await login.enterEmail(AUTH_EMAIL);
  });

  test('affiche une erreur si le mot de passe est vide', async () => {
    await login.submitPassword();
    await expect(login.passwordRequiredError).toBeVisible();
    await expect(login.passwordRequiredError).toHaveText(/Mot de passe requis/);
  });

  test('affiche une erreur si le mot de passe est incorrect', async () => {
    await login.fillPassword('WrongPassword123!');
    await login.submitPassword();
    await expect(login.wrongPasswordError).toBeVisible({ timeout: 10_000 });
    await expect(login.wrongPasswordError).toHaveText(
      /Email ou mot de passe incorrect/,
    );
  });

  test('un mot de passe valide mène au challenge MFA', async ({ page }) => {
    await login.fillPassword(AUTH_PASSWORD);
    await login.submitPassword();
    // Ce compte utilise une MFA par SMS ; on accepte tout challenge MFA Auth0
    await expect(page).toHaveURL(/\/u\/mfa-.*-challenge/, { timeout: 30_000 });
    await expect(login.otpInput).toBeVisible({ timeout: 10_000 });
  });
});
