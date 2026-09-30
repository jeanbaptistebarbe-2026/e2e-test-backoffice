import { requireSecret } from './secrets';

/**
 * Rôles testés. Chaque rôle a son propre compte Auth0 et sa propre session en cache.
 *   - `admin` : Inbox, Agenda, Annuaire, Kiosk, Administration, Paramètres (pas `/tickets`).
 *   - `bpo`   : Contrôles FDE (`/tickets`) et Kiosk — même périmètre que DATA_MANAGER.
 */
export type Role = 'admin' | 'bpo';

export interface RoleCredentials {
  /** Identifiant Auth0 (= adresse qui reçoit le code MFA). */
  email: string;
  password: string;
  /** Boîte IMAP où lire le code MFA. */
  imapUser: string;
  imapPassword: string;
}

/**
 * Identifiants d'un rôle, lus dans les secrets (jamais en dur).
 *
 * BPO : `AUTH_EMAIL_BPO` / `AUTH_PASSWORD_BPO`. La boîte IMAP retombe sur celle de
 * l'admin (`GMAIL_USER` / `GMAIL_APP_PASSWORD`) si `GMAIL_USER_BPO` n'est pas défini :
 * cas d'un alias (`prenom.nom+bpo@…`) livré dans la même boîte. Le code est alors
 * distingué par son destinataire (cf. `fetchOtpFromEmail`).
 *
 * Résolution PARESSEUSE : à n'appeler qu'au moment du login, pour qu'un secret BPO
 * absent ne fasse pas planter la collecte des tests admin.
 */
export function credentialsFor(role: Role): RoleCredentials {
  if (role === 'bpo') {
    return {
      email: requireSecret('AUTH_EMAIL_BPO'),
      password: requireSecret('AUTH_PASSWORD_BPO'),
      imapUser: process.env.GMAIL_USER_BPO || requireSecret('GMAIL_USER'),
      imapPassword: process.env.GMAIL_APP_PASSWORD_BPO || requireSecret('GMAIL_APP_PASSWORD'),
    };
  }
  return {
    email: requireSecret('AUTH_EMAIL'),
    password: requireSecret('AUTH_PASSWORD'),
    imapUser: requireSecret('GMAIL_USER'),
    imapPassword: requireSecret('GMAIL_APP_PASSWORD'),
  };
}
