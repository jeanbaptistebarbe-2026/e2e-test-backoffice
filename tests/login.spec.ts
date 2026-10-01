import { loggedOutTest as test, expect } from './fixtures';
import { LoginPage } from '../pages/LoginPage';
import { requireSecret } from '../utils/secrets';
import { meta } from './meta';

// Identifiants du compte de test : lus depuis les secrets chiffrés (ou un .env
// local), jamais en dur dans le code. Cf. utils/secrets.ts.
//
// Résolution PARESSEUSE (fonctions, pas constantes) : `requireSecret()` au niveau
// module s'exécuterait à la COLLECTE des tests, donc sans clé de déchiffrement
// Playwright planterait au chargement du fichier et AUCUN test du run ne démarrerait
// — même ceux qui n'ont pas besoin de ce secret.
const authEmail = () => requireSecret('AUTH_EMAIL');
const authPassword = () => requireSecret('AUTH_PASSWORD');

// Ces tests jouent le flux de login depuis zéro : `loggedOutTest` fournit déjà un
// contexte vierge (pas d'état d'authentification).

// TC-AUTH-UI-01/02 (bouton « Se connecter avec Auth0 » de /auth) retirés : /auth
// redirige désormais automatiquement vers Auth0. Remplacés par TC-AUTH-12
// (tests/auth/session.spec.ts).

test.describe('Login — écran email', { tag: ['@auth'] }, () => {
  let login: LoginPage;

  test.beforeEach(async ({ page }) => {
    login = new LoginPage(page);
    await login.goToLogin();
  });

  test(
    'redirige vers la page de login Auth0',
    meta('TC-AUTH-UI-03', 'Sans session, ouvre le backoffice et vérifie la redirection vers l’écran identifiant d’Auth0 Tiime.'),
    async ({ page }) => {
      await expect(page).toHaveURL(/auth0\.tiime\.fr\/u\/login\/identifier/);
      await expect(login.usernameInput).toBeVisible();
    },
  );

  test(
    'affiche une erreur si l’email est vide',
    meta('TC-AUTH-UI-04', 'Valide l’écran identifiant sans saisie et vérifie le message « Veuillez saisir une adresse e-mail ».'),
    async () => {
      await login.submitEmail();
      await expect(login.emailRequiredError).toBeVisible();
      await expect(login.emailRequiredError).toHaveText(
        /Veuillez saisir une adresse e-mail/,
      );
    },
  );

  test(
    'affiche une erreur si le format d’email est invalide',
    meta('TC-AUTH-UI-05', 'Saisit « not-an-email » et vérifie le message « Saisissez une adresse email valide ».'),
    async () => {
      await login.fillEmail('not-an-email');
      await login.submitEmail();
      await expect(login.emailInvalidError).toBeVisible();
      await expect(login.emailInvalidError).toHaveText(
        /Saisissez une adresse email valide/,
      );
    },
  );

  test(
    'un email valide mène à l’écran mot de passe',
    meta('TC-AUTH-UI-06', 'Saisit l’e-mail du compte de test et vérifie le passage à l’écran mot de passe.'),
    async () => {
      await login.enterEmail(authEmail());
      await expect(login.passwordInput).toBeVisible();
    },
  );
});

test.describe('Login — écran mot de passe', { tag: ['@auth'] }, () => {
  let login: LoginPage;

  test.beforeEach(async ({ page }) => {
    login = new LoginPage(page);
    await login.goToLogin();
    await login.enterEmail(authEmail());
  });

  test(
    'affiche une erreur si le mot de passe est vide',
    meta('TC-AUTH-UI-07', 'Valide l’écran mot de passe sans saisie et vérifie le message « Mot de passe requis ».'),
    async () => {
      await login.submitPassword();
      await expect(login.passwordRequiredError).toBeVisible();
      await expect(login.passwordRequiredError).toHaveText(/Mot de passe requis/);
    },
  );

  test(
    'affiche une erreur si le mot de passe est incorrect',
    meta('TC-AUTH-UI-08', 'Saisit un mauvais mot de passe et vérifie le message « Email ou mot de passe incorrect ».'),
    async () => {
      await login.fillPassword('WrongPassword123!');
      await login.submitPassword();
      await expect(login.wrongPasswordError).toBeVisible({ timeout: 10_000 });
      await expect(login.wrongPasswordError).toHaveText(
        /Email ou mot de passe incorrect/,
      );
    },
  );

  test(
    'un mot de passe valide mène au challenge MFA',
    meta('TC-AUTH-UI-09', 'Saisit le bon mot de passe et vérifie l’arrivée sur un challenge MFA Auth0 (champ de code visible).'),
    async ({ page }) => {
      await login.fillPassword(authPassword());
      await login.submitPassword();
      // Ce compte utilise une MFA par SMS ; on accepte tout challenge MFA Auth0
      await expect(page).toHaveURL(/\/u\/mfa-.*-challenge/, { timeout: 30_000 });
      await expect(login.otpInput).toBeVisible({ timeout: 10_000 });
    },
  );
});
