import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const user = process.env.GMAIL_USER ?? process.env.AUTH_EMAIL;
const pass = process.env.GMAIL_APP_PASSWORD;
const sender = process.env.OTP_SENDER;

console.log(`IMAP user      : ${user}`);
console.log(`OTP_SENDER     : ${sender}`);

const client = new ImapFlow({
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: { user, pass },
  logger: false,
});

try {
  await client.connect();
  console.log('✅ Connexion IMAP OK');

  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    console.log('\n--- 10 derniers messages INBOX ---');
    const all = await client.search({ since }, { uid: true });
    const uids = (Array.isArray(all) ? all : []).slice(-10);
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
      const from = msg?.envelope?.from?.map((f) => f.address).join(', ');
      console.log(`[${msg?.envelope?.date?.toISOString?.() ?? '?'}] from=${from} | subj=${msg?.envelope?.subject}`);
    }

    console.log(`\n--- Messages de ${sender} : corps décodé + code extrait ---`);
    const fromSender = await client.search({ from: sender, since }, { uid: true });
    const sUids = Array.isArray(fromSender) ? fromSender : [];

    const extractCode = (text) => {
      if (!text) return null;
      const near = text.match(/code[^0-9]{0,30}(\d{6})/i);
      if (near) return near[1];
      const any = text.match(/\b(\d{6})\b/);
      return any ? any[1] : null;
    };

    for (const uid of sUids.slice(-5)) {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
      const parsed = await simpleParser(msg.source);
      const text = (parsed.text ?? parsed.html ?? '').trim();
      console.log(`\n[${msg?.envelope?.date?.toISOString?.()}] corps="${text.replace(/\s+/g, ' ').slice(0, 120)}" => code=${extractCode(text)}`);
    }
  } finally {
    lock.release();
  }
} catch (e) {
  console.error('❌ Erreur IMAP :', e.message);
} finally {
  await client.logout();
}
