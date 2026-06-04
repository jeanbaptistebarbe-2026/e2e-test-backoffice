import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

interface OtpOptions {
  email?: string;
  appPassword?: string;
  senderFilter?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sentAfter?: Date;
}

/**
 * Extrait un code à 6 chiffres du corps texte d'un email.
 * Privilégie un code proche du mot "code" (ex. "votre code Tiime : 123456"),
 * sinon prend le premier groupe isolé de 6 chiffres.
 */
function extractCode(text: string): string | null {
  if (!text) return null;
  const near = text.match(/code[^0-9]{0,30}(\d{6})/i);
  if (near) return near[1];
  const any = text.match(/\b(\d{6})\b/);
  return any ? any[1] : null;
}

/**
 * Récupère le code OTP (6 chiffres) via IMAP Gmail.
 * - Identifiant IMAP : GMAIL_USER si défini, sinon défaut jean.baptiste.barbe@swapn.fr.
 * - Expéditeur recherché : option senderFilter > OTP_SENDER > défaut jeanbaptiste.barbe@gmail.com.
 *
 * GMAIL_USER et OTP_SENDER ne sont pas des secrets : ils ont un défaut intégré,
 * donc seul GMAIL_APP_PASSWORD est strictement requis pour la récupération OTP.
 *
 * Le corps MIME est décodé (mailparser) avant extraction, pour ne pas
 * confondre le code avec les nombres présents dans les en-têtes bruts.
 *
 * Pour la MFA par SMS, configurer OTP_SENDER avec l'adresse depuis laquelle
 * l'iPhone (via un Raccourci) transfère le SMS vers la boîte Gmail.
 */
export async function fetchOtpFromGmail(options: OtpOptions = {}): Promise<string> {
  const email =
    options.email ?? process.env.GMAIL_USER ?? 'jean.baptiste.barbe@swapn.fr';
  const appPassword = options.appPassword ?? process.env.GMAIL_APP_PASSWORD!;
  const senderFilter =
    options.senderFilter ?? process.env.OTP_SENDER ?? 'jeanbaptiste.barbe@gmail.com';
  const timeoutMs = options.timeoutMs ?? 90_000;
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
    await client.connect();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // IMAP SINCE only supports date granularity, so we use today
        const sinceDate = new Date();
        sinceDate.setHours(0, 0, 0, 0);

        const result = await client.search(
          { from: senderFilter, since: sinceDate, seen: false },
          { uid: true },
        );
        const uids = Array.isArray(result) ? result : [];

        if (uids.length > 0) {
          // Check emails from newest to oldest
          for (let i = uids.length - 1; i >= 0; i--) {
            const msg = await client.fetchOne(
              String(uids[i]),
              { source: true, envelope: true },
              { uid: true },
            );
            if (!msg) continue;

            // Skip emails received before the OTP was requested (5s margin for clock skew).
            // Tight margin avoids picking up unconsumed OTPs from other tests.
            const margin = new Date(sentAfter.getTime() - 5_000);
            if (msg.envelope?.date && new Date(msg.envelope.date) < margin) {
              continue;
            }

            const parsed = await simpleParser(msg.source);
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

    throw new Error(`OTP email not found within ${timeoutMs / 1000}s`);
  } finally {
    await client.logout();
  }
}
