import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { fetchOtpFromGmail } from '../utils/gmail-otp';

/**
 * Page Object du login du backoffice Neo (qg.swapn.tech).
 * Flux : page /auth (bouton "Se connecter avec Auth0") → écran identifiant Auth0
 *        → écran mot de passe → challenge MFA (OTP email) → retour backoffice.
 */
export class LoginPage extends BasePage {
  // Page /auth du backoffice (avant Auth0)
  readonly authLandingHeading: Locator;
  readonly signInWithAuth0Button: Locator;

  // Écrans Auth0
  readonly usernameInput: Locator;
  readonly emailSubmitButton: Locator;
  readonly passwordInput: Locator;
  readonly passwordSubmitButton: Locator;
  readonly otpInput: Locator;
  readonly continueButton: Locator;

  // Messages d'erreur Auth0
  readonly emailRequiredError: Locator;
  readonly emailInvalidError: Locator;
  readonly passwordRequiredError: Locator;
  readonly wrongPasswordError: Locator;

  constructor(page: Page) {
    super(page);
    this.authLandingHeading = page.getByText('Connexion', { exact: true });
    this.signInWithAuth0Button = page.getByRole('button', {
      name: 'Se connecter avec Auth0',
    });

    this.usernameInput = page.locator('input#username');
    this.emailSubmitButton = page.locator('button._button-login-id');
    this.passwordInput = page.locator('input#password');
    this.passwordSubmitButton = page.locator('button._button-login-password');
    this.otpInput = page.locator('input[name="code"]');
    this.continueButton = page.getByRole('button', { name: 'Continuer' });

    this.emailRequiredError = page.locator('#error-cs-username-required');
    this.emailInvalidError = page.locator('#error-cs-email-invalid');
    this.passwordRequiredError = page.locator('#error-cs-password-required');
    this.wrongPasswordError = page.locator('#error-element-password');
  }

  /** Va sur le backoffice et attend l'affichage de la page /auth (bouton Auth0). */
  async goToAuthLanding(): Promise<void> {
    await this.goto('/');
    await this.page.waitForURL('**/auth**', { timeout: 15_000 });
    await this.signInWithAuth0Button.waitFor({ state: 'visible', timeout: 15_000 });
    // Évite la race d'hydratation React : le bouton peut être visible avant
    // que son handler de clic ne soit attaché.
    await this.page.waitForLoadState('networkidle');
  }

  /** Depuis la page /auth, lance Auth0 et attend l'écran identifiant. */
  async goToLogin(): Promise<void> {
    await this.goToAuthLanding();
    await this.signInWithAuth0Button.click();
    await this.page.waitForURL('**/u/login/identifier**', { timeout: 30_000 });
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
   * Flux complet : email → mot de passe → OTP récupéré via Gmail.
   * S'arrête une fois la redirection hors Auth0 (retour sur le backoffice) détectée.
   */
  async loginWithOtp(
    email = process.env.AUTH_EMAIL!,
    password = process.env.AUTH_PASSWORD!,
  ): Promise<void> {
    await this.goToLogin();
    await this.enterEmail(email);

    const beforeOtp = new Date();
    await this.fillPassword(password);
    await this.submitPassword();

    await this.otpInput.waitFor({ state: 'visible', timeout: 30_000 });
    const otp = await fetchOtpFromGmail({ sentAfter: beforeOtp, timeoutMs: 120_000 });
    await this.otpInput.fill(otp);
    await this.continueButton.click();

    await this.page.waitForURL((url) => !url.host.includes('auth0.tiime.fr'), {
      timeout: 30_000,
    });
  }
}
