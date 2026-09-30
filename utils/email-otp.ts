import { ImapFlow, type SearchObject } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { requireSecret } from './secrets';

/** Accès à une boîte IMAP Gmail (défaut : boîte du compte admin). */
interface ImapOptions {
  email?: string;
  appPassword?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Ignore les mails antérieurs à cette date (marge de 5 s pour le décalage d'horloge). */
  sentAfter?: Date;
}

interface OtpOptions extends ImapOptions {
  senderFilter?: string;
  /**
   * Destinataire attendu. Indispensable quand deux comptes (admin, BPO) reçoivent
   * leur code dans la même boîte : sans lui, deux logins simultanés se volent leur code.
   */
  recipient?: string;
}

interface SubjectOptions extends ImapOptions {
  /** Objet exact (ou fragment unique) du mail attendu, ex. `E2E 1727700000000`. */
  subject: string;
}

/**
 * Extrait un code à usage unique (6 chiffres) du corps texte d'un email.
 * Privilégie un code proche du mot "code" (fenêtre large car le mail Auth0 Tiime
 * intercale « à usage unique permettant de vous identifier. » avant le nombre),
 * sinon prend le premier groupe isolé de 6 chiffres.
 */
function extractCode(text: string): string | null {
  if (!text) return null;
  const near = text.match(/code[^0-9]{0,60}(\d{6})/i);
  if (near) return near[1];
  const any = text.match(/\b(\d{6})\b/);
  return any ? any[1] : null;
}

/**
 * Cœur commun : se connecte en IMAP, interroge INBOX jusqu'à ce qu'un mail
 * satisfaisant `search` (critères IMAP) puis `accept` (test sur le mail décodé)
 * arrive après `sentAfter`, le marque lu et renvoie la valeur extraite.
 *
 * Le corps MIME est décodé (mailparser) avant extraction, pour ne pas confondre le
 * contenu avec les en-têtes bruts.
 */
async function waitForMail<T>(
  options: ImapOptions,
  search: SearchObject,
  accept: (mail: ParsedMail) => T | null,
  notFoundLabel: string,
): Promise<T> {
  const email = options.email ?? requireSecret('GMAIL_USER');
  // Google affiche le mot de passe d'application par groupes (« abcd efgh … ») :
  // on retire les espaces, souvent recopiés tels quels dans les secrets.
  const appPassword = (options.appPassword ?? requireSecret('GMAIL_APP_PASSWORD')).replace(/\s+/g, '');
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const sentAfter = options.sentAfter ?? new Date();

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });

  // Le message brut d'imapflow en cas de refus d'authentification est un opaque
  // « Command failed » : sans ce diagnostic, un mot de passe d'application Gmail
  // expiré ou révoqué fait échouer TOUS les tests authentifiés sans indice.
  try {
    await client.connect();
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; responseText?: string };
    if (err.authenticationFailed) {
      throw new Error(
        `Connexion IMAP refusée pour « ${email} » : ${err.responseText ?? 'identifiants invalides'}. ` +
          `Le mot de passe d'application Gmail (GMAIL_APP_PASSWORD) est probablement expiré ou révoqué ` +
          `— Google les invalide notamment quand le mot de passe du compte change. ` +
          `En régénérer un sur https://myaccount.google.com/apppasswords, puis mettre à jour .env ` +
          `ET secrets_e2e.yml (puis « npm run secrets:encrypt »).`,
      );
    }
    throw e;
  }

  try {
    const deadline = Date.now() + timeoutMs;
    const margin = new Date(sentAfter.getTime() - 5_000);

    while (Date.now() < deadline) {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // IMAP SINCE ne gère que la granularité jour → on borne à aujourd'hui.
        const sinceDate = new Date();
        sinceDate.setHours(0, 0, 0, 0);

        const result = await client.search({ ...search, since: sinceDate }, { uid: true });
        const uids = Array.isArray(result) ? result : [];

        // Du plus récent au plus ancien.
        for (let i = uids.length - 1; i >= 0; i--) {
          const msg = await client.fetchOne(
            String(uids[i]),
            { source: true, envelope: true },
            { uid: true },
          );
          // `source` est optionnel dans la réponse IMAP : sans lui, rien à parser.
          if (!msg || !msg.source) continue;

          // Ignore les mails antérieurs à la demande, pour ne pas consommer un
          // ancien mail non lu.
          if (msg.envelope?.date && new Date(msg.envelope.date) < margin) continue;

          // Annotation explicite : `simpleParser` a une surcharge à callback, et sans
          // type de retour attendu TypeScript résout l'union et perd `text`/`html`.
          const parsed: ParsedMail = await simpleParser(msg.source);
          const value = accept(parsed);
          if (value !== null) {
            await client.messageFlagsAdd(String(uids[i]), ['\\Seen'], { uid: true });
            return value;
          }
        }
      } finally {
        lock.release();
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`${notFoundLabel} introuvable après ${timeoutMs / 1000}s`);
  } finally {
    await client.logout();
  }
}

/**
 * Récupère le code OTP de la MFA par e-mail Auth0 via IMAP.
 * Le compte de test utilise le facteur « E-mail » d'Auth0 (cf. LoginPage : on bascule
 * sur ce facteur après le mot de passe). Auth0 envoie le code à l'adresse du compte,
 * lue ici en IMAP — aucune dépendance à un téléphone.
 *
 * - Boîte IMAP : option `email` > GMAIL_USER.
 * - Expéditeur recherché : option senderFilter > OTP_SENDER > défaut no-reply@apps.tiime.fr.
 * - Destinataire : option `recipient` (filtre les codes des autres comptes de la boîte).
 */
export async function fetchOtpFromEmail(options: OtpOptions = {}): Promise<string> {
  const senderFilter =
    options.senderFilter ?? process.env.OTP_SENDER ?? 'no-reply@apps.tiime.fr';
  const search: SearchObject = { from: senderFilter, seen: false };
  if (options.recipient) search.to = options.recipient;

  return waitForMail(
    options,
    search,
    (mail) => extractCode((mail.text ?? mail.html ?? '').toString()),
    'OTP e-mail',
  );
}

/**
 * Attend un mail dont l'objet contient `subject` (typiquement un objet unique
 * `E2E <timestamp>` envoyé par un test) et renvoie le mail décodé.
 * Ne filtre pas sur « non lu » : le client Gmail peut l'avoir déjà marqué lu.
 */
export async function fetchEmailBySubject(options: SubjectOptions): Promise<ParsedMail> {
  return waitForMail(
    options,
    { subject: options.subject },
    (mail) => ((mail.subject ?? '').includes(options.subject) ? mail : null),
    `Mail « ${options.subject} »`,
  );
}
