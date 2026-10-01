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
 *   1. `E2E_SECRETS_KEY` (variable d'environnement dédiée) — mécanisme NOMINAL,
 *      y compris sous SquashTM depuis que le runner accepte de vraies variables d'env.
 *   2. `PLAYWRIGHT_EXTRA_OPTIONS` avec la clé portée par `--grep-invert=<clé>` —
 *      mécanisme HISTORIQUE, DÉPRÉCIÉ (voir ci-dessous).
 *   3. argument de la commande locale `--key=…` / `--secrets-key=…` (via run-e2e.mjs)
 *
 * ─── Pourquoi (2) est déprécié ───────────────────────────────────────────────
 * `PLAYWRIGHT_EXTRA_OPTIONS` est AJOUTÉE à la ligne de commande `playwright test`,
 * donc elle ne peut contenir que de vraies options Playwright. Faire porter la clé
 * par `--grep-invert=<clé>` était valide tant qu'on ne filtrait pas les tests : la
 * clé ne matchant aucun titre, tous les tests tournaient.
 *
 * Depuis l'introduction des tags (`@ecriture`, `@role-bpo`…), cette
 * option est NÉCESSAIRE au filtrage, et la faire porter la clé provoquerait une
 * collision silencieuse : soit la clé est prise pour une expression de tags (et
 * n'exclut rien), soit une expression de tags est prise pour la clé (et le
 * déchiffrement échoue). D'où la garde `looksLikeTagExpression` ci-dessous, qui
 * refuse d'interpréter comme clé toute valeur ressemblant à un filtre de tags.
 *
 * RÈGLE : ne jamais configurer un job Squash avec à la fois la clé en
 * `--grep-invert` ET un filtrage par tag. Une fois `E2E_SECRETS_KEY` déployé sur
 * tous les jobs, le fallback (2) pourra être supprimé.
 */

const ENC_FILE = path.resolve(__dirname, '..', 'secrets_e2e.enc.yml');
/** Source en clair, LOCALE uniquement (gitignorée, donc absente sur Squash/CI). */
const PLAIN_FILE = path.resolve(__dirname, '..', 'secrets_e2e.yml');
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

const unquote = (v: string) => v.replace(/^['"]|['"]$/g, '');

/**
 * Une valeur est une expression de tags (et donc PAS une clé) si elle mentionne un
 * tag `@…` ou utilise la syntaxe des expressions de filtrage Playwright. Tous nos
 * tags commencent par `@` ; une passphrase n'en contient jamais.
 */
function looksLikeTagExpression(value: string): boolean {
  return value.includes('@') || /[|()!]/.test(value);
}

/**
 * Extrait la clé d'une chaîne d'options, porteurs LOCAUX uniquement :
 *   - `--secrets-key=XXX` / `--key=XXX` (wrapper run-e2e.mjs)
 *   - `E2E_SECRETS_KEY=XXX`
 */
function extractKey(source?: string): string | undefined {
  if (!source) return undefined;
  const m = source.match(/(?:--secrets-key|--key|E2E_SECRETS_KEY)[=\s]+("[^"]+"|'[^']+'|\S+)/);
  return m ? unquote(m[1]) : undefined;
}

/**
 * Fallback historique : clé portée par `--grep-invert` dans PLAYWRIGHT_EXTRA_OPTIONS.
 * Refuse toute valeur ressemblant à une expression de tags, pour ne jamais confondre
 * un filtre légitime (`--grep-invert @ecriture`) avec une passphrase.
 */
function extractLegacyGrepInvertKey(source?: string): string | undefined {
  if (!source) return undefined;
  const m = source.match(/--grep-invert[=\s]+("[^"]+"|'[^']+'|\S+)/);
  if (!m) return undefined;
  const value = unquote(m[1]);
  if (looksLikeTagExpression(value) || value.length < 12) return undefined;
  console.warn(
    '[secrets] Clé de déchiffrement lue depuis « --grep-invert » : mécanisme DÉPRÉCIÉ ' +
      'et incompatible avec le filtrage par tags. Utiliser la variable E2E_SECRETS_KEY.',
  );
  return value;
}

/** Résout la clé de déchiffrement selon l'ordre de priorité documenté ci-dessus. */
export function resolveSecretsKey(): string | undefined {
  const dedicated = process.env.E2E_SECRETS_KEY?.trim();
  if (dedicated) return unquote(dedicated);
  return (
    extractLegacyGrepInvertKey(process.env.PLAYWRIGHT_EXTRA_OPTIONS) ??
    extractKey(process.env.PLAYWRIGHT_EXTRA_OPTIONS) ??
    extractKey(process.argv.join(' '))
  );
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
 * Peuple `process.env` avec les secrets. Idempotent (une fois par process/worker).
 *
 * 1. `secrets_e2e.yml` (clair, local) s'il existe : fichier de configuration de
 *    référence en local, ses valeurs NON VIDES **priment sur `.env`** — pour qu'une
 *    modification y soit prise en compte sans rechiffrer ni resynchroniser `.env`.
 *    Absent sur Squash/CI (gitignoré), donc sans effet là-bas.
 * 2. `secrets_e2e.enc.yml` déchiffré avec la clé résolue, sans écraser l'existant.
 *    No-op si aucune clé n'est fournie ou si le fichier chiffré est absent.
 */
export function loadSecrets(): void {
  if (loaded) return;
  loaded = true;
  if (fs.existsSync(PLAIN_FILE)) {
    for (const [name, value] of Object.entries(parseFlatYaml(fs.readFileSync(PLAIN_FILE, 'utf8')))) {
      if (value) process.env[name] = value;
    }
  }
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
      `Secret « ${name} » manquant. Fournir la clé de déchiffrement via la variable ` +
        `d'environnement E2E_SECRETS_KEY (y compris sur Squash), ou --key=… en local ` +
        `via run-e2e.mjs, ou définir la variable dans un .env local.`,
    );
  }
  return value;
}
