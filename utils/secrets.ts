import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Chargement des secrets E2E **chiffrés**.
 *
 * Objectif : ne plus avoir aucun secret en clair dans le code. Les valeurs vivent
 * dans `secrets_e2e.yml` (clair, gitignoré) côté auteur, et sont chiffrées dans
 * `secrets_e2e.enc.yml` (committable) via `npm run secrets:encrypt`.
 *
 * Au runtime, `loadSecrets()` déchiffre `secrets_e2e.enc.yml` avec une clé fournie
 * et injecte les valeurs dans `process.env` (sans écraser une variable déjà définie
 * → un `.env` local ou un vrai env garde la priorité). Fonctionne aussi sous SquashTM
 * qui ignore playwright.config.ts, car l'appel se fait EN CODE (depuis les fixtures).
 *
 * Provenance de la clé, dans l'ordre :
 *   1. `E2E_SECRETS_KEY` (variable d'environnement dédiée)
 *   2. `PLAYWRIGHT_EXTRA_OPTIONS` contenant `--secrets-key=…` (cas SquashTM)
 *   3. argument de la commande locale `--key=…` / `--secrets-key=…`
 */

const ENC_FILE = path.resolve(__dirname, '..', 'secrets_e2e.enc.yml');
let loaded = false;

/** Parse un YAML plat `CLE: valeur` (commentaires `#` et lignes vides ignorés). */
function parseFlatYaml(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':'); // 1er `:` seulement (les valeurs peuvent en contenir)
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

/** Extrait la clé d'une chaîne du type `… --secrets-key=XXX …` (ou --key / E2E_SECRETS_KEY). */
function extractKey(source?: string): string | undefined {
  if (!source) return undefined;
  const m = source.match(/(?:--secrets-key|--key|E2E_SECRETS_KEY)[=\s]+("[^"]+"|'[^']+'|\S+)/);
  return m ? m[1].replace(/^['"]|['"]$/g, '') : undefined;
}

/** Résout la clé de déchiffrement selon l'ordre de priorité documenté ci-dessus. */
export function resolveSecretsKey(): string | undefined {
  const dedicated = process.env.E2E_SECRETS_KEY?.trim();
  if (dedicated) return dedicated;
  return extractKey(process.env.PLAYWRIGHT_EXTRA_OPTIONS) ?? extractKey(process.argv.join(' '));
}

/** Déchiffre une valeur `base64(salt):base64(iv):base64(tag):base64(data)` (AES-256-GCM). */
function decryptValue(stored: string, passphrase: string): string {
  const [saltB64, ivB64, tagB64, dataB64] = stored.split(':');
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Déchiffre `secrets_e2e.enc.yml` avec la clé résolue et peuple `process.env`
 * (sans écraser l'existant). No-op si aucune clé n'est fournie (dev local via `.env`)
 * ou si le fichier chiffré est absent. Idempotent (une fois par process/worker).
 */
export function loadSecrets(): void {
  if (loaded) return;
  loaded = true;
  const key = resolveSecretsKey();
  if (!key || !fs.existsSync(ENC_FILE)) return;
  const entries = parseFlatYaml(fs.readFileSync(ENC_FILE, 'utf8'));
  for (const [name, enc] of Object.entries(entries)) {
    if (process.env[name]) continue; // un env réel / .env a la priorité
    try {
      process.env[name] = decryptValue(enc, key);
    } catch (e) {
      throw new Error(
        `Déchiffrement du secret « ${name} » impossible — clé E2E invalide ? (${(e as Error).message})`,
      );
    }
  }
}

/** Récupère un secret requis (déclenche le chargement au besoin). Erreur claire si absent. */
export function requireSecret(name: string): string {
  loadSecrets();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Secret « ${name} » manquant. Fournir la clé de déchiffrement ` +
        `(E2E_SECRETS_KEY, PLAYWRIGHT_EXTRA_OPTIONS « --secrets-key=… » sur Squash, ` +
        `ou --key=… en local) ou définir la variable dans un .env local.`,
    );
  }
  return value;
}
