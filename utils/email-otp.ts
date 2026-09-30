import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { requireSecret } from './secrets';

interface OtpOptions {
  email?: string;
  appPassword?: string;
  senderFilter?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sentAfter?: Date;
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
 * Récupère le code OTP de la MFA par e-mail Auth0 via IMAP.
 * Le compte de test utilise le facteur « E-mail » d'Auth0 (cf. LoginPage : on bascule
 * sur ce facteur après le mot de passe). Auth0 envoie le code à l'adresse du compte
 * (= AUTH_EMAIL), lue ici en IMAP — aucune dépendance à un téléphone.
 *
 * - Boîte IMAP : GMAIL_USER (défaut jean.baptiste.barbe@swapn.fr).
 * - Expéditeur recherché : option senderFilter > OTP_SENDER > défaut no-reply@apps.tiime.fr.
 * - GMAIL_APP_PASSWORD est le seul secret strictement requis.
 *
 * Le corps MIME est décodé (mailparser) avant extraction, pour ne pas confondre le
 * code avec des nombres présents dans les en-têtes bruts.
 */
export async function fetchOtpFromEmail(options: OtpOptions = {}): Promise<string> {
  const email = options.email ?? requireSecret('GMAIL_USER');
  const appPassword = options.appPassword ?? requireSecret('GMAIL_APP_PASSWORD');
  const senderFilter =
    options.senderFilter ?? process.env.OTP_SENDER ?? 'no-reply@apps.tiime.fr';
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

  try {
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

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // IMAP SINCE ne gère que la granularité jour → on borne à aujourd'hui.
        const sinceDate = new Date();
        sinceDate.setHours(0, 0, 0, 0);

        const result = await client.search(
          { from: senderFilter, since: sinceDate, seen: false },
          { uid: true },
        );
        const uids = Array.isArray(result) ? result : [];

        if (uids.length > 0) {
          // Du plus récent au plus ancien.
          for (let i = uids.length - 1; i >= 0; i--) {
            const msg = await client.fetchOne(
              String(uids[i]),
              { source: true, envelope: true },
              { uid: true },
            );
            // `source` est optionnel dans la réponse IMAP : sans lui, rien à parser.
            if (!msg || !msg.source) continue;

            // Ignore les mails antérieurs à la demande (marge 5 s pour le décalage
            // d'horloge), pour ne pas consommer un ancien code non lu.
            const margin = new Date(sentAfter.getTime() - 5_000);
            if (msg.envelope?.date && new Date(msg.envelope.date) < margin) {
              continue;
            }

            // Annotation explicite : `simpleParser` a une surcharge à callback, et sans
            // type de retour attendu TypeScript résout l'union et perd `text`/`html`.
            const parsed: ParsedMail = await simpleParser(msg.source);
            const text = (parsed.text ?? parsed.html ?? '').toString();
            const code = extractCode(text);

            if (code) {
              await client.messageFlagsAdd(
                String(uids[i]),
                ['\\Seen'],
                { uid: true },
              );
              return code;
            }
          }
        }
      } finally {
        lock.release();
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`OTP e-mail introuvable après ${timeoutMs / 1000}s`);
  } finally {
    await client.logout();
  }
}
