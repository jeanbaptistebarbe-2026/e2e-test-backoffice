import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

/**
 * Chiffre secrets_e2e.yml (clair) → secrets_e2e.enc.yml (committable).
 *
 * Usage :
 *   node scripts/secrets-encrypt.mjs --key=MA_CLE [--in secrets_e2e.yml] [--out secrets_e2e.enc.yml]
 *   (ou via npm : npm run secrets:encrypt -- --key=MA_CLE)
 *
 * Chaque valeur est chiffrée en AES-256-GCM (clé dérivée par scrypt + sel aléatoire
 * par valeur). Le déchiffrement runtime est fait par utils/secrets.ts avec la MÊME clé.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function argVal(name) {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}

const passphrase = argVal('key') ?? process.env.E2E_SECRETS_KEY;
const inFile = path.resolve(ROOT, argVal('in') ?? 'secrets_e2e.yml');
const outFile = path.resolve(ROOT, argVal('out') ?? 'secrets_e2e.enc.yml');

if (!passphrase) {
  console.error(
    'Erreur : clé requise.\n' +
      '  Usage : node scripts/secrets-encrypt.mjs --key=MA_CLE [--in …] [--out …]',
  );
  process.exit(1);
}
if (!fs.existsSync(inFile)) {
  console.error(`Erreur : source introuvable : ${inFile}`);
  process.exit(1);
}

function parseFlatYaml(content) {
  const out = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function encryptValue(value, pass) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, enc].map((b) => b.toString('base64')).join(':');
}

function decryptValue(stored, pass) {
  const [s, i, t, d] = stored.split(':').map((b) => Buffer.from(b, 'base64'));
  const key = crypto.scryptSync(pass, s, 32);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, i);
  dec.setAuthTag(t);
  return Buffer.concat([dec.update(d), dec.final()]).toString('utf8');
}

const entries = parseFlatYaml(fs.readFileSync(inFile, 'utf8'));
const header = [
  '# =============================================================================',
  '# Secrets E2E CHIFFRÉS (AES-256-GCM). Fichier destiné à être COMMITTÉ.',
  '# Déchiffré au runtime par utils/secrets.ts avec la clé fournie via',
  '# E2E_SECRETS_KEY / PLAYWRIGHT_EXTRA_OPTIONS (Squash) / --key=… (local).',
  '# Régénérer : npm run secrets:encrypt -- --key=MA_CLE',
  '# =============================================================================',
  '',
];

const lines = [...header];
let count = 0;
for (const [name, value] of Object.entries(entries)) {
  const stored = encryptValue(value, passphrase);
  if (decryptValue(stored, passphrase) !== value) {
    console.error(`Erreur : contrôle aller-retour échoué pour « ${name} ».`);
    process.exit(1);
  }
  lines.push(`${name}: ${stored}`);
  count++;
}

fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
console.log(`OK : ${count} secret(s) chiffré(s) → ${path.relative(ROOT, outFile)}`);
