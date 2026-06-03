import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

// Ces tests jouent le flux de login depuis zéro — pas d'état d'authentification.
test.use({ storageState: { cookies: [], origins: [] } });

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
    await login.enterEmail(process.env.AUTH_EMAIL!);
    await expect(login.passwordInput).toBeVisible();
  });
});

test.describe('Login — écran mot de passe', () => {
  let login: LoginPage;

  test.beforeEach(async ({ page }) => {
    login = new LoginPage(page);
    await login.goToLogin();
    await login.enterEmail(process.env.AUTH_EMAIL!);
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
    await login.fillPassword(process.env.AUTH_PASSWORD!);
    await login.submitPassword();
    // Ce compte utilise une MFA par SMS ; on accepte tout challenge MFA Auth0
    await expect(page).toHaveURL(/\/u\/mfa-.*-challenge/, { timeout: 30_000 });
    await expect(login.otpInput).toBeVisible({ timeout: 10_000 });
  });
});
