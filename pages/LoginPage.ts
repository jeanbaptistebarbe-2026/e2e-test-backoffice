import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { fetchOtpFromEmail } from '../utils/email-otp';
import { requireSecret } from '../utils/secrets';

/**
 * Page Object du login du backoffice Neo (qg.swapn.tech).
 * Flux : route protégée sans session → `/auth` (redirection automatique, sans
 *        bouton) → écran identifiant Auth0 → écran mot de passe → bascule sur le
 *        facteur MFA « E-mail » → code lu en IMAP → `/auth/callback` → backoffice.
 */
export class LoginPage extends BasePage {
  // Écrans Auth0
  readonly usernameInput: Locator;
  readonly emailSubmitButton: Locator;
  readonly passwordInput: Locator;
  readonly passwordSubmitButton: Locator;
  readonly otpInput: Locator;
  readonly continueButton: Locator;

  // Bascule de facteur MFA (le défaut du compte est SMS → on choisit "E-mail")
  readonly useAnotherMethodLink: Locator;
  readonly emailFactorOption: Locator;

  // Messages d'erreur Auth0
  readonly emailRequiredError: Locator;
  readonly emailInvalidError: Locator;
  readonly passwordRequiredError: Locator;
  readonly wrongPasswordError: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.locator('input#username');
    this.emailSubmitButton = page.locator('button._button-login-id');
    this.passwordInput = page.locator('input#password');
    this.passwordSubmitButton = page.locator('button._button-login-password');
    this.otpInput = page.locator('input[name="code"]');
    this.continueButton = page.getByRole('button', { name: 'Continuer' });

    this.useAnotherMethodLink = page.getByText(/essayer une autre méthode/i);
    this.emailFactorOption = page.getByText(/^e-?mail$/i);

    this.emailRequiredError = page.locator('#error-cs-username-required');
    this.emailInvalidError = page.locator('#error-cs-email-invalid');
    this.passwordRequiredError = page.locator('#error-cs-password-required');
    this.wrongPasswordError = page.locator('#error-element-password');
  }

  /**
   * Ouvre le backoffice sans session et attend l'écran identifiant Auth0.
   * `/auth` initie la connexion tout seul (`GET /auth/login` puis redirection vers
   * l'URL Auth0) : il n'y a plus de bouton à cliquer.
   */
  async goToLogin(path = '/'): Promise<void> {
    await this.goto(path);
    await this.page.waitForURL('**/u/login/identifier**', { timeout: 30_000 });
    await expect(this.usernameInput).toBeVisible({ timeout: 15_000 });
  }

  async fillEmail(email: string): Promise<void> {
    await this.usernameInput.fill(email);
  }

  async submitEmail(): Promise<void> {
    await this.emailSubmitButton.click();
  }

  /** Saisit un email valide et attend l'affichage de l'écran mot de passe. */
  async enterEmail(email: string): Promise<void> {
    await this.fillEmail(email);
    await this.submitEmail();
    await expect(this.passwordInput).toBeVisible({ timeout: 10_000 });
  }

  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  async submitPassword(): Promise<void> {
    await this.passwordSubmitButton.click();
  }

  /**
   * Flux complet : email → mot de passe → bascule sur le facteur MFA « E-mail »
   * (le compte a SMS par défaut) → code envoyé par Auth0, lu en IMAP → retour backoffice.
   * Aucune dépendance à un téléphone : Auth0 envoie le code à l'adresse du compte.
   */
  async loginWithOtp(
    // Identifiants lus depuis les secrets chiffrés (ou .env local), jamais en dur.
    email = requireSecret('AUTH_EMAIL'),
    password = requireSecret('AUTH_PASSWORD'),
    // Boîte IMAP où lire le code (défaut : GMAIL_USER / GMAIL_APP_PASSWORD).
    imap: { user?: string; password?: string } = {},
  ): Promise<void> {
    await this.goToLogin();
    await this.enterEmail(email);
    await this.fillPassword(password);
    await this.submitPassword();

    // Le challenge par défaut est le SMS → on choisit le facteur « E-mail ».
    await this.useAnotherMethodLink.click();
    await this.page.waitForURL(/mfa-login-options/, { timeout: 15_000 });

    // Le code est envoyé au moment où l'on sélectionne « E-mail ».
    const beforeOtp = new Date();
    await this.emailFactorOption.first().click();
    await this.page.waitForURL(/mfa-email-challenge/, { timeout: 15_000 });

    await this.otpInput.waitFor({ state: 'visible', timeout: 15_000 });
    const otp = await fetchOtpFromEmail({
      sentAfter: beforeOtp,
      timeoutMs: 120_000,
      email: imap.user,
      appPassword: imap.password,
      // Filtre par destinataire : deux comptes peuvent partager la même boîte.
      recipient: email,
    });
    await this.otpInput.fill(otp);
    await this.continueButton.click();

    await this.page.waitForURL((url) => !url.host.includes('auth0.tiime.fr'), {
      timeout: 30_000,
    });
  }
}
